# MultiChat

A Claude-style AI chat interface as a **single-file Progressive Web App (PWA)** — no backend, no build tools, no server infrastructure. Host it anywhere (GitHub Pages, Netlify, S3) and it works instantly.

**Live demo:** `https://YOUR-USERNAME.github.io/multichat/`

---

## Quick Start

```bash
# 1. Clone or create a repo
gh repo create multichat --public
cd multichat

# 2. Upload these 5 files
index.html          # The entire app (~4,200 lines)
sw.js               # Service Worker for offline caching
manifest.json       # PWA manifest for installability
icon-192.png        # App icon
icon-512.png        # App icon

# 3. Enable GitHub Pages: Settings → Pages → Deploy from branch 'main', root folder
# 4. Visit https://YOUR-USERNAME.github.io/multichat/
```

That's it. No `npm install`, no bundler, no configuration.

---

## Supported AI Providers

| Provider | Models | Notes |
|----------|--------|-------|
| **Groq** | Llama, Qwen3, Kimi K2, GPT-OSS 120B | Free tier — routes via OpenRouter proxy when CORS is blocked |
| **OpenCode Go** | MiniMax, DeepSeek, GLM, Qwen, Kimi, MiMo | Requires CORS proxy (see setup below) |
| **OpenRouter** | 300+ models across 50+ providers | Unified router with free tier options |

---

## Mobile Layout Improvements (2026-04-30)

Recent updates significantly enhance mobile responsiveness and usability:

- **Maximized chat message area:** Chat messages now occupy 75%+ of mobile screen height (increased from ~60%)
- **Dynamic input expansion:** Input field expands from 36px to 150px maximum only when typing, preserving screen space for messages
- **Full-width input field:** Query box spans entire input area width for better typing experience
- **Repositioned controls:** Send and attach buttons positioned to the right of input field
- **Info popup for chat details:** New ⓘ button in bottom bar shows model, tokens, timestamp, and other metadata
- **Fixed provider dropdown visibility:** Resolved overlapping dropdown issues in header for proper model selection
- **Ultra-compact styles for small phones (<500px):** Reduced padding, compact spacing, optimized button layout
- **Balanced layout for larger phones (500-700px):** Input + buttons side-by-side with proper spacing
- **Flexbox-based layout restructure:** Improved mobile portrait prioritization with flex-direction management
- **Tested devices:** iPhone SE (375px), iPhone 12 (390px), Android (480px) at UI scales 1.0x and 1.5x

These changes maintain full functionality on desktop while providing an optimized mobile experience.

---

## Features

### Core Chat
- **Multi-provider support** — Switch between Groq, OpenCode Go, OpenRouter instantly
- **Streaming responses** — Real-time token generation via Server-Sent Events (SSE)
- **Token tracking** — Live usage stats and cost estimation per query
- **Conversation history** — All chats persist in browser localStorage
- **Model switching** — Visual dividers mark model changes mid-conversation

### Advanced Capabilities
- **Web Search (RAG)** — Two-phase LLM planning + parallel query execution for real-time information
  - Providers: Tavily, Serper, or SearXNG (self-hosted)
  - Modes: Auto (LLM decides) or Always
- **File Upload / RAG** — Persistent context injection from `.txt`, `.md`, `.csv`, `.json`, `.py`, `.js`, `.pdf` files
  - PDF support via pdf.js
  - Smart chunking with context-aware injection
- **Inline Attachments** — Per-message file uploads cleared after send
- **Thinking View** — Collapsible panel shows model reasoning (`<think>` tags)
- **Citation Links** — Clickable sources from web search results
- **Cloud Sync** — Optional Supabase backup with client-side AES-GCM encryption

### UX & Customization
- **5 Themes** — Claude, ChatGPT, Gemini, Dark, Minimal
- **UI Scale** — Zoom the entire interface (1x–1.5x) with separate desktop/mobile memory
- **Custom System Prompt** — Persistent system instructions
- **Generation Settings** — Temperature (0-2), Max Tokens (256-16384), Top-P (0.1-1.0)
- **Collapsible Settings Panel** — Organized accordion sections with persistent state
- **Smart Chat Organization** — Grouped by time (Today, Yesterday, Last 7 Days, etc.)
- **Pinned Conversations** — Keep important chats at the top
- **Chat Search/Filter** — Find old conversations quickly
- **Edit & Resubmit** — Modify previous messages and retry
- **Copy Message** — One-click copy to clipboard
- **Auto-resizing Textarea** — Input grows with your message
- **Live Token Counter** — Footer shows token count as you type
- **Custom Model Dropdown** — Searchable model selector with inline filtering

---

## Installation

### Desktop
1. Open the app in any modern browser
2. Chrome/Edge: Click the install icon in the address bar
3. Firefox: Right-click → Create Shortcut

### Mobile (iOS Safari)
1. Open the app URL in Safari
2. Tap the **Share** button
3. Select **Add to Home Screen**

### Mobile (Android Chrome)
1. Open the app URL in Chrome
2. Tap the **Menu** (three dots)
3. Select **Install App** (or tap the banner if it appears)

---

## API Keys

Enter keys in the **Settings** sidebar (gear icon). Keys are stored **only in your browser's localStorage** and sent directly to providers as `Authorization` headers.

| Key | Format | Required |
|-----|--------|----------|
| Groq | `gsk_••••` | For Groq models |
| OpenCode Go | `opencode_••••` | For OpenCode Go models |
| OpenRouter | `sk-or-••••` | For OpenRouter models |
| Proxy Key | any string | Only if proxy auth is enabled |
| Tavily | `••••` | For web search (optional) |
| Serper | `••••` | For web search (optional) |

**No key is shared between providers.** Each provider uses only its own key.

### Proxy Key (Optional)

If you run the OpenCode Go proxy with `PROXY_KEY=your-secret-key`, enter the same key in Settings → API Keys → Proxy Key. This header is only sent to the proxy, never to OpenRouter or Groq.

---

## OpenCode Go CORS Proxy Setup

OpenCode Go (`opencode.ai`) does not return CORS headers on API responses, making direct browser fetch impossible. The included `proxy.js` solves this:

```bash
# Start the proxy locally
node proxy.js

# Or with authentication
PROXY_KEY=your-secret-key node proxy.js
```

**Expose via Cloudflare Tunnel** (or any tunnel) to use from any device:

```yaml
# ~/.cloudflared/config.yml
ingress:
  - hostname: proxy.yourdomain.com
    service: http://localhost:3456
```

Then update `index.html` to point at your proxy URL, or use the default `https://proxy.opencodechat.dpdns.org`.

The proxy also routes localhost SearXNG instances through `/proxy?url=<target>` so self-hosted search works from any device.

---

## Architecture

### Design Philosophy
> "Copy one file, host anywhere"

The entire application exists in `index.html` with no build step. This means:
- Zero configuration to deploy
- No Node.js, Python, or runtime dependencies
- Portable — works on any static host
- Instant iteration — edit and refresh

### File Structure

```
multichat/
├── index.html              # THE ENTIRE APP (~4,200 lines: CSS + HTML + JS)
├── sw.js                   # Service Worker (cache management)
├── manifest.json           # PWA manifest (icons, theme, shortcuts)
├── proxy.js                # CORS proxy for OpenCode Go / SearXNG
├── icon-192.png            # PWA icon (192x192)
├── icon-512.png            # PWA icon (512x512)
├── update_models.js        # Node.js script to fetch & update model lists
├── deepinfra_models.json   # Cached API response (reference)
├── or_models.json          # Cached API response (reference)
├── AGENTS.md               # Architecture docs for AI agents
├── README.md               # This file
└── .github/
    └── workflows/
        ├── claude.yml              # Claude Code on @mentions
        └── claude-code-review.yml  # Automated PR review
```

### Key Technical Decisions

| Decision | Why |
|----------|-----|
| **Single HTML file** | Portability over modularity — deploy by uploading one file |
| **Service Worker cache busting** | `sw.js?v=${Date.now()}` forces fresh fetch after deploys |
| **SW bypasses cross-origin** | Avoids Safari bug that drops `Authorization` headers |
| **Live model fetching** | `/models` endpoints cached per-session for fresh model lists |
| **Custom dropdown + hidden `<select>`** | Native `<select>` can't support search; hybrid approach maintains compatibility |
| **Two-phase web search** | LLM plans queries → parallel execution → results injected into context |
| **Client-side encryption** | AES-GCM + PBKDF2 for cloud sync — server never sees plaintext |
| **CORS proxy for OpenCode Go** | Server lacks CORS headers; proxy injects them for browser access |

---

## Development

### Running Locally

```bash
# Option 1: Open directly in browser
open index.html           # macOS
start index.html          # Windows

# Option 2: Serve with Python
python -m http.server 3000

# Option 3: Serve with Node.js
npx serve .
```

### Updating Model Lists

When providers add new models, update the static registry:

```bash
node update_models.js
```

This script:
1. Fetches live `/models` from OpenRouter and OpenCode Go
2. Parses and formats the responses
3. Mutates `index.html` in-place via regex replacement

Groq has no public listing endpoint and remains hand-curated.

### Service Worker Cache

After making changes, **bump the cache version** in `sw.js`:

```javascript
const CACHE = 'multichat-v12';  // Increment this number
```

Without this, returning users may see stale cached shells.

---

## Cloud Sync (Optional)

MultiChat can optionally sync conversations to the cloud via Supabase:

1. **Create a Supabase project** (free tier at [supabase.com](https://supabase.com))
2. **Get your credentials**:
   - Project URL: `https://xxxxx.supabase.co`
   - Anon Key: Found in Settings → API
3. **Configure in app**: Settings → Cloud Sync
4. **Set a passphrase**: Used for client-side AES-GCM encryption

**How it works:**
- Chats encrypt locally before upload
- Sync merges by `updatedAt` timestamp
- Pull on demand or enable auto-sync

---

## Privacy & Security

- **No server** — No backend, no database, no analytics
- **No data collection** — Nothing is tracked or logged
- **LocalStorage only** — All data stays in your browser
- **Direct API calls** — Prompts go straight from your browser to the provider
- **Client-side encryption** — Cloud sync uses AES-GCM; server sees only ciphertext
- **No telemetry** — No error reporting, no usage metrics, no cookies
- **Proxy key isolation** — Proxy auth key is only sent to your proxy, never to AI providers

---

## Testing

There is no automated test suite. Manual verification:

1. Open `index.html` in a browser
2. Add an API key in Settings
3. Send a message — verify streaming works
4. Switch providers — verify model dropdown repopulates
5. Toggle web search — verify search indicator appears in input footer
6. Upload a file — verify RAG context injects
7. Test proxy key — if proxy auth is enabled, verify OpenCode Go works with key

---

## CI/CD Automation

The repo includes two GitHub Actions:

| Workflow | Trigger | Purpose |
|----------|---------|---------|
| `claude.yml` | `@claude` mention in issue/PR | Invokes Claude Code for assistance |
| `claude-code-review.yml` | Every PR | Automated code review via Claude Code |

---

## Troubleshooting

### Stale UI after deploy
- **Cause:** Service Worker serving old cache
- **Fix:** Hard refresh (Ctrl+Shift+R / Cmd+Shift+R) or bump `CACHE` version in `sw.js`

### Model dropdown empty
- **Cause:** CORS failure on `/models` fetch
- **Fix:** Falls back to static `PROVIDERS` registry. Check browser console for CORS errors.

### OpenCode Go "Missing API key" or CORS error
- **Cause:** `opencode.ai` doesn't send CORS headers
- **Fix:** Run `proxy.js` locally and expose via Cloudflare Tunnel. Enter proxy URL in `index.html`.

### OpenRouter fails with proxy key entered
- **Cause:** Old versions sent `x-proxy-key` to all providers
- **Fix:** Ensure you're on latest version — proxy key is only sent to OpenCode Go and localhost SearXNG

### SearXNG localhost not working
- **Cause:** Localhost SearXNG lacks CORS headers
- **Fix:** Use a public SearXNG instance, or route localhost through the proxy (automatic when URL contains `localhost`)

### PWA not installable
- **Cause:** Missing `manifest.json` or icons
- **Fix:** Ensure all 5 files (`index.html`, `sw.js`, `manifest.json`, `icon-192.png`, `icon-512.png`) are uploaded

---

## Contributing

This is a community project. To contribute:

1. Fork the repo
2. Make changes to `index.html`
3. Test locally
4. Open a PR

For major changes, please open an issue first to discuss.

---

## License

MIT License.

---

## Acknowledgments

Built with:
- [Supabase](https://supabase.com) — Cloud sync backend
- [Groq](https://groq.com) — Fast inference
- [OpenCode Go](https://opencode.ai) — Frontier model access
- [OpenRouter](https://openrouter.ai) — Multi-provider router
- [Tavily](https://tavily.com) — AI search API
- [Serper](https://serper.dev) — Google Search API
- [SearXNG](https://docs.searxng.org) — Self-hosted metasearch

---

**Made with ♥ for the open web.** No build tools required.
