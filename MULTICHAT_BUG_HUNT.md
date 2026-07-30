# MultiChat Bug Hunt & Cleanup Report

**Date:** 2026-07-30
**Total lines inspected:** ~4,668 in `index.html`, plus `sw.js`, `proxy.js`, `manifest.json`, `update_models.js`

---

## 1. CRITICAL Bugs

### CRITICAL-1: XSS via unescaped content in `fmtText()`

**File:** `index.html:4435-4464`
**Problem:** `fmtText()` converts AI model responses into HTML without escaping regular text. Pattern replacements like `/^(.+)$/gm` → `<h1>$1</h1>` (lines 4439-4441) inject unescaped `$1` into innerHTML. If a model returns `<img src=x onerror=alert(1)>`, it becomes executable HTML. Only content inside code fences/backticks is passed through `esc()`.
**Severity:** CRITICAL — stored XSS, persists across session reloads. Any provider (or MITM on API route) can inject arbitrary HTML/JS. The service worker's CORS proxy (line 67-73) bypasses cross-origin checks, making MITM more feasible on proxied connections.
**Fix:** Escape all captured groups in `fmtText()`. For example, replace:
```javascript
text = text.replace(/^### (.+)$/gm,'<h3>$1</h3>');
// with
text = text.replace(/^### (.+)$/gm, (_, c) => `<h3>${esc(c)}</h3>`);
```
Apply `esc()` to ALL capture groups in lines 4439-4453 (headings, bold, italic, blockquotes, list items).

### CRITICAL-2: `updateStreamRow()` writes unsanitized content via `innerHTML`

**File:** `index.html:4419`
```javascript
streamTextEl.innerHTML = fmtText(stripThink(msg.content));
```
**Problem:** Builds on CRITICAL-1 — the entire streaming text rendering uses the vulnerable `fmtText()` and sets it via `innerHTML`. Combined, this means every AI response is a potential XSS vector.
**Severity:** CRITICAL
**Fix:** Fix `fmtText()` to escape all content (see CRITICAL-1).

---

## 2. HIGH Bugs

### HIGH-1: `send-btn` stays disabled if file extraction never completes

**File:** `index.html:4048-4061`
```javascript
if (attachedFiles.some(f => f._extracting)) {
    showToast('⏳ Extracting files…');
    document.getElementById('send-btn').disabled = true;
    const checkDone = () => {
        if (attachedFiles.some(f => f._extracting)) {
            setTimeout(checkDone, 300);
        } else {
            document.getElementById('send-btn').disabled = false;
            sendMessage(); // auto-retry
        }
    };
    setTimeout(checkDone, 300);
    return;
}
```
**Problem:** If file extraction throws an error (e.g., PDF parsing fails), `_extracting` is set to `false` inside the catch block (lines 2828-2834, 3063-3069) so the guard clears. However, if `handleRagFiles`/`handleFileAttach` is never called (e.g., user clicks send while file is still being read but before `_extracting` is set), the `_extracting` flag may never be set. The extraction promise chain could also fail silently if the `catch()` handler at line 2834 throws (e.g., accessing `e.message` on a non-Error object). **Worse:** there's no timeout limit — the polling loop runs indefinitely (every 300ms forever), leaking timer references.
**Severity:** HIGH — button permanently disabled
**Fix:** Add a max retry count (e.g., 100 attempts = 30 seconds), then force-reset:
```javascript
let retries = 0;
const checkDone = () => {
    if (retries++ > 100) {
        document.getElementById('send-btn').disabled = false;
        showToast('⚠ File extraction timed out', 'err');
        return;
    }
    ...
};
```

### HIGH-2: Empty `catch(e) {}` blocks silently swallow authentication/config errors

**File:** Multiple locations

| Line | Function | Risk |
|------|----------|------|
| 1638 | `loadWebSearchSettings` | Corrupted settings silently reset to defaults |
| 1952 | `loadCloudSettings` | Corrupted cloud config silently reset |
| 2694 | `loadSectionState` | Corrupted section state silently reset |
| 2738 | `loadSettings` | Corrupted settings silently reset |
| 3599 | `loadChats` | **Corrupted `mc_chats` silently empties ALL conversations** |
| 2369 | `planSearchQueries` | Stream parsing errors silently ignored, may get partial JSON |
| 4247 | `sendMessage` | Stream parsing errors silently ignored during response |

**Problem:** At line 3599, if `mc_chats` in localStorage is corrupted (e.g., manually edited, quota exceeded mid-write), the `try` block catches and silently ignores the error. `conversations` remains `{}`, and the user's entire chat history appears lost. There is no recovery mechanism, no console warning, no toast notification.
**Severity:** HIGH — potential silent data loss
**Fix:** At minimum, log the error with `console.warn()` and show a toast:
```javascript
} catch(e) {
    console.warn('Failed to load chats:', e);
    showToast('⚠ Could not load conversations. Data may be corrupted.', 'err');
}
```

### HIGH-3: `saveChats()` calls `debouncedPushSync()` even when serialization fails

**File:** `index.html:3577`
```javascript
function saveChats() { try { localStorage.setItem('mc_chats', JSON.stringify(conversations)); } catch(e) {} debouncedPushSync(); }
```
**Problem:** The `try/catch` only protects `localStorage.setItem`. Regardless of whether the save succeeded or failed, `debouncedPushSync()` is called unconditionally. If saving failed (e.g., `QuotaExceededError`), the push will upload stale data from the previous save to the cloud, causing correct local data to be overwritten on pull from another device.
**Severity:** HIGH — cloud data corruption risk
**Fix:** Only push on successful save:
```javascript
function saveChats() {
    try {
        localStorage.setItem('mc_chats', JSON.stringify(conversations));
        debouncedPushSync();
    } catch(e) { console.warn('Failed to save chats:', e); }
}
```

### HIGH-4: Touch event handler doesn't actually prevent pull-to-refresh

**File:** `index.html:4565-4568`
```javascript
document.addEventListener('touchmove', e => {
    const msgs = document.getElementById('messages');
    if (msgs && msgs.contains(e.target) && msgs.scrollTop > 0) return;
}, { passive: false });
```
**Problem:** The handler has `{ passive: false }` but never calls `e.preventDefault()`. It only `return`s when scrolling is NOT at the top. When `scrollTop <= 0` (at the top — exactly when you want to prevent pull-to-refresh), the handler falls through without calling `preventDefault()`. The intent was to prevent pull-to-refresh when at the top of the message list, but the logic is inverted.
**Severity:** HIGH — mobile pull-to-refresh still refreshes the page
**Fix:** Invert the logic and actually call `preventDefault()`:
```javascript
document.addEventListener('touchmove', e => {
    const msgs = document.getElementById('messages');
    if (msgs && msgs.contains(e.target) && msgs.scrollTop <= 0) {
        e.preventDefault();
    }
}, { passive: false });
```

---

## 3. MEDIUM Bugs

### MEDIUM-1: Race condition in settings save — sliders can overwrite web search settings

**File:** `index.html:2700-2713` and `1591-1597`
**Problem:** `saveSettings()` (called on every slider/textarea input event) reads web search values from `existing` at the START of the function, then writes them back. If `saveWebSearchSettings()` fires between the read and write of `saveSettings()`, the web search toggle's new value gets overwritten by the stale value from the `existing` snapshot.
**Scenario:** Toggle web search on → `saveWebSearchSettings()` writes `webSearchEnabled: true` → immediately move temperature slider → `saveSettings()` reads `existing` (which has `webSearchEnabled: false` from before toggle) → overwrites mc_settings with `webSearchEnabled: false`. Web search turns back off.
**Severity:** MEDIUM
**Fix:** Don't preserve web search settings in `saveSettings()` — let `saveWebSearchSettings()` own them entirely:
```javascript
function saveSettings() {
    const s = {
        systemPrompt: document.getElementById('system-prompt').value,
        temperature: parseFloat(document.getElementById('temp-range').value),
        maxTokens: parseInt(document.getElementById('maxtok-range').value),
        topP: parseFloat(document.getElementById('topp-range').value),
        neuralwattFlexEnabled: document.getElementById('nw-flex-enabled')?.checked || false,
    };
    // Don't touch webSearch* keys — saveWebSearchSettings() owns those
    const existing = JSON.parse(localStorage.getItem('mc_settings') || '{}');
    localStorage.setItem('mc_settings', JSON.stringify({...existing, ...s}));
}
```

### MEDIUM-2: `loadSettings()` fails when `maxTokens` is 0

**File:** `index.html:2726`
```javascript
if (s.maxTokens) {
    document.getElementById('maxtok-range').value = s.maxTokens;
```
**Problem:** Uses truthy check (`if (s.maxTokens)`) instead of `!= null`. Since maxTokens minimum is 256 in the UI, this is unlikely but technically incorrect. `temperature` uses `!= null` on line 2722 but `maxTokens` doesn't — inconsistent patterns.
**Severity:** MEDIUM (inconsistency)
**Fix:** Use `!= null` for all numerical settings:
```javascript
if (s.maxTokens != null) { ... }
```

### MEDIUM-3: `renderChatInfoBar` creates orphaned DOM nodes on repeat calls

**File:** `index.html:3784-3801`
**Problem:** Each call creates a new `<div class="chat-info-bar">` but when the first child already IS a chat-info-bar, neither branch of the conditional executes — the new element is discarded (orphaned), and the old bar persists with potentially stale text.
**Severity:** MEDIUM — minor DOM leak, stale info if called outside renderMessages
**Fix:** Update existing bar in-place:
```javascript
function renderChatInfoBar(chatId) {
    const chat = conversations[chatId];
    if (!chat || !chat.messages.length) return;
    // ... build infoText ...
    let bar = msgs.querySelector('.chat-info-bar');
    if (bar) {
        bar.textContent = infoText;
    } else {
        bar = document.createElement('div');
        bar.className = 'chat-info-bar';
        bar.textContent = infoText;
        msgs.insertBefore(bar, msgs.firstChild);
    }
}
```

### MEDIUM-4: `closeSidebar()` on mobile doesn't null-check overlay element

**File:** `index.html:4520-4530`
```javascript
function closeSidebar() {
    const sb = document.getElementById('sidebar');
    if (window.innerWidth <= 700) {
        sb.classList.remove('open');
        document.getElementById('sidebar-overlay').classList.remove('show');  // No null check!
```
**Problem:** If `sidebar-overlay` is missing from the DOM, this throws `TypeError: Cannot read properties of null`. The element is in the static HTML (line 995) so it normally exists, but dynamic content replacement (e.g., someone calls `msgs.innerHTML = ...` on the wrong container) could remove it.
**Severity:** MEDIUM
**Fix:** Add optional chaining or null check.

### MEDIUM-5: `newChat()` doesn't set `totalTokens`/`totalCost`, causing unnecessary `resetFooterStats()`

**File:** `index.html:3556`
```javascript
conversations[id] = {title:'New conversation', messages:[], createdAt: Date.now(), updatedAt: Date.now(), pinned: false};
```
**Problem:** `totalTokens` and `totalCost` properties are missing. `loadChat` checks `chat.totalTokens` at line 3571 (undefined → truthy check fails → calls `resetFooterStats()`). This is handled correctly but inconsistent.
**Severity:** MEDIUM (cosmetic consistency)
**Fix:** Include the properties:
```javascript
conversations[id] = {title:'New conversation', messages:[], createdAt: Date.now(), updatedAt: Date.now(), pinned: false, totalTokens: 0, totalCost: 0};
```

---

## 4. LOW Bugs

### LOW-1: `fmtPrice()` differs between `index.html` and `update_models.js`

**File:** `index.html:3455-3460` vs `update_models.js:16-21`
**index.html version:**
```javascript
function fmtPrice(n) {
    if (n === 0) return '0';
    if (n < 0.01) return n.toFixed(4);
    if (n < 1) return n.toFixed(3);
    return n.toFixed(2);
}
```
**update_models.js version:**
```javascript
function fmtPrice(n) {
    if (n === 0) return '0';
    if (n < 0.01) return n.toFixed(4);
    const fixed = n.toFixed(3);
    return fixed.endsWith('0') ? fixed.slice(0, -1) : fixed;
}
```
**Problem:** For values >= 0.01, `update_models.js` strips trailing zeros and has no special handling for `n >= 1`. After running `update_models.js`, the static model prices in `index.html` are formatted differently than live-fetched prices. E.g., `1.50` in static vs `1.5` from live.
**Severity:** LOW
**Fix:** Make both versions identical.

### LOW-2: `handleFileAttach` and `handleRagFiles` use async forEach without awaiting

**File:** `index.html:3041-3042` and `2805-2806`
```javascript
Array.from(fileList).forEach(async f => {
```
**Problem:** The async callback fires each file's processing concurrently, but `forEach` doesn't return a promise. The `fileInput.value = ''` line at 3072/2838 runs before any file is fully processed. The `_extracting` flag is set synchronously before the async work starts, so the guard in `sendMessage` works. However, if a file is 0 bytes or unreadable, `f.text()` rejects and the catch handler runs. This works in practice but is an anti-pattern.
**Severity:** LOW
**Fix:** Use `for...of` to process files sequentially, or `Promise.allSettled` to wait for all:
```javascript
await Promise.allSettled(Array.from(fileList).map(async f => { ... }));
```

### LOW-3: `resetSettings()` clears cloud settings but sidebar doesn't reflect immediately

**File:** `index.html:2744-2770`
**Problem:** `resetSettings()` calls `resetCloudSettings()` which removes `mc_cloud_settings` and `mc_synced_at` from localStorage and updates UI elements within the settings panel, but the sidebar's sync status display (`sync-status-text`, `sync-status-icon`, `sync-now-btn`) is not updated until the next `loadCloudSettings()` call (page reload).
**Severity:** LOW
**Fix:** Call `loadCloudSettings()` or at least `updateSyncStatus('disabled', 'Cloud sync off')` after reset.

### LOW-4: `renderSearchPanel` displays empty quotes for missing query

**File:** `index.html:2441`
```javascript
: `"${queryList[0] || ''}"`;
```
**Problem:** If `queryList[0]` is falsy, the display shows `""` (empty quotation marks). This occurs for legacy history entries where `queries` might be an empty array.
**Severity:** LOW
**Fix:** Add a fallback check:
```javascript
const queryDisplay = queryList.length > 1
    ? queryList.map(q => `"${q}"`).join(' · ')
    : (queryList[0] ? `"${queryList[0]}"` : 'Search results');
```

---

## 5. Dead Code & Cleanup

### DEAD-1: `useSug()` function — never called

**File:** `index.html:4603`
```javascript
function useSug(t) { const inp=document.getElementById('chat-input'); inp.value=t; autoResize(inp); sendMessage(); }
```
**Problem:** The comment in line 1085 says "Suggestion cards call useSug() which populates the input and auto-sends." However, the welcome screen was replaced by a model info card (see comment line 568: "Model info card (replaces suggestion grid on welcome screen)"). No suggestion cards exist in the rendered DOM, and `useSug` has zero call sites.
**Severity:** N/A — dead code, safe to remove (~100 bytes)

### DEAD-2: `attach-input-dup` element — never referenced

**File:** `index.html:1391`
```html
<input type="file" id="attach-input-dup" style="display:none" multiple/>
```
**Problem:** This element is never referenced by any JavaScript. The real attach input is `#attach-input` at line 1149. The `-dup` variant is a leftover from a previous refactor.
**Severity:** N/A — dead DOM, safe to remove

### DEAD-3: `.sug-card` CSS — no elements use it

**File:** `index.html:562-563, 847`
```css
.sug-card{padding:12px 14px;background:var(--surface);...}
.sug-card:hover{border-color:var(--accent);...}
@media (max-width: 700px) { .sug-card{padding:14px;} }
```
**Problem:** The `.sug-card` class is defined in CSS but no HTML element ever has this class. The suggestion cards were removed when the model info card replaced them. The comment at line 568 confirms: "Model info card (replaces suggestion grid on welcome screen)."
**Severity:** N/A — dead CSS, safe to remove

### DEAD-4: `togglePipelineDetail()` — unreachable in normal flow

**File:** `index.html:2134-2147`
**Problem:** This function IS called from `finalizePipeline` line 2123 when the breadcrumb is clicked. However, immediately after calling `togglePipelineDetail`, the pipeline blocks are not re-shown in a useful way because `renderMessages(true)` at line 4282 replaces the entire messages DOM, destroying the blocks. The function is reachable only during a very narrow window between when the breadcrumb appears and the next `renderMessages()` call.
**Severity:** N/A — technically used but with no visible effect

---

## 6. Silent Failures (Needs Logging)

### SILENT-1: `loadChats()` JSON parse failure — no feedback

**File:** `index.html:3579-3601`
```javascript
function loadChats() {
    try {
        const s = localStorage.getItem('mc_chats');
        if (s) {
            conversations = JSON.parse(s);
            // migration...
        }
    } catch(e) {}  // ← SILENT
```
**Fix:** Add `console.error` and/or toast. This is the worst silent failure in the app since it loses all chat data with zero indication to the user.

### SILENT-2: `loadWebSearchSettings()` / `loadCloudSettings()` / `loadSectionState()` — all silent

**Files:** `index.html:1638, 1952, 2694`
**Fix:** Add `console.warn` to each. These are startup functions where failure means corrupted settings — useful for debugging user reports.

### SILENT-3: `fetchGroqViaOpenRouterProvider()` — silent failure

**File:** `index.html:3331-3333`
```javascript
} catch(e) {
    return null;
}
```
**Fix:** Add `console.warn('[MultiChat] Groq via OR provider filter failed:', e.message)`. This is an already-debug-hostile fallback path.

### SILENT-4: Stream JSON parse errors — completely hidden

**Files:** `index.html:2369, 4247`
```javascript
} catch(e) {}
```
**Problem:** During streaming, malformed JSON chunks are silently ignored. While partial tolerance is desirable, total silence makes streaming bugs extremely hard to diagnose. Non-JSON lines from misconfigured proxies produce no debug output.
**Fix:** Add a counter-limited console.warn (throttle to avoid log spam):
```javascript
} catch(e) {
    console.warn('[MultiChat] Stream parse error (non-fatal):', data?.slice(0,50), e.message);
}
```

---

## 7. Inconsistencies

### INCON-1: `fmtPrice()` implemention divergence (see LOW-1)

**Files:** `index.html:3455` vs `update_models.js:16`

### INCON-2: Variable naming — underscore prefix used inconsistently

**File:** `index.html:1537-1544`
```javascript
let _lastStats = { ... };        // has _
let _lastTokCount = 0;           // has _
let attachedFiles = [];          // no _
let ragFiles = [];               // no _
let lastSearchMeta = null;       // no _
let pipelineBlocks = [];         // no _
```
**Problem:** Some session-level state variables use `_` prefix (presumably meaning "private"), others don't. No clear pattern distinguishes the two groups.
**Severity:** Cosmetic
**Fix:** Either use `_` consistently for all internal state or remove all `_` prefixes.

### INCON-3: `if (s.maxTokens)` vs `if (s.temperature != null)` (see MEDIUM-2)

**Files:** `index.html:2722-2726`
```javascript
if (s.temperature != null) { ... }   // correct
if (s.maxTokens) { ... }             // wrong (0 is falsy)
```
**Severity:** Minor inconsistency

### INCON-4: `saveChats()` error handling differs from `saveSettings()`

`saveChats()` (line 3577): Empty catch, no fallback.
`saveSettings()` (line 2700): No try/catch at all — will throw and propagate.
`saveWebSearchSettings()` (line 1591): No try/catch.
**Fix:** Standardize error handling for all localStorage writes — at minimum, wrap in try/catch with console.warn.

---

## Summary Table

| ID | Severity | Category | Description |
|----|----------|----------|-------------|
| CRITICAL-1 | CRITICAL | XSS | `fmtText()` injects unescaped content into HTML |
| CRITICAL-2 | CRITICAL | XSS | `updateStreamRow` uses vulnerable `innerHTML` |
| HIGH-1 | HIGH | Bug | `send-btn` permanently disabled if extraction hangs |
| HIGH-2 | HIGH | Silent Fail | Empty catch/loss of all chats on corrupt localStorage |
| HIGH-3 | HIGH | Bug | Cloud sync uploaded stale data on save failure |
| HIGH-4 | HIGH | Bug | Pull-to-refresh prevention doesn't work (inverted logic) |
| MEDIUM-1 | MEDIUM | Race | Slider input can clobber web search toggle state |
| MEDIUM-2 | MEDIUM | Bug | `maxTokens` truthy check wrong for value 0 |
| MEDIUM-3 | MEDIUM | DOM Leak | `renderChatInfoBar` creates orphaned DOM nodes |
| MEDIUM-4 | MEDIUM | Bug | `closeSidebar` missing null check on overlay |
| MEDIUM-6 | MEDIUM | Consistency | `newChat()` missing `totalTokens`/`totalCost` fields |
| LOW-1 | LOW | Bug | `fmtPrice` differs between `index.html` and `update_models.js` |
| LOW-2 | LOW | Pattern | Async forEach used without awaiting |
| LOW-3 | LOW | UX | Reset settings doesn't refresh sidebar sync status |
| LOW-4 | LOW | Bug | `renderSearchPanel` displays empty quotes for missing query |
| DEAD-1 | N/A | Dead Code | `useSug()` — never called |
| DEAD-2 | N/A | Dead Code | `attach-input-dup` element — never referenced |
| DEAD-3 | N/A | Dead Code | `.sug-card` CSS — no matching elements |
| DEAD-4 | N/A | Dead Code | `togglePipelineDetail()` — effectively unreachable |
| SILENT-1 | HIGH | Silent Fail | `loadChats()` — entire chat history silently lost |
| SILENT-2 | MEDIUM | Silent Fail | Multiple load-functions with empty catches |
| SILENT-3 | MEDIUM | Silent Fail | Groq fallback failure hidden |
| SILENT-4 | MEDIUM | Silent Fail | Stream parse errors produce zero diagnostic output |
| INCON-1 | LOW | Inconsistency | `fmtPrice` divergence |
| INCON-2 | LOW | Inconsistency | Underscore prefix used inconsistently |
| INCON-3 | LOW | Inconsistency | Truthy vs `!= null` for settings values |
| INCON-4 | LOW | Inconsistency | localStorage error handling not standardized |