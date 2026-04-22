# AGENTS.md — MultiChat

## What this repo is

Single-file vanilla HTML/CSS/JS PWA (Progressive Web App) hosted on GitHub Pages. No build tools, no bundler, no package manager. The entire app lives in `index.html` (~3200 lines of interleaved CSS, HTML, and JS).

## Deploy / release flow

- GitHub Pages serves from the repo root (`/`). Push to `main` = deploy in ~60s.
- **Bump the Service Worker cache version** in `sw.js` (`const CACHE = 'multichat-vX'`) when shipping non-trivial changes, or returning users will see stale cached shells.
- **The SW registration is cache-busted** (`./sw.js?v=${Date.now()}` in `index.html`) so the browser always fetches the latest `sw.js` after a deploy. Without this, the browser may serve a stale `sw.js` from HTTP cache, which then serves the old `index.html` shell from the Cache API.
- The SW intentionally **bypasses all cross-origin requests** (lines 28-31) to avoid a WebKit/Safari bug that drops `Authorization` headers on POSTs.

## Updating model lists

`update_models.js` is a Node.js script that fetches live `/models` endpoints from OpenRouter and DeepInfra and **mutates `index.html` in-place** via regex replacement. Run it when providers release new models:

```bash
node update_models.js
```

It edits the `PROVIDERS.openrouter.models` and `PROVIDERS.deepinfra.models` arrays inside `index.html`. Groq and MiniMax have no public listing endpoint and remain hand-curated.

## Architecture notes an agent would miss

- **One file, three layers**: CSS (themes via `[data-theme]` custom properties), HTML (inline DOM), and JS (all state, API, rendering) are in `index.html`. There are no imports or modules.
- **Custom model dropdown**: A hidden native `<select id="model-sel">` holds the real selected value; the visible dropdown is a custom DOM panel with inline search. `selectModel()` syncs both.
- **Live vs static model lists**: `LIVE_PROVIDERS = new Set(['groq','openrouter','deepinfra'])`. On provider change, the app tries a live `/models` fetch (cached per session in `modelCache`). Falls back to the static `PROVIDERS` registry if CORS/network fails. Groq has a special OpenRouter proxy fallback (`fetchGroqViaOpenRouter`) because direct Groq CORS is often blocked.
- **Web search is two-phase**: (1) a lightweight non-streaming LLM call plans whether search is needed and decomposes queries; (2) queries execute in parallel via Tavily or Serper. If the planner fails, it silently falls back to regex heuristics (`detectSearchNeeded`).
- **Cloud sync**: Supabase-backed, client-side AES-GCM encrypted with a user passphrase. Chats are merged by `updatedAt` timestamp on pull.
- **All persistence is localStorage**:
  - `mc_chats` — conversations
  - `mc_settings` — generation params + web search config
  - `mc_theme` — active theme
  - `key_<provider>` — API keys
  - `mc_cloud_settings` — sync config
  - `key_search_tavily` / `key_search_serper` — search API keys

## Testing / verifying changes

There is no test suite. Verification is manual:

1. Open `index.html` directly in a browser (no server required).
2. Add an API key in Settings and send a message to confirm streaming works.
3. Switch providers and verify the model dropdown repopulates.
4. Toggle web search on and confirm the search indicator appears in the input footer.

## CI / automation

- `.github/workflows/claude.yml` — triggers on `@claude` mentions in issues/PRs.
- `.github/workflows/claude-code-review.yml` — runs Claude Code Review on every PR.

## Files that matter

| File | Purpose |
|------|---------|
| `index.html` | The entire app (CSS + DOM + JS). Treat as the source of truth. |
| `sw.js` | Service Worker — bump cache name on release. |
| `manifest.json` | PWA manifest — theme color, icons, shortcuts. |
| `update_models.js` | Node script to refresh OpenRouter/DeepInfra models in `index.html`. |
| `deepinfra_models.json` / `or_models.json` | Saved API responses (not consumed by the app; reference only). |
| `icon-192.png` / `icon-512.png` | PWA icons. |

## Common pitfalls

- **Do not split `index.html` into separate files** unless you also update the SW cache list and GitHub Pages deployment docs. The entire value prop is "copy one file to host anywhere."
- **Model IDs in the static registry must match the provider's API exactly** (e.g. `openai/gpt-oss-120b` vs `openai/gpt-oss-120b:free`). Mismatches cause 404s on send.
- **The custom dropdown search** matches against `dataset.name + ' ' + dataset.id`. If you add models with unusual IDs, ensure the `data-id` attribute is populated in `populateModels()`.
- **CORS is real**: live model fetching only works for providers with permissive CORS (OpenRouter, DeepInfra). Groq often fails direct fetch and falls back to the OpenRouter proxy.
