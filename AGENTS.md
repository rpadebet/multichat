# AGENTS.md — MultiChat

## What this repo is

Single-file vanilla HTML/CSS/JS PWA (Progressive Web App) hosted on GitHub Pages. No build tools, no bundler, no package manager. The entire app lives in `index.html` (~4200 lines of interleaved CSS, HTML, and JS).

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
- **Collapsible settings panel**: Settings are organized into 7 accordion sections (API Keys, Appearance, Model Behavior, File Context, Web Search, Cloud Sync, Actions). State is persisted to `localStorage`.
- **All persistence is localStorage**:
  - `mc_chats` — conversations
  - `mc_settings` — generation params + web search config
  - `mc_theme` — active theme
  - `key_<provider>` — API keys
  - `mc_cloud_settings` — sync config
  - `key_search_tavily` / `key_search_serper` / `mc_search_url` — search config
  - `mc_proxy_key` — proxy authentication key
  - `mc_settings_sections` — accordion open/closed states

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
