# MultiChat Enhancements — Design Spec

**Date:** 2026-04-28 | **Status:** Approved
**Branch:** `feature/opencode-searxng-enhancements`

## Feature 1: Remove Minimax & DeepInfra

Delete these two providers entirely — code, settings, selects, key storage, provider icons.

**Changes in `index.html`:**
- `PROVIDERS` object — delete `minimax:` and `deepinfra:` entries (lines ~1118-1214)
- Provider `<select>` HTML — remove two `<option>` tags
- Settings panel — remove `#key-minimax` and `#key-deepinfra` key rows
- `loadKeys()` — remove `'minimax'` and `'deepinfra'` from the array
- `providerIcon()` — remove `minimax`/`deepinfra` mappings
- `providerFromModel()` — remove deepinfra-specific model ID heuristics
- `LIVE_PROVIDERS` — remove `'deepinfra'`, add `'opencode'`
- `formatLiveModels()` — remove deepinfra handler
- `fetchLiveModels()` — remove `provider !== 'deepinfra'` check
- Badge CSS — **keep** (harmless, old messages reference them)

## Feature 2: Add OpenCode Go Provider

**Config:**
```
Provider ID: opencode
Label: OpenCode Go
Badge CSS: badge-opencode (orange #f97316)
Base URL: https://opencode.ai/zen/go/v1
API Key: required (like Groq)
Usage URL: https://opencode.ai/workspace/wrk_01KQA49DFKK6FNKT2MX99WVGQH/usage
```

**Static models (from OpenRouter pricing):**

| ID | Name | Price/1M |
|----|------|----------|
| minimax-m2.7 | MiniMax M2.7 | $0.30/$1.20 |
| minimax-m2.5 | MiniMax M2.5 | $0.27/$0.95 |
| kimi-k2.6 | Kimi K2.6 | $0.50/$2.50 |
| kimi-k2.5 | Kimi K2.5 | $0.45/$2.25 |
| glm-5.1 | GLM 5.1 | $0.95/$3.15 |
| glm-5 | GLM 5 | $0.80/$2.56 |
| deepseek-v4-pro | DeepSeek V4 Pro | $0.50/$2.00 |
| deepseek-v4-flash | DeepSeek V4 Flash | $0.15/$0.60 |
| qwen3.6-plus | Qwen 3.6 Plus | $0.30/$0.90 |
| qwen3.5-plus | Qwen 3.5 Plus | $0.26/$1.56 |
| mimo-v2-pro | MiMo V2 Pro | $1.00/$3.00 |
| mimo-v2-omni | MiMo V2 Omni | $0.40/$2.00 |
| mimo-v2.5-pro | MiMo V2.5 Pro | $0.80/$2.50 |
| mimo-v2.5 | MiMo V2.5 | $0.30/$1.50 |

**Live fetch:** `GET https://opencode.ai/zen/go/v1/models` (needs API key). Response: `{data:[{id, object, created, owned_by}]}`

**Integration points:**
- Provider `<select>` — add option
- Settings panel — add key-row with dot + input
- `loadKeys()` — add `'opencode'`
- `providerIcon()` — `opencode: '🟠'`
- `LIVE_PROVIDERS` — add `'opencode'`
- `formatLiveModels()` — add opener handler
- `fetchLiveModels()` — add opencode to key-required check
- `providerFromModel()` — add heuristic

## Feature 3: Usage Link (OpenCode Go + OpenRouter)

**Concept:** Each provider can optionally have a `usageUrl` field in PROVIDERS. When populated, a "📊 View Usage & Billing →" link appears inside the model info card below the cost row.

**PROVIDERS additions:**
```js
opencode:   { ..., usageUrl: 'https://opencode.ai/workspace/wrk_01KQA49DFKK6FNKT2MX99WVGQH/usage' }
openrouter: { ..., usageUrl: 'https://openrouter.ai/activity' }
```

**Model info card HTML additions (inside `#mic-content`):**
```html
<div class="mic-divider" id="mic-usage-divider" style="display:none;"></div>
<a id="mic-usage-link" href="#" target="_blank" rel="noopener" class="mic-usage-link" style="display:none;">📊 View Usage & Billing →</a>
```

**JS in `updatePricePill()`:**
- Read `PROVIDERS[currentProvider].usageUrl`
- If exists and model selected → show link + divider
- Else → hide both

## Feature 4: Remember Model & Provider

**Persistence:**
| Key | Saved on |
|-----|----------|
| `mc_last_provider` | `onProviderChange()` |
| `mc_last_model_<provider>` | `selectModel()` |

**Restore (in `window.onload`):**
1. Read `mc_last_provider` → set provider select, call `populateModels()`
2. Read `mc_last_model_<provider>` → if model exists in current list, select it
3. If same model exists on multiple providers, prefer `opencode`

## Feature 5: Accent Badge Footer Stats

Convert token/cost displays from faint `.tok-count` spans to accent-colored `.stat-badge` pills:
```
[1.2K tok · $0.0042]  [Σ 45.7K tok · $0.12]  [~5 tokens]
```

- Remove `#footer-sep`
- Compact number formatting: 1,234 → 1.2K, 1,234,567 → 1.2M
- New CSS class `.stat-badge` with accent background + border + mono font

## Feature 6: SearXNG Search Engine

**Config:**
```js
searxng: { label: 'SearXNG (self-hosted)', keyName: null, urlKey: 'mc_search_url', costNote: '...' }
```

**Settings panel:**
- Add `<option value="searxng">` to search provider dropdown
- Add URL input field (shown only when SearXNG selected)
- URL persisted in `localStorage` key `mc_search_url`

**Search function:**
```js
async function searchSearXNG(query, baseUrl) {
  const url = baseUrl + encodeURIComponent(query) + '&format=json';
  // ... fetch + map results
}
```

**Dispatch:** Add to `executeSearch()`.
