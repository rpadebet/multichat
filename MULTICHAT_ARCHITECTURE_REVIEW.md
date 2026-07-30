# MultiChat Architecture Review

**Scope**: `index.html` (4668 lines), `sw.js`, `manifest.json`, `proxy.js`, `update_models.js`
**Date**: 2026-07-30
**Reviewer**: Oracle (strategic technical advisor)

---

## 1. Critical Risks

### 1.1 Stored XSS via `fmtText` markdown renderer

**Current state**: `fmtText()` at line 4435 converts markdown-lite to HTML. Code blocks and inline code are escaped via `esc()`:
```js
text = text.replace(/```(\w*)\n?([\s\S]*?)```/g, (_,l,c) => `<pre><code>${esc(c.trim())}</code></pre>`);
text = text.replace(/`([^`\n]+)`/g, (_,c) => `<code>${esc(c)}</code>`);
```
But headings, bold, italic, blockquotes, and list items capture raw text in `$1` and inject it into HTML **without escaping**:
```js
text = text.replace(/^### (.+)$/gm,'<h3>$1</h3>');
text = text.replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>');
text = text.replace(/\*(.+?)\*/g,'<em>$1</em>');
text = text.replace(/^> (.+)$/gm,'<blockquote>$1</blockquote>');
```
The result is assigned via `innerHTML` in `buildMsgHTML()` (line 3973) and `updateStreamRow()` (line 4380).

**Problem**: A model response containing `**<img src=x onerror=alert(1)>**` or `# <script>...</script>` executes arbitrary HTML/JS in the user's browser. Three attack vectors:
1. **Prompt injection** — a malicious webpage (via web search snippets) or crafted user input causes the model to emit raw HTML.
2. **Cloud sync** — a compromised device pushes a chat with malicious `content` that renders on the victim device.
3. **RAG files** — file content is injected into the system prompt; a crafted file could cause the model to echo HTML.

Since API keys live in `localStorage` and are readable by any JS running in the page, this XSS is a **credential exfiltration** path. Combined with the cloud-sync passphrase also in `localStorage`, an attacker could decrypt all synced chats.

**Recommendation**: Escape the entire text first, then apply markdown transformations to the escaped text. The code-block regexes already call `esc()` on their captures; extend the same to all captures:
```js
function fmtText(text, searchMeta) {
  if (!text) return '';
  text = esc(text); // escape everything first
  // then apply markdown — the escaped entities are inert inside tags
  text = text.replace(/```(\w*)\n?([\s\S]*?)```/g, ...); // already escaped, no double-esc
  // ...
}
```
Tradeoff: code blocks currently call `esc(c.trim())` — escaping first means removing those inner `esc()` calls to avoid double-escaping. This is the standard safe pattern for markdown renderers. Add a unit test for `<script>`, `<img onerror>`, and `javascript:` payloads.

### 1.2 No way to abort a streaming request

**Current state**: `sendMessage()` (line 4041) uses `fetch()` with no `AbortController`. The `isStreaming` flag (line 1539) only guards against starting new sends. There is no stop/cancel button. The `finally` block (line 4293) resets `isStreaming` only after the stream naturally completes or errors.

**Problem**: A long-running or runaway response (e.g., a model stuck in a loop, or a user who realizes they asked the wrong question) cannot be stopped. The user must wait for the model to finish or close the tab. Tokens continue to accrue cost. If the user closes the tab, the `chat.messages` array already has the partial `aiMsg` pushed (line 4230) but `saveChats()` is only called on completion (line 4289) — so the partial message is lost on reload, but the API call already consumed the budget.

**Recommendation**: Add an `AbortController` stored as a module-level var (`let _streamController = null`). Pass `signal: _streamController.signal` to `fetch()`. Change the send button to a stop button while streaming (or add a separate stop button). On abort, finalize the partial message (keep what was received so far), save, and re-render. Handle `AbortError` distinctly from other errors in the catch block.

### 1.3 `saveChats()` silently swallows `QuotaExceededError`

**Current state**: Line 3577:
```js
function saveChats() { try { localStorage.setItem('mc_chats', JSON.stringify(conversations)); } catch(e) {} debouncedPushSync(); }
```

**Problem**: `localStorage` has a 5–10 MB limit. `JSON.stringify(conversations)` serializes **every conversation including all message content**. A user with many long chats will hit this limit. The `catch(e) {}` silently discards the error. The user continues chatting, believing their data persists, but every subsequent `saveChats()` also fails silently. On reload, they lose everything since the last successful save. The `debouncedPushSync()` still fires, but it serializes the same oversized payload — and `encryptSync` will also fail or produce a payload Supabase may reject.

**Recommendation**: 
1. Surface the error: `catch(e) { if (e.name === 'QuotaExceededError') showToast('Storage full — older chats may not be saved. Delete unused chats.', 'err'); }`
2. Add a size guard: before `setItem`, estimate `JSON.stringify(conversations).length` and warn at ~4 MB.
3. Consider per-chat storage (key per conversation) so a single large chat doesn't block all saves. This also enables partial sync. Tradeoff: more complex migration and listing logic.

### 1.4 Cloud sync last-write-wins per chat loses concurrent edits

**Current state**: `pullSync()` (line 1821) merges remote and local chats by `updatedAt`:
```js
if (remoteChatTime > localChatTime) {
  merged[id] = remoteChat;
}
```

**Problem**: If device A and device B both edit the same chat (e.g., A sends a message at T=100, B sends a message at T=101), the next pull on A replaces A's entire chat with B's version — A's message is lost. There is no message-level merge, no conflict detection, and no warning to the user. The merge is also vulnerable to clock skew: if device B's clock is behind, B's older state overwrites A's newer state.

**Recommendation**: 
- **Short term**: Merge at the message level (union by message index/content hash) rather than replacing the whole chat. Keep the most recent `updatedAt` on the merged chat.
- **Medium term**: Add a `clientId` to each message and merge by `(clientId, timestamp)` so messages from different devices coexist.
- **Long term**: Consider a CRDT or operational transform approach if concurrent editing becomes common. For now, at minimum, detect conflicts (both sides modified the same chat since last sync) and warn the user rather than silently dropping data.

### 1.5 Hardcoded PBKDF2 salt for cloud sync encryption

**Current state**: `deriveKey()` at line 1711:
```js
const salt = enc.encode('multichat-sync-salt-v1');
```

**Problem**: The salt is identical for all users. An attacker who obtains the encrypted payload from Supabase (which only requires the anon key, stored in `localStorage`) can precompute a rainbow table for common passphrases once, then decrypt any user's data. The 100,000 PBKDF2 iterations help, but a fixed salt defeats the per-user uniqueness that salts are meant to provide.

**Recommendation**: Generate a random 16-byte salt per user on first sync, store it alongside the ciphertext in Supabase (e.g., `salt` column in `sync_data`), and use it for key derivation. This is a breaking change — require a re-sync (re-encrypt with the new key) on first load after the update. Tradeoff: one-time migration friction.

---

## 2. Structural Improvements

### 2.1 Single-file at 4668 lines — navigation and cognitive load

**Current state**: CSS (~960 lines, 21–979), HTML (~440 lines, 980–1421), JS (~3244 lines, 1422–4666) all in `index.html`. The "copy one file to host anywhere" value prop is real and documented in AGENTS.md.

**Problem**: The file is large enough that:
- Editor folding/search is mandatory for navigation.
- Merge conflicts are frequent (everyone edits the same file).
- Code review diffs are hard to read (a CSS change and a JS change in the same file).
- The `update_models.js` script uses regex to mutate this file (line 96–103) — fragile.

**Recommendation**: Do **not** split into separate files (that breaks the value prop). Instead:
1. **Add region markers** with consistent prefixes (e.g., `/* === THEME === */`, `// === STATE === */`) — already partially done; make it exhaustive and add a table of contents comment at the top.
2. **Extract the static model registry** (`PROVIDERS` object, lines 1430–1529) into a separate `models.js` loaded via `<script src="models.js">`. This is the most frequently mutated section (via `update_models.js`), it's pure data, and it changes independently of the app logic. The SW cache list already supports multiple files. Tradeoff: two files to copy instead of one — but `models.js` is auto-generated and rarely hand-edited.
3. **Consider extracting `proxy.js`-bound logic** (CORS headers, proxy URL) into a small `config.js` so the proxy endpoint isn't hardcoded in the 4668-line file.

### 2.2 State scattered across module vars, localStorage, and DOM

**Current state**: State lives in three places:
- **Module vars** (line 1537–1544): `conversations`, `currentChatId`, `isStreaming`, `attachedFiles`, `ragFiles`, `lastSearchMeta`, `_lastStats`, `pipelineBlocks`, `streamTextEl`.
- **localStorage**: `mc_chats`, `mc_settings`, `mc_theme`, `key_*`, `mc_cloud_settings`, `mc_synced_at`, `mc_search_url`, `mc_proxy_key`, `mc_settings_sections`, `mc_ui_scale_*`, `mc_last_provider`, `mc_last_model_*`, `mc_pwa_dismissed`.
- **DOM**: `prov-sel.value`, `model-sel.value`, `show-think.checked`, `system-prompt.value`, `temp-range.value`, etc.

**Problem**: No single source of truth. Settings are read from DOM in `getSettings()` (line 2774) but from localStorage in `updateSearchIndicator()` (line 1687). `saveSettings()` (line 2700) reads from DOM and writes to localStorage, but `saveWebSearchSettings()` (line 1591) does the same for a different subset. If a slider's `oninput` handler fires `saveSettings()` while `loadWebSearchSettings()` is reading from localStorage, there's a race where web search settings can be clobbered (the code explicitly works around this at line 2703–2706, which is a smell).

**Recommendation**: Introduce a single `state` object that is the source of truth for all settings. DOM elements read from and write to `state`; `state` persists to localStorage via a single `persist()` function. This eliminates the read-from-DOM-vs-localStorage inconsistency. Example:
```js
const state = { settings: {...}, ui: {...}, cloud: {...} };
function persist() { localStorage.setItem('mc_settings', JSON.stringify(state.settings)); }
// DOM oninput handlers call state.settings.temperature = parseFloat(this.value); persist();
```
Tradeoff: requires a one-time migration of all read/write sites. Worth it for the consistency gain.

### 2.3 `renderMessages` and `renderMsgsFromArr` are near-duplicates

**Current state**: `renderMessages()` (line 3892) and `renderMsgsFromArr()` (line 3938) are almost identical. The only difference: `renderMessages` reads from `conversations[currentChatId].messages` while `renderMsgsFromArr` takes a `messages` parameter.

**Problem**: Any change to rendering logic (e.g., adding a new message decoration) must be made in two places. Bugs will diverge between the two.

**Recommendation**: Delete `renderMsgsFromArr` and have `renderMessages` call a shared `renderMessagesArray(messages, preserveScroll)` helper. `renderMessages` just does `const chat = conversations[currentChatId]; if (!chat) return showWelcome(); renderMessagesArray(chat.messages, preserveScroll);`.

### 2.4 Function monkey-patching for mobile sidebar

**Current state**: Lines 4550–4570 patch `window.loadChat`, `window.newChat`, and `window.setTheme` after they're defined:
```js
const _origLoadChat = loadChat;
window.loadChat = function(id) { _origLoadChat(id); if (window.innerWidth <= 700) closeSidebar(); };
```

**Problem**: This is fragile. If `loadChat` is renamed, the patch silently breaks (the original is captured by reference). If another agent adds a third patch, the chain becomes hard to follow. The `setTheme` patch also redundantly sets `meta.content` twice (line 4567 and 4569).

**Recommendation**: Move the mobile-sidebar-close logic directly into `loadChat` and `newChat`:
```js
function loadChat(id) {
  currentChatId = id;
  renderChatList();
  renderMessages();
  renderChatInfoBar(id);
  if (window.innerWidth <= 700) closeSidebar(); // inline
  // ...
}
```
For `setTheme`, merge the theme-color meta update into the function itself.

### 2.5 Provider abstraction is inconsistent

**Current state**: Adding a provider requires touching:
1. `PROVIDERS` object (line 1430) — static model list, URL, badge.
2. `LIVE_PROVIDERS` set (line 3105) — whether `/models` is fetchable.
3. `formatLiveModels()` (line 3345) — provider-specific branch with different response parsing.
4. `fetchLiveModels()` (line 3230) — provider-specific CORS/key handling.
5. `proxyHeaders()` calls (line 2333, 3240) — whether to add `x-proxy-key`.
6. Badge CSS (lines 284–289, 399–418) — `.badge-*` and `.mb-*` classes per provider.
7. `loadKeys()` (line 2615) — hardcoded provider list.
8. `<select id="prov-sel">` in HTML (line 1080) — manual option.
9. `providerFromModel()` (line 3835) — heuristic mapping.
10. `providerIcon()` (line 3845) — emoji map.

**Problem**: There is no provider interface; each provider is a special case. The Groq OpenRouter fallback (`fetchGroqViaOpenRouter`, line 3278) is Groq-specific. The NeuralWatt flex tier (line 2330, 2344) is NeuralWatt-specific. The OpenCode proxy header (line 2333) is OpenCode-specific.

**Recommendation**: Define a provider interface:
```js
const providerInterface = {
  id, label, badge, url, usageUrl,
  needsProxy: false,        // whether to send x-proxy-key
  needsKey: true,           // whether /models requires auth
  liveModels: true,          // whether LIVE_PROVIDERS should include it
  formatModels: (raw) => [...],
  extraPayload: (settings) => ({}),  // e.g., NeuralWatt flex
  fallbackModels: () => [...],      // e.g., Groq via OpenRouter
};
```
Then `PROVIDERS` becomes a map of these objects, and `formatLiveModels`, `fetchLiveModels`, `proxyHeaders` dispatch via the interface. This makes adding a provider a single-object change. Tradeoff: a refactor of ~200 lines; worth it once a 5th or 6th provider is added.

---

## 3. Performance

### 3.1 `updateStreamRow` runs `fmtText` on every token — O(n²)

**Current state**: `updateStreamRow()` (line 4370):
```js
streamTextEl.innerHTML = fmtText(stripThink(msg.content));
```
This is called on every SSE delta (line 4247 area). `fmtText` runs 10+ regex replacements on the **entire accumulated content**. For a 2000-token response (~8000 chars), `fmtText` is called 2000 times, each processing an increasingly long string.

**Problem**: This is O(n²) in the response length. A long response (e.g., 4000 tokens) will cause noticeable jank on mobile devices. The `innerHTML` assignment also forces a full DOM parse and layout recalculation each time.

**Recommendation**: 
1. **Throttle updates**: Only call `updateStreamRow` every ~50ms (e.g., via `requestAnimationFrame` or a timestamp guard). Accumulate deltas in `msg.content` but only re-render at the throttled interval.
2. **Append-only rendering**: Instead of re-running `fmtText` on the full content, append raw text to a `textContent` node during streaming, and run `fmtText` once when the stream completes. The final `renderMessages(true)` call (line 4289) already does this — the streaming view just needs to show plain text, not formatted markdown.
3. **Use `textContent` during streaming**: `streamTextEl.textContent = stripThink(msg.content)` is O(1) per token and avoids HTML parsing. Apply `fmtText` only on stream completion.

### 3.2 `renderMessages` rebuilds entire DOM from scratch

**Current state**: `renderMessages()` (line 3892) builds an HTML string for all messages and assigns `msgs.innerHTML = html` (line 3915). Called after every stream completes and after edits.

**Problem**: For a 200-message conversation, this creates 200 DOM nodes from a string. The browser must parse the HTML, build the DOM tree, and layout. On mobile, this can take 100ms+ for long chats, causing a visible freeze after each response.

**Recommendation**: 
1. **Incremental append**: After a stream completes, only append the new message row instead of rebuilding all. The streaming row (`#stream-row`) is already in the DOM — just finalize it in place and skip the full `renderMessages(true)` call.
2. **DocumentFragment for initial load**: When switching chats, build the HTML string but parse it via `DOMParser` and append a `DocumentFragment` — this is faster than `innerHTML` for large strings in some browsers.
3. **Virtualization (long term)**: For very long chats (500+ messages), only render messages near the scroll position. This is a larger effort but necessary if users accumulate long conversations.

### 3.3 `saveChats` serializes all conversations on every save

**Current state**: Line 3577: `localStorage.setItem('mc_chats', JSON.stringify(conversations))`. Called after every message send, edit, pin, and delete.

**Problem**: `JSON.stringify(conversations)` serializes every chat including all message content. For a user with 50 chats averaging 100 messages, this is several MB of JSON on every send. This is both slow (50ms+) and contributes to the `QuotaExceededError` risk (§1.3).

**Recommendation**: 
1. **Debounce saves**: `saveChats` is already debounced for cloud sync (`debouncedPushSync`, line 3577), but the localStorage write is immediate. Debounce the localStorage write too (e.g., 500ms after the last change).
2. **Per-chat storage**: Store each chat under `mc_chat_<id>` instead of all under `mc_chats`. Then `saveChats` only serializes the current chat. `loadChats` iterates keys with prefix `mc_chat_`. This also enables partial cloud sync. Tradeoff: migration logic for existing users.

### 3.4 No virtualization for chat list or message list

**Current state**: `renderChatList()` (line 3605) builds an HTML string for all chats. `renderMessages()` builds for all messages. All DOM nodes are live.

**Problem**: A user with 200 chats or a 500-message conversation has all nodes in the DOM. Scrolling is fine (browser handles it), but initial render and re-renders are slow.

**Recommendation**: This is a lower priority than §3.1–§3.3. For the chat list, consider rendering only the visible groups (Today, Yesterday, etc.) and lazy-loading older groups on scroll. For messages, virtualization (e.g., `IntersectionObserver` to mount/unmount rows) would help very long conversations. Defer until performance complaints arise.

---

## 4. Security

### 4.1 API keys in `localStorage` in plaintext

**Current state**: `saveKey()` (line 2595): `localStorage.setItem('key_'+p, v.trim())`. Keys for Groq, OpenRouter, OpenCode, NeuralWatt, and the proxy are stored unencrypted.

**Problem**: Any XSS (see §1.1) can read `localStorage` and exfiltrate all keys. `localStorage` is also accessible to browser extensions and other tabs on the same origin (though same-origin policy limits this).

**Recommendation**: 
1. **Fix the XSS first** (§1.1) — this is the primary attack vector.
2. **Consider `sessionStorage` for ephemeral use** — but this breaks persistence across reloads, which users expect.
3. **Consider the Web Crypto API for at-rest encryption** — encrypt keys with a passphrase-derived key, decrypt on load. This adds UX friction (passphrase prompt on every load). Tradeoff: security vs. convenience. For a client-side-only app with no server, this is the strongest option.
4. **At minimum, add a CSP** (see §4.5) to reduce XSS risk.

### 4.2 Cloud sync passphrase stored in `localStorage`

**Current state**: `saveCloudSettings()` (line 1914): `localStorage.setItem('mc_cloud_settings', JSON.stringify(s))` where `s` includes `passphrase`.

**Problem**: The passphrase that encrypts all synced chats is stored in plaintext in `localStorage`. Combined with the XSS vulnerability, an attacker can read the passphrase and decrypt all cloud-synced data. Even without XSS, anyone with physical access to the device can read it.

**Recommendation**: Do not persist the passphrase. Prompt for it on each load (or use `sessionStorage` so it clears on tab close). Cache the derived key in memory only. Tradeoff: UX friction on every load. Alternatively, use the OS-level credential store (WebAuthn / Credential Management API) if available.

### 4.3 `esc()` does not escape single quotes

**Current state**: Line 4589:
```js
function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
```

**Problem**: Single quotes (`'`) are not escaped. They are used in inline `onclick` handlers throughout the app, e.g., `onclick="loadChat('${id}')"` (line 3628). Chat IDs are currently `'c' + Date.now()` (safe), but `confirmDelete('${id}', ...)` (line 3624) and `togglePin('${id}')` (line 3634) also use single quotes. If any ID ever contains a single quote (e.g., from a future ID scheme or a cloud-sync import), it breaks out of the attribute and injects JS.

**Recommendation**: Add `.replace(/'/g,'&#39;')` to `esc()`. This is a one-line fix with no downside. Also consider moving away from inline `onclick` handlers to `addEventListener` with `data-*` attributes, which eliminates the entire class of attribute-breakout vulnerabilities.

### 4.4 No Content Security Policy

**Current state**: No `<meta http-equiv="Content-Security-Policy">` tag. The page uses inline `<script>` (lines 14–18, 1422–4666) and inline event handlers (`onclick`, `oninput`, `onchange` throughout the HTML).

**Problem**: Without a CSP, any XSS (see §1.1) can execute arbitrary scripts, load external resources, and exfiltrate data. A CSP would limit the damage even if an XSS is found.

**Recommendation**: Add a CSP meta tag:
```html
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; connect-src 'self' https://api.groq.com https://openrouter.ai https://proxy.opencodechat.dpdns.org https://api.tavily.com https://google.serper.dev https://*.supabase.co; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:;">
```
`'unsafe-inline'` is required for script-src because of inline handlers, but `connect-src` restricts where `fetch` can send data — this prevents an XSS from exfiltrating keys to an attacker's server. Tradeoff: must update `connect-src` when adding a new provider. Long term, move inline handlers to `addEventListener` to drop `'unsafe-inline'` for scripts.

### 4.5 Proxy key is a shared secret, not per-user auth

**Current state**: `proxy.js` (line 6): `const PROXY_KEY = process.env.PROXY_KEY || null`. If set, every request must include `x-proxy-key: <key>`. The same key is used by all users.

**Problem**: The proxy key is stored in `localStorage` (`mc_proxy_key`) and sent as a header. If any user's key is compromised (via XSS or device access), all users' requests through the proxy are exposed. There is no key rotation, no rate limiting, and no per-user identification.

**Recommendation**: This is acceptable for a personal proxy. If the proxy is shared:
1. Add rate limiting in `proxy.js` (e.g., 100 requests/minute per IP).
2. Generate per-user keys and store them server-side.
3. Add request logging for audit.
For now, document that the proxy key is a shared secret and should be rotated if compromised.

---

## 5. Operational

### 5.1 Manual Service Worker cache version bump is error-prone

**Current state**: `sw.js` line 1: `const CACHE = 'multichat-v27'`. AGENTS.md says to bump this on every non-trivial change. The SW registration is cache-busted (`./sw.js?v=${Date.now()}` in `index.html` line ~4450), so the browser always fetches the latest `sw.js`.

**Problem**: Forgetting to bump `CACHE` means returning users get the old `index.html` from the Cache API even after a deploy. The cache-bust on `sw.js` ensures the new SW is registered, but `caches.match(e.request)` (line 78) still returns the old cached `index.html` because the cache name hasn't changed. The `activate` handler (line 58) only deletes caches with different names.

**Recommendation**: Automate the cache version bump:
1. **GitHub Action**: Add a workflow that bumps `CACHE` on every push to `main` by reading the current version, incrementing it, and committing. Or compute a hash of `index.html` and use it as the cache version.
2. **Build-time injection**: If you ever add a build step, inject the git SHA as the cache version.
3. **Runtime self-update**: In the SW `install` handler, fetch `index.html` and compare its hash to the cached version; if different, skipWaiting. This is more complex but eliminates the manual step.

### 5.2 No test suite

**Current state**: AGENTS.md states "There is no test suite. Verification is manual."

**Problem**: The most fragile parts — `fmtText` (markdown rendering), `chunkText` (RAG chunking), `detectSearchNeeded` (regex heuristics), `planSearchQueries` (JSON parsing), and the cloud sync merge logic — have no automated tests. Regressions are caught only by manual testing.

**Recommendation**: Add a minimal test setup that fits the no-build-tool constraint:
1. **Unit tests in a separate `test.html`**: A plain HTML file that loads `index.html`'s JS via a `<script>` tag (or extracts functions to a testable module) and runs assertions with a tiny inline test runner. Open `test.html` in a browser to run.
2. **Priority targets**: `fmtText` (XSS payloads, markdown edge cases), `chunkText` (boundary conditions), `detectSearchNeeded` (true/false cases), `esc` (all special chars), `pullSync` merge logic (mock Supabase).
3. **Alternative**: If you're willing to add Node.js as a dev dependency, use `vitest` with `jsdom` to test the pure functions (`fmtText`, `chunkText`, `esc`, `detectSearchNeeded`) without a browser. These don't depend on DOM. The DOM-dependent functions can be tested with `happy-dom` or `playwright`.

### 5.3 `update_models.js` mutates `index.html` via regex

**Current state**: `update_models.js` (lines 96–103) uses regex to find and replace the `PROVIDERS.openrouter.models` and `PROVIDERS.opencode.models` arrays in `index.html`:
```js
const orRegex = /openrouter:\{label:'OpenRouter',badge:'badge-openrouter',usageUrl:'[^']+',url:'https:\/\/openrouter\.ai\/api\/v1',models:\[([\s\S]*?)\]\}/;
```

**Problem**: If the format of the `PROVIDERS` object changes (e.g., adding a field, changing quote style, reformatting), the regex breaks silently — it matches nothing, and `indexHtml.replace(orRegex, ...)` returns the original string unchanged. The script reports success (`Successfully updated index.html`) even if no replacement happened.

**Recommendation**: 
1. **Verify the match**: After `indexHtml.replace(orRegex, ...)`, check if the string changed. If not, throw an error: `throw new Error('OpenRouter regex did not match — check PROVIDERS format in index.html')`.
2. **Extract models to `models.js`** (see §2.1): If the model registry is in a separate JS file, `update_models.js` can `require('./models.js')`, mutate the object, and write it back via `JSON.stringify` — no regex needed.
3. **Add a dry-run mode**: `node update_models.js --dry-run` prints the diff without writing.

### 5.4 Silent error swallowing in 7 places

**Current state**: `grep` found 7 instances of `catch(e) {}` (lines 1638, 1952, 2694, 2738, 3577, 3599, 4247). Notable ones:
- Line 3577 (`saveChats`): see §1.3.
- Line 4247 (SSE parsing): `try { const j = JSON.parse(data); ... } catch(e) {}` — silently drops malformed SSE chunks. This is acceptable for streaming (partial JSON is expected mid-stream), but should at least log in dev mode.
- Line 1638 (`loadWebSearchSettings`): silently fails if `mc_settings` JSON is corrupted.

**Problem**: Errors are invisible. If `mc_settings` gets corrupted (e.g., by a buggy deploy), the user's settings silently reset to defaults with no indication. If `saveChats` fails (quota), data is lost silently.

**Recommendation**: Replace `catch(e) {}` with `catch(e) { console.warn('[context]', e); }` at minimum. For user-facing failures (`saveChats`, `loadChats`, `loadSettings`), show a toast. For streaming JSON parse errors, a debug log is sufficient.

---

## 6. Future-proofing

### 6.1 Adding a new provider — 10 touch points

**Current state**: See §2.5. Adding a provider requires changes in 10 locations.

**Recommendation**: Implement the provider interface described in §2.5. Once done, adding a provider is a single object in `PROVIDERS` plus a CSS badge class. The interface handles: live model fetching, CORS/proxy headers, response formatting, and extra payload fields.

### 6.2 Adding a new search engine — relatively clean

**Current state**: `SEARCH_PROVIDERS` (line 1553) maps provider IDs to labels and key names. `executeSearch()` (line 2290) dispatches to `searchTavily`, `searchSerper`, `searchSearXNG`. Settings UI is in the HTML.

**Problem**: Adding a search engine requires: (1) adding to `SEARCH_PROVIDERS`, (2) adding a `searchX()` function, (3) adding a branch in `executeSearch`, (4) adding an `<option>` in the HTML. This is manageable but could be cleaner.

**Recommendation**: Define a search provider interface similar to the provider interface (§2.5):
```js
const searchProviderInterface = { id, label, keyName, costNote, search: (query, key) => [...] };
```
Then `executeSearch` just calls `SEARCH_PROVIDERS[provider].search(query, key)`. Adding a provider is one object. Low priority — the current structure is acceptable for 3 providers.

### 6.3 Adding a new theme — clean

**Current state**: Themes are CSS custom property blocks (lines 30–120). Adding a theme requires: (1) a `[data-theme="X"]` block, (2) a `<button class="theme-btn" data-theme="X">` in HTML, (3) an entry in `THEME_COLORS` (line 4555).

**Problem**: Minimal. The CSS custom property approach is well-designed.

**Recommendation**: No change needed. Consider auto-generating theme buttons from a `THEMES` JS array to avoid the HTML/JS split, but this is cosmetic.

### 6.4 Message-level cloud sync

**Current state**: Cloud sync is per-chat (entire `conversations` object encrypted and uploaded). See §1.4.

**Problem**: No way to sync partial conversations or resolve message-level conflicts.

**Recommendation**: Long-term, move to message-level sync with a `clientId` + `timestamp` on each message. Each message is an upsertable row in Supabase. This enables proper conflict resolution and partial sync. This is a significant refactor — defer until the current per-chat merge causes documented data loss.

### 6.5 `providerFromModel` heuristic is fragile

**Current state**: `providerFromModel()` (line 3835) tries to find which provider owns a model ID by iterating `PROVIDERS` and checking `m.id === modelId`. If a model exists in multiple providers (e.g., `kimi-k2.6` is in both `opencode` and `neuralwatt`), the `preferred` array (line 3838) determines priority.

**Problem**: The heuristic breaks if a model ID is ambiguous or if the static registry is stale (a model exists live but not in the static list). The `aiMsg.provider` field is set at send time (line 4230) but `providerFromModel` is used as a fallback in `buildMsgHTML` (line 3967) for historic messages that predate the `provider` field.

**Recommendation**: Always store `provider` on the assistant message at send time (already done at line 4230). For historic messages without `provider`, the heuristic is a best-effort fallback — document it as such. Consider storing the provider URL too, so the message is self-describing.

---

## Summary of Priorities

| Priority | Item | Effort | Impact |
|----------|------|-------|--------|
| **P0** | Fix `fmtText` XSS (§1.1) | Small | Critical — prevents credential theft |
| **P0** | Add `AbortController` for streaming (§1.2) | Small | High — UX + cost control |
| **P0** | Surface `saveChats` quota errors (§1.3) | Small | High — prevents silent data loss |
| **P1** | Add CSP (§4.4) | Small | High — limits XSS blast radius |
| **P1** | Fix `esc()` single-quote escaping (§4.3) | Trivial | Medium — latent XSS |
| **P1** | Throttle `updateStreamRow` (§3.1) | Small | High — mobile perf |
| **P1** | Automate SW cache bump (§5.1) | Medium | Medium — prevents stale deploys |
| **P2** | Random PBKDF2 salt (§1.5) | Medium | Medium — crypto hardening |
| **P2** | Message-level cloud sync merge (§1.4) | Medium | Medium — prevents data loss |
| **P2** | Provider interface (§2.5, §6.1) | Large | Medium — extensibility |
| **P2** | Add unit tests for `fmtText`, `chunkText`, `esc` (§5.2) | Medium | High — regression safety |
| **P3** | Single `state` object (§2.2) | Large | Medium — consistency |
| **P3** | Per-chat localStorage (§3.3) | Large | Medium — perf + quota |
| **P3** | Extract `models.js` (§2.1) | Small | Low — maintainability |

**Top 3 to do this week**: Fix `fmtText` XSS, add `AbortController`, surface `saveChats` errors. These are small changes with outsized risk reduction.