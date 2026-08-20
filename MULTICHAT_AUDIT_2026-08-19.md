# MultiChat Audit — 2026-08-19

**Scope:** `index.html` (5135 lines), `models.js` (91), `sw.js` (85), `proxy.js` (112), `update_models.js` (116), `test.js` (807), `manifest.json`, `package.json`
**Model:** `opencode-go/muse-spark-1.2-contributor` (orchestrator + fixer) — verified `~/.config/opencode/oh-my-opencode-slim.json:56,104`
**Status:** Plan approved — implementation gated on this doc.
**Prior audits cross-checked:** `MULTICHAT_BUG_HUNT.md` (2026-07-30), `MULTICHAT_ARCHITECTURE_REVIEW.md` (2026-07-30), `MULTICHAT_UI_UX_REVIEW.md` (2026-07-30) + changelog in `AGENTS.md` through `multichat-v38`.

---

## 0. Executive summary

~60% of July-30 findings are now fixed (XSS, `esc` `'`, CSP, AbortController, 30s extract timeout, compaction, IndexedDB migration with `fake-indexeddb` dual-run, `focus-visible`, `prefers-reduced-motion`, theme contrast, `hover:none`, drag-drop on `input-area`, `rAF` throttling). This audit finds **no remaining critical XSS** but **one critical SSRF** in the proxy and several high data-correctness regressions in the model registry and context window logic. Largest execution risk is the provider abstraction sprawl (10 touch-points per provider) — fixed in Phase 4 behind a feature interface so Phase 1 patches don't depend on it.

**Total open items:** 12 bugs (1 critical, 4 high, 5 medium, 2 low) + 18 enhancements. Estimated fix path: 4 phases, ~30h, critical path 14h.

---

## 1. Bugs — verified open vs. fixed

### 1.1 Fixed since July 30 (do not re-fix)

| ID | File | Fix evidence |
|----|------|--------------|
| XSS-CRITICAL-1/2 | `index.html:4854-4898` `fmtText` | Escapes entire text before markdown (`esc()` then `^###` etc.), code-block stash, `esc` now includes `'` `index.html:5045` |
| SILENT empties | `index.html:1950,2694,2742,3920` | Replaced `catch(e){}` with `console.warn`+toast |
| ABORT | `index.html:4397-4422` | `AbortController` + stop button `updateSendButtonState` |
| QUOTA | `index.html:3891-3923` | Compaction retry + cloud fallback + meter `index.html:2658-2696` |
| PULL-GUARD | `index.html:5002-5007` | Inverted to `scrollTop<=0 => preventDefault` (but see new B-PULL-LOCK below) |
| RACE-SLIDER | `index.html:2760-2771` | `saveSettings` merges `...existing, ...s` preserving `webSearch*` |
| FOCUS | `index.html:182-184` | `*:focus-visible` + input override |
| REDUCED-MOTION | `index.html:224-231` | `prefers-reduced-motion` disables `msgIn`/`badgePulse`/`tdot` |
| CONTRAST | `index.html:32-44` etc. | `--text3` `#7a7068`/`#6e6e6e`/`#787886` meets 4.5:1 |
| TOUCH-HOVER | `index.html:218-222` | `@media (hover:none)` forces `opacity:1` on actions |
| IDB+MIGRATION | `index.html:3764-3890` + `test.js:86-91,741-774` | `persistChats`/`readPersistedChats` + legacy `mc_chats` migration + empty-IDB guard + dual test run |
| COMPACTION | `index.html:3672-3716` | `leanAttachment` + `grouped`-wins + `compactChats` on load/pull/quota |
| SYNC-GATE | `index.html:1739-1775` | `SYNC_PAYLOAD_LIMIT 8MB` + `_syncSizeWarned` |
| PBKDF2-SALT | `index.html:1680-1713` | Random 16B salt per `encryptSync` → `salt:iv:cipher`, legacy `iv:cipher` read |

### 1.2 Open bugs (this audit)

#### 🔴 CRITICAL

**B-PROXY-SSRF — Open proxy SSRF** `proxy.js:89-98,103,52-69`
- Generic endpoint `GET /proxy?url=<any>` copies all headers and forwards to arbitrary host. No allow-list. When `PROXY_KEY` is unset (default `null`), any internet client can proxy to `http://169.254.169.254/`, `http://localhost:2375/`, `https://opencode.ai` internals, etc. via your Cloudflare Tunnel.
- Impact: full SSRF, credential exfil of cloud metadata or Docker daemon if proxy runs on host network.
- Fix: allow-list `opencode.ai`, `*.supabase.co`, `localhost`, `127.0.0.1`, `[::1]`, `host.docker.internal`, and bare docker hostnames (reuse `privateHostnames` regex `index.html:2248`). Reject others 403. Also require `PROXY_KEY` in production or warn.
- Effort: 2h. Blocks: none. Blocks Phase 4 deploy.


#### 🟠 HIGH

**B-MODEL-TILDE — Tilde-prefixed model id 404s** `models.js:66` (`~openai/gpt-latest`) / `update_models.js:52-57`
- `~` is an OpenRouter internal marker for shadow models. Sending `~openai/gpt-latest` to `openrouter.ai/api/v1/chat/completions` → 404. User picks model from dropdown → send fails.
- Fix: `update_models.js` filter `m.id.startsWith('~')` or `m.id.replace(/^~/,'')`; also scrub existing `models.js` entry. Regenerate via `node update_models.js`.
- Effort: 1h.

**B-NEG-PRICE — Sentinel pricing displayed as negative dollars** `models.js:54-58` `openrouter/pareto-code`, `openrouter/auto`, `openrouter/auto-beta` → `$-1000000.0000/$-1000000.0000` / `update_models.js:50-53`
- OpenRouter returns `-1e6` for unknown pricing. `fmtPrice(-1e6)` → `-1000000.00`. Confusing cost pill.
- Fix: in both `index.html:3454` and `update_models.js:16` treat `n<0` → `p:''` (or `'Unknown'`). Filter at formatting time.
- Effort: 1h.

**B-CTX-UNDERSIZE — Attachment truncation for 1M+ models** `index.html:4252-4267`, `4740-4760` `getModelContextSize()`
- Hardcoded map covers ~12 ids; fallback `131072` (128K) for all other OpenRouter 1M/2M models. `buildApiMessages` computes `available = modelCtx - sys - history - search - rag - 2000` → severely under-budgets for 1M models, `injectChunks` drops valid chunks.
- Fix: store `context_length` from live fetch (`formatLiveModels` already has `m.context_length` for OpenRouter) into `PROVIDERS[pid].models[].ctx` (or separate map), read in `getModelContextSize`. Default to `262144` or `512000` instead of 128K. Also pass live cache to `getModelContextSize`.
- Effort: 2h. Depends on: live fetch stable.

**B-FIREFOX-ZOOM — UI Scale broken in Firefox** `index.html:131` `html{zoom:var(--ui-scale,1);}`
- `zoom` is non-standard (Chrome/Safari only). Firefox ignores → slider `setUiScale:2554` has no effect for ~3% users.
- Fix: add `@supports not (zoom:1) { html{transform:scale(var(--ui-scale)); transform-origin:0 0; width:calc(100% / var(--ui-scale)); height:calc(100vh / var(--ui-scale)); } }` or use `transform` primary.
- Effort: 1h.

#### 🟡 MEDIUM

**B-PULL-LOCK — touchmove blocks scrolling from top** `index.html:5002-5007`
- Current guard `if(msgs.contains(target) && scrollTop<=0) preventDefault()` cancels *any* touchmove starting at top, including upward swipe that should scroll content down. User at top cannot scroll.
- Fix: replace with `overscroll-behavior: contain` on `#messages` + `#main` (CSS) and remove JS, or gate on `touch.deltaY > 0` (pull-down only).
- Effort: 1h.

**B-RAG-EPHEMERAL — RAG context lost on reload** `index.html:2860-2955` `ragFiles[]`
- `ragFiles` lives only in memory; never persisted. Refresh → files vanish, no warning. Expected persistence is implied by "File Context (RAG)" panel (files are chunked and injected every message).
- Fix: persist `ragFiles` lean metadata + `content`/`chunks` to IDB (`ragFiles` key) or at least offer "Export RAG" and toast "RAG files are session-only — reload clears them".
- Effort: 3h (IDB) or 0.5h (toast-only mitig.).

**B-TIMEOUT-RAG — No timeout for RAG extraction** `index.html:2865-2899`
- Inline attach has 30s polling guard `index.html:4434-4449`; RAG path never times out → chip stays `extracting…` forever if `pdfjs` hangs.
- Fix: mirror same 100×300ms guard for `ragFiles`.
- Effort: 0.5h.

**B-ONCLICK-INJ — Live model name injection via inline handler** `index.html:3268-3269`
- `onclick="selectModel('${esc(m.id)}','${esc(m.name)}','${esc(m.p)}')"` inside double-quoted attribute. `esc` → `&#39;` but HTML parser decodes entity before JS parsing, so `'` in live model name (e.g., `O'Reilly`) could break out. Model IDs are usually safe but live names are provider-controlled.
- Fix: render `data-id`/`data-name`/`data-price` and bind via `addEventListener` (or `onclick` with `this.dataset`).
- Effort: 2h. Part of Phase 3 handler migration.

**B-URL-TYPE — Cloud Sync URL inputs masked** `index.html:1407`, `1413` `type="password"` on Supabase URL/key
- URL masked as `••••`, user can't verify/edit without reveal.
- Fix: `type="text"` + `autocomplete="off"` + `spellcheck="false"`; keep `passphrase` as password.
- Effort: 0.25h.

**B-STATUS-DRIFT — resetSettings doesn't refresh sidebar pill** `index.html:2802-2831`
- `resetSettings()` calls `resetCloudSettings()` which clears storage but sidebar `sync-status-text`/`icon` only updates after reload.
- Fix: call `updateSyncStatus('disabled','Cloud sync off')` or `loadCloudSettings()` at end of `resetSettings`.
- Effort: 0.25h.

#### 🔵 LOW

**B-PROXY-LOG — Misleading proxy key log** `proxy.js:110-111`
- Condition `PROXY_KEY === 'change-me-in-production'` never true (default `null`). Log always says "set via env var".
- Fix: check `if (!PROXY_KEY)` → log "Proxy key not set — open proxy!".

**B-SW-CACHE-ALL — Service Worker caches all same-origin GETs** `sw.js:78-84`
- `caches.match || fetch.then(c.put)` caches every same-origin request, not just `SHELL`. Future same-origin API would be cached incorrectly.
- Fix: scope to `SHELL.includes(new URL(e.request.url).pathname)` or check `request.destination`.

---

## 2. Enhancements

### 2.1 Security

- Inline handlers → delegated listeners to drop `'unsafe-inline'` from `script-src` (enables strict CSP). Effort M.
- At-rest encryption for `key_*` (WebCrypto + passphrase) — optional. M.
- Proxy rate-limit per IP (e.g., 100 req/min) + request logging. S.
- RLS on `sync_data` + row-level ownership by `user_hash`. S (Supabase).

### 2.2 Performance

- Debounce `persistChats` (currently writes on every pin/title/message) + `beforeunload` flush. S.
- Virtualize `renderChatList`/`renderMessages` when >200 items (IntersectionObserver). M.
- PDF extract in Web Worker (avoid main-thread jank on 300-page PDFs). M.
- Append-only streaming: `textContent` during stream, `fmtText` once on `renderMessages(true)`. S.

### 2.3 UX

- Export/import chats JSON (backup/transfer). S.
- In-conversation full-text search + highlight. S.
- Markdown toolbar + image drag-drop (vision models). M.
- Prompt templates / slash commands (`/summarize`). S.
- Token/cost dashboard per chat + global. S.
- Voice input (Web Speech API) + TTS output. M.
- Fork/branch conversation (like Claude). M.

### 2.4 Maintainability

- Provider interface: single object `{id,label,badge,url,usageUrl,needsProxy,needsKey,formatModels,extraPayload,fallback}` → reduces 10 touch-points `index.html:1430,3105,3345,3230,2333,284-418,2615,1080,3835,3845` to 1. **L effort, high leverage** — Phase 4.
- Extract `providers.js`/`storage.js`/`search.js` from `index.html` while keeping deploy = `index.html+models.js+sw.js` (SW already handles 2-file deploy; 4-file is acceptable). M.
- ESLint + `npm run test` in CI (GitHub Action bumps `sw.js:CACHE` from git SHA). S.

### 2.5 Features / search

- Search provider interface mirrors provider interface (one object per search engine). S.
- RAG embedding re-rank (currently keyword `index.html:3068-3072`) → add cheap embedding or TF-IDF. M.

---

## 3. Risk register (top)

| # | Risk | Cat | L | I | Det | Priority |
|---|------|-----|---|---|-----|----------|
| R1 | SSRF via open proxy — attacker pivots via `proxy?url=` | External | H | 4 | H | 🔴 P1 |
| R2 | Model 404 after selecting `~` or 2M model with wrong ctx → silent 404, user blames provider | Boundary | H | 3 | M | 🟠 P2 |
| R3 | Firefox zoom silent failure — slider moves, nothing scales, bug report "scale broken" | Interaction | M | 2 | H | 🟡 P3 |
| R4 | Pull-lock scroll freeze confused with app freeze | Interaction | M | 2 | M | 🟡 P3 |
| R5 | RAG ephemeral loss — user reloads after uploading 10 PDFs, blames bug | Human | H | 2 | M | 🟡 P3 |

**Interaction risk to watch:** R1+R5 — user self-hosts proxy without `PROXY_KEY`, pushes RAG-heavy chats through open proxy, proxy SSRF + no RAG persist = double data-loss vector.

---

## 4. Execution plan

**Goal:** Ship P1 bugs without regressions, green `npm test` ×2, bump `sw.js`.

| Phase | Name | Duration | Milestone | Key risk |
|-------|------|----------|-----------|----------|
| 1 | Critical security & data-correctness | 1–2d | SSRF allow-list, `~`/price scrub, `getModelContextSize` fixed; Firefox/pull behind flag | Deploying SSRF fix without locking legitimate SearXNG hosts |
| 2 | Persistence & perf | 2–3d | Debounced IDB writes, RAG persist+timeout, worker PDF | IDB quota retry loop |
| 3 | UX polish (parallel with 2 after T01) | 2d | No inline handlers, a11y, settings type fix, drift fix | Handler migration breaks `selectModel` |
| 4 | Maintainability & release | 1–2d | Provider interface, SW hash bump, tests, docs | Interface refactor touches 10 sites |

### Task inventory

| ID | Task | Eff | Prereq | Blocks |
|----|------|-----|--------|--------|
| T01 | Proxy allow-list + `PROXY_KEY` warn `proxy.js:52-98` | 2h | — | T14 |
| T02 | Scrub `~` + negative price `update_models.js`+`models.js` | 1h | — | T14 |
| T03 | `getModelContextSize` reads `context_length` from live cache | 2h | — | T06 |
| T04 | Firefox zoom fallback `index.html:131` | 1h | — | — |
| T05 | Pull-lock → `overscroll-behavior` `index.html:5002` | 1h | — | — |
| T06 | Debounce `persistChats` + `beforeunload` flush | 2h | T03 | T14 |
| T07 | RAG persist to IDB + timeout mirror | 3h | — | T14 |
| T08 | PDF Web Worker | 4h | — | — |
| T09 | Inline → delegated (`selectModel`, `loadChat`, `delete`) | 3h | — | T14 |
| T10 | a11y + dropdown focus trap | 2h | T09 | — |
| T11 | Settings `type` fix + `resetSettings` sync pill | 0.5h | — | — |
| T12 | Provider interface refactor | 5h | T03 | T14 |
| T13 | SW cache auto-bump CI | 2h | — | T15 |
| T14 | Tests for T01-T03,T06-T09 | 3h | T01-T03,T06,T09 | T15 |
| T15 | Docs + `CACHE v39` bump + manual smoke | 1h | T14,T13 | — |

### Critical path

```
T01 (2h) → T02 (1h) → T03 (2h) → T06 (2h) → T12 (5h) → T14 (3h) → T15 (1h) = 16h min
```

Bottleneck: **T12 provider interface** (5h, touches 10 sites). Mitigation: keep Phase 1 patches on `main` independently; T12 on feature branch behind flag.

### Parallel streams

```
Stream A (critical): T01 → T02 → T03 → T06 ─┐
Stream B (a11y):     T09 → T10 ──────────────┤
Stream C (persist):  T07 (parallel) ─────────┤→ T14 → T15
Stream D (cosmetic): T04, T05, T11 (parallel)┘
         T08, T13 run anytime
```

### Immediate next actions

1. **Fixer-A (muse-spark):** `proxy.js` allow-list (`T01`) + `update_models.js`+`models.js` scrub (`T02`).
2. **Fixer-B (muse-spark):** `index.html` `getModelContextSize` + context_length plumbing (`T03`) + Firefox zoom (`T04`) — can start once T02 lands.
3. **Fixer-C (muse-spark):** Inline→delegated handlers + a11y (`T09`+`T10`) on separate worktree — parallel, no data dep.

All three use `model: opencode-go/muse-spark-1.2-contributor` (`fixer` preset `~/.config/opencode/oh-my-opencode-slim.json:104` already set to that).

---

## 5. Verification plan

- `npm test` (IDB) + `npm test -- --no-idb` (fallback) must pass before any PR (existing 76+73 tests).
- New tests: SSRF reject unknown host, `~` filtered, negative price → `''`, `getModelContextSize('big-model-2M')` → ≥262144, RAG persist round-trip, `overscroll-behavior` present.
- Manual: open `index.html` file:// + `python -m http.server 3000`, add dummy key, switch provider/model, upload PDF, toggle web search, resize 320px, Firefox scale, stop mid-stream, hard-refresh checks SW `v39`.

---

## 6. File map for fixers

- Proxy: `proxy.js:1-112`, `index.html:2248,2258,3268`
- Models: `models.js:1-91`, `update_models.js:1-116`
- Context: `index.html:3413-3528,4252-4267,4707-4760`
- Zoom/pull: `index.html:131,5002-5007,224-231`
- RAG: `index.html:2860-3100,5010-5024`
- Handlers: `index.html:3268,3964-4006,4127-4142`
- Settings: `index.html:1407-1413,2802-2831`
- SW: `sw.js:1-85`

---

*Generated 2026-08-19. Approve Phase 1 to start fixers; Phase 2-4 remain planned but not yet executed.*
