# AGENTS.md — MultiChat

## What this repo is

Single-file vanilla HTML/CSS/JS PWA (Progressive Web App) hosted on GitHub Pages. No build tools, no bundler, no package manager. The entire app lives in `index.html` (~4493 lines of interleaved CSS, HTML, and JS).

## Deploy / release flow

- GitHub Pages serves from the repo root (`/`). Push to `main` = deploy in ~60s.
- **Bump the Service Worker cache version** in `sw.js` (`const CACHE = 'multichat-vX'`) when shipping non-trivial changes, or returning users will see stale cached shells.
- **The SW registration is cache-busted** (`./sw.js?v=${Date.now()}` in `index.html`) so the browser always fetches the latest `sw.js` after a deploy. Without this, the browser may serve a stale `sw.js` from HTTP cache, which then serves the old `index.html` shell from the Cache API.
- The SW intentionally **bypasses all cross-origin requests** to avoid a WebKit/Safari bug that drops `Authorization` headers on POSTs.

## Updating model lists

`update_models.js` is a Node.js script that fetches live `/models` endpoints from OpenRouter and OpenCode Go and **mutates `index.html` in-place** via regex replacement. Run it when providers release new models:

```bash
node update_models.js
```

It edits the `PROVIDERS.openrouter.models` and `PROVIDERS.opencode.models` arrays inside `index.html`. Groq has no public listing endpoint and remains hand-curated.

## Architecture notes an agent would miss

- **One file, three layers**: CSS (themes via `[data-theme]` custom properties), HTML (inline DOM), and JS (all state, API, rendering) are in `index.html`. There are no imports or modules.
- **Custom model dropdown**: A hidden native `<select id="model-sel">` holds the real selected value; the visible dropdown is a custom DOM panel with inline search. `selectModel()` syncs both.
- **Live vs static model lists**: `LIVE_PROVIDERS = new Set(['groq','opencode','openrouter'])`. On provider change, the app tries a live `/models` fetch (cached per session in `modelCache`). Falls back to the static `PROVIDERS` registry if CORS/network fails. Groq has a special OpenRouter proxy fallback (`fetchGroqViaOpenRouter`) because direct Groq CORS is often blocked.
- **Web search is two-phase**: (1) a streaming LLM call plans whether search is needed and decomposes queries; (2) queries execute in parallel via Tavily, Serper, or SearXNG. If the planner fails, it silently falls back to regex heuristics (`detectSearchNeeded`).
- **Cloud sync**: Supabase-backed, client-side AES-GCM encrypted with a user passphrase. Chats are merged by `updatedAt` timestamp on pull.
- **Collapsible settings panel**: Settings are organized into 7 accordion sections (API Keys, Appearance, Model Behavior, File Context, Web Search, Cloud Sync, Actions) with state persisted to `mc_settings_sections` in localStorage. Default: only Keys is open.
- **All persistence is localStorage**:
  - `mc_chats` — conversations
  - `mc_settings` — generation params + web search config + system prompt
  - `mc_theme` — active theme
  - `key_<provider>` — API keys
  - `mc_cloud_settings` — sync config
  - `mc_synced_at` — last cloud sync timestamp
  - `key_search_tavily` / `key_search_serper` / `mc_search_url` — search config
  - `mc_proxy_key` — proxy authentication key
  - `mc_settings_sections` — accordion open/closed states
  - `mc_ui_scale_desktop` / `mc_ui_scale_mobile` — zoom factor per device
  - `mc_last_provider` — last selected provider
  - `mc_last_model_<provider>` — last model per provider
  - `mc_pwa_dismissed` — PWA install banner dismissed flag

## Hidden features agents miss

- **Grid header with hamburger**: Three-column CSS grid (`auto 1fr auto`). Hamburger always visible on mobile. Provider + model wraps to second row on narrow screens.
- **Chat info popup**: ⓘ button shows model name, query tokens/cost, total tokens/cost, last updated timestamp. Closes on Escape or overlay click.
- **Think toggle**: Switch in info bar to show/hide `<think>` / `<thinking>` blocks (both historic and live-streaming).
- **Edit & resubmit**: Pencil icon on user messages loads text back into input, truncates conversation at that point (`chat.messages.splice(msgIndex)`). Toast confirms edit mode.
- **Copy message**: Clipboard pill button on AI messages only via `navigator.clipboard.writeText()`.
- **Pin conversations**: Star toggle sets `chat.pinned` boolean. Pinned chats render in their own group header, sorted first.
- **Chat search/filter**: Filters by title; if >=3 characters, also searches message content. Groups: Pinned, Today, Yesterday, Last 7 Days, This Month, Older.
- **Inline file attachments** (per-message): Paperclip button, cleared after send. Supports `.txt .md .csv .json .py .js .ts .html .css .pdf .xml .yaml .yml`. PDF extraction via `pdfjs-dist`. Chips show file name + size.
- **Persistent RAG (File Context)**: Drag-and-drop zone in Settings. `ragFiles[]` persists across all messages. Chunked (~4K tokens, 200-token overlap), scored by keyword relevance, capped at 50K chars/file.
- **System prompt**: Custom instructions in Settings → Model Behavior. If empty, auto-generated default includes today's date, placeholder prohibition, reasoning-mode hints. Persisted in `mc_settings`.
- **Generation parameters**: Temperature (0–2), Max Tokens (256–16384), Top-P (0.1–1.0) in Settings → Model Behavior.
- **6 themes**: `claude` (default), `chatgpt`, `gemini`, `dark`, `minimal`, `duo` — applied via `[data-theme]` on `<html>`. Per-theme badge colour overrides. `duo` pairs a light/minimal main area with dark sidebar + settings panel.
- **UI Scale**: Slider (1.0x–1.5x, step 0.05). Separate desktop/mobile values, breakpoint at 700px. Mobile default 1.1x.
- **Live token counter**: Character/4 estimate in input footer, updated on every keystroke.
- **Price pill**: Per-1M-token cost displayed in header next to settings gear.
- **Toast notifications**: `showToast(msg, type)` — centered, bottom-aligned, 4500ms auto-dismiss. `.err` type for errors.
- **Pipeline progress blocks**: Visual breadcrumb during web search — "Planning" (live streaming) → collapses to "Planned N queries" → "Searching 0 of N" → collapses to "N sources". Finalized into clickable breadcrumb via `togglePipelineDetail()`.
- **Citation links**: Clickable source URLs from web search results.
- **Model switch divider**: Visual "Switched to ModelX" divider when model changes mid-conversation.
- **PWA install banner**: `beforeinstallprompt` handled with dismissible banner (`mc_pwa_dismissed`). `?new=1` shortcut auto-creates a new chat.
- **Reset to defaults**: Button in Settings → Actions resets system prompt, gen params, web search config, UI scale. Does NOT clear API keys.
- **Keyboard shortcuts**: `Enter` always inserts newline (submit via Send button). `Escape` closes info popup.

## Testing / verifying changes

There is no test suite. Verification is manual:

1. Open `index.html` directly in a browser (no server required).
2. Add an API key in Settings and send a message to confirm streaming works.
3. Switch providers and verify the model dropdown repopulates.
4. Toggle web search on and confirm the search indicator appears in the input footer.
5. Test proxy key authentication if proxy is running with `PROXY_KEY` set.

## CI / automation

- `.github/workflows/claude.yml` — triggers on `@claude` mentions in issues/PRs.
- `.github/workflows/claude-code-review.yml` — runs Claude Code Review on every PR.

## Files that matter

| File | Purpose |
|------|---------|
| `index.html` | The entire app (CSS + DOM + JS). Treat as the source of truth. |
| `sw.js` | Service Worker — bump cache name on release. |
| `manifest.json` | PWA manifest — theme color, icons, shortcuts. |
| `proxy.js` | Node.js CORS proxy for OpenCode Go and localhost SearXNG. |
| `update_models.js` | Node script to refresh OpenRouter/OpenCode Go models in `index.html`. |
| `deepinfra_models.json` / `or_models.json` | Saved API responses (not consumed by the app; reference only). |
| `icon-192.png` / `icon-512.png` | PWA icons. |

## Common pitfalls

- **Do not split `index.html` into separate files** unless you also update the SW cache list and GitHub Pages deployment docs. The entire value prop is "copy one file to host anywhere."
- **Model IDs in the static registry must match the provider's API exactly** (e.g. `openai/gpt-oss-120b` vs `openai/gpt-oss-120b:free`). Mismatches cause 404s on send.
- **The custom dropdown search** matches against `dataset.name + ' ' + dataset.id`. If you add models with unusual IDs, ensure the `data-id` attribute is populated in `populateModels()`.
- **CORS is real**: live model fetching only works for providers with permissive CORS (OpenRouter). Groq and OpenCode Go often fail direct fetch without a key; Groq falls back to the OpenRouter proxy.
- **Proxy key is only sent to OpenCode Go**: The `x-proxy-key` header is only added for requests routed through the proxy (`provider === 'opencode'` or localhost SearXNG). OpenRouter and Groq requests never receive this header.

## OpenCode Go CORS proxy setup

OpenCode Go (`opencode.ai`) does not return `Access-Control-Allow-Origin` headers on actual API responses (only on `OPTIONS` preflight). This makes direct browser fetch impossible. To use OpenCode Go from any device:

1. **Run the local proxy** (`node proxy.js`) — it listens on `localhost:3456`, forwards requests to `opencode.ai`, and injects synthetic CORS headers.
2. **Expose the proxy via Cloudflare Tunnel** (or similar) to a public HTTPS domain, e.g. `https://proxy.opencodechat.dpdns.org`.
3. **Point `index.html`** at the public proxy URL (`https://proxy.opencodechat.dpdns.org/zen/go/v1`).
4. **SearXNG localhost instances** are also routed through the proxy (`/proxy?url=<target>`) so they work from any device.

The app remains hosted on GitHub Pages; only the API calls route through your personal proxy.

### Cloudflare Tunnel quick setup

```bash
# 1. Add ingress to your existing tunnel config (~/.cloudflared/config.yml)
ingress:
  - hostname: proxy.opencodechat.dpdns.org
    service: http://localhost:3456
  - service: http_status:404

# 2. Create DNS record
cloudflared tunnel route dns <TUNNEL_ID> proxy.opencodechat.dpdns.org

# 3. Start the proxy
node proxy.js

# 4. Run your tunnel (if not already running)
cloudflared tunnel run <TUNNEL_ID>
```

### Proxy security (optional)
Set an environment variable to require a simple shared key:
```bash
PROXY_KEY=your-secret-key node proxy.js
```
If set, every request must include the header `x-proxy-key: your-secret-key`.

Enter the same key in the app's Settings panel under **API Keys → Proxy Key**. The key is stored in `localStorage` and sent only with proxy-bound requests.

### Architecture

```
Browser (GitHub Pages)
    │
    ├─→ OpenRouter API (direct, has CORS)
    ├─→ Groq API (direct, CORS fallback to OpenRouter)
    └─→ proxy.opencodechat.dpdns.org
            │
            └─→ cloudflared tunnel
                    │
                    └─→ localhost:3456 (proxy.js)
                            │
                            ├─→ opencode.ai (OpenCode Go API)
                            └─→ localhost:8888 (SearXNG, via /proxy?url=...)
```

The proxy adds synthetic `Access-Control-Allow-Origin: *` headers to all responses so the browser accepts them.

## Change Log

### 2026-05-30
- **Model**: Gemini 3.5 Flash
- **Changes**:
  - Disabled automatic scrolling of the chat messages viewport while text and planning streams in. This allows users to manually control the viewport position on mobile as well as desktop without the viewport constantly jumping to the bottom.
  - Bumped Service Worker cache version in `sw.js` to `multichat-v21` to ensure returning users fetch the updated `index.html`.

