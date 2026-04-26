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
index.html          # The entire app (~3,200 lines)
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
| **MiniMax** | M2.5, M2.7 | Chinese frontier models |
| **DeepInfra** | DeepSeek V3.2, GLM-5, Kimi K2.5, Qwen3 235B | OpenAI-compatible API |
| **OpenRouter** | 300+ models across 50+ providers | Unified router with free tier options |

---

## Features

### Core Chat
- **Multi-provider support** — Switch between Groq, MiniMax, DeepInfra, OpenRouter instantly
- **Streaming responses** — Real-time token generation via Server-Sent Events (SSE)
- **Token tracking** — Live usage stats and cost estimation per query
- **Conversation history** — All chats persist in browser localStorage
- **Model switching** — Visual dividers mark model changes mid-conversation

### Advanced Capabilities
- **Web Search (RAG)** — Two-phase LLM planning + parallel query execution for real-time information
  - Providers: Tavily or Serper
  - Modes: Auto (LLM decides) or Always
- **File Upload / RAG** — Persistent context injection from `.txt`, `.md`, `.csv`, `.json`, `.py`, `.js` files
- **Inline Attachments** — Per-message file uploads cleared after send
- **Thinking View** — Collapsible panel shows model reasoning (`<think>` tags)
- **Citation Links** — Clickable sources from web search results
- **Cloud Sync** — Optional Supabase backup with client-side AES-GCM encryption

### UX & Customization
- **5 Themes** — Claude, ChatGPT, Gemini, Dark, Minimal
- **Custom System Prompt** — Persistent system instructions
- **Generation Settings** — Temperature (0-2), Max Tokens (256-16384), Top-P (0.1-1.0)
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
| MiniMax | `sk-••••` | For MiniMax models |
| DeepInfra | `••••` | For DeepInfra models |
| OpenRouter | `sk-or-••••` | For OpenRouter models |
| Tavily | `••••` | For web search (optional) |
| Serper | `••••` | For web search (optional) |

**No key is shared between providers.** Each provider uses only its own key.

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
├── index.html              # THE ENTIRE APP (~3,200 lines: CSS + HTML + JS)
├── sw.js                   # Service Worker (cache management)
├── manifest.json           # PWA manifest (icons, theme, shortcuts)
├── icon-192.png            # PWA icon (192x192)
├── icon-512.png            # PWA icon (512x512)
├── update_models.js        # Node.js script to fetch & update model lists
├── deepinfra_models.json   # Cached DeepInfra API response (reference)
├── or_models.json          # Cached OpenRouter API response (reference)
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

---

## Development

### Running Locally

```bash
# Option 1: Open directly in browser
open index.html           # macOS
start index.html          # Windows

# Option 2: Serve with Python
python -m http.server 8000

# Option 3: Serve with Node.js
npx serve .
```

### Updating Model Lists

When providers add new models, update the static registry:

```bash
node update_models.js
```

This script:
1. Fetches live `/models` from OpenRouter and DeepInfra
2. Parses and formats the responses
3. Mutates `index.html` in-place via regex replacement

Groq and MiniMax have no public listing endpoint and remain hand-curated.

### Service Worker Cache

After making changes, **bump the cache version** in `sw.js`:

```javascript
const CACHE = 'multichat-v6';  // Increment this number
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

---

## Testing

There is no automated test suite. Manual verification:

1. Open `index.html` in a browser
2. Add an API key in Settings
3. Send a message — verify streaming works
4. Switch providers — verify model dropdown repopulates
5. Toggle web search — verify search indicator appears in input footer
6. Upload a file — verify RAG context injects

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

### Groq models not loading
- **Cause:** Groq CORS is often blocked
- **Fix:** App automatically falls back to OpenRouter proxy for Groq models

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
- [OpenRouter](https://openrouter.ai) — Multi-provider router
- [Tavily](https://tavily.com) — AI search API
- [Serper](https://serper.dev) — Google Search API

---

**Made with ♥ for the open web.** No build tools required.
