# MultiChat

A Claude-style chat interface for frontier AI models — hosted as a PWA on GitHub Pages.

**Live demo:** `https://YOUR-USERNAME.github.io/multichat/`

## Supported Providers
- ⚡ **Groq** — Kimi K2, GPT-OSS 120B, Qwen3, Llama (free tier, no card)
- 🔷 **MiniMax** — M2.5, M2.7 (Chinese frontier)
- 🔵 **DeepInfra** — DeepSeek V3.2, GLM-5, Kimi K2.5, Qwen3 235B
- 🔀 **OpenRouter** — 300+ models including free tier

## Features
- 📱 Installable PWA — works on iPhone, Android, desktop
- 🎨 5 themes: Claude, ChatGPT, Gemini, Dark, Minimal
- 📎 File upload / RAG context injection
- ⚙️ System prompt, temperature, max tokens, top-P
- 🧠 Thinking suppression with collapsible thought viewer
- 🔀 Model switch dividers in conversation

## Setup (5 minutes)

### 1. Fork or create repo
```bash
# Option A: create new repo named "multichat"
gh repo create multichat --public

# Option B: fork this repo
```

### 2. Upload files
Upload these files to your repo root:
```
index.html
manifest.json
sw.js
icons/
  icon-192.png
  icon-512.png
```

### 3. Enable GitHub Pages
- Go to repo **Settings → Pages**
- Source: **Deploy from a branch**
- Branch: **main**, folder: **/ (root)**
- Save

Your app will be live at `https://YOUR-USERNAME.github.io/multichat/` in ~60 seconds.

### 4. Open on mobile
- On iPhone (Safari): open the URL → Share → **Add to Home Screen**
- On Android (Chrome): open the URL → Menu → **Install App** (or banner appears automatically)

## API Keys
Enter your keys directly in the app sidebar — they're saved in your browser's localStorage only. They **never leave your device** except as Authorization headers to the respective API providers.

## Icons
The `icons/` folder contains PNG icons generated from SVG. To regenerate:
```bash
pip install cairosvg pillow
python3 make_icons.py
```

## Privacy
- No server. No analytics. No data collection.
- All conversations stored in browser localStorage.
- API keys stored in browser localStorage only.
- Prompts go directly from your browser to the selected provider's API.
