# Pipeline Progress Blocks — Design Spec

**Date:** 2026-04-28
**Status:** Approved
**Context:** MultiChat (`index.html`) — single-file vanilla HTML/CSS/JS PWA

## Problem

When the model is searching the web and preparing a response, the UI shows only a three-dot typing indicator or a static "Searching: ..." label. Between button-press and first visible content, users face an opaque wait with no sense of what's happening or how long it'll take.

**Root cause:** The typing indicator row (`setTypingSearchStatus`) is a single DOM element that gets mutated to show one static label at a time. There's no streaming during the planner call, no incremental feedback during parallel searches, and no visible transition from search → response.

## Goal

Show progressive, eager-output pipeline blocks inline in the chat so the user always sees live activity during the entire send→search→respond flow.

## User preferences (from brainstorming)

- **Eager output:** Show partial results as they arrive (not just status labels)
- **Eagerness level:** Moderate — stream planner thinking, show search results as they land, THEN start main response with full context
- **Placement:** Inline in chat, between user message and AI response
- **Search display:** Minimal bullet list
- **Final state:** All pipeline blocks auto-collapse into a compact breadcrumb when the final answer is ready

## Pipeline Flow

```
User sends → typing dots → [Planning block] → [Search block] → [Response stream]
                                ↓ collapse            ↓ collapse
                           "🔍 Planned 3q"        "🔍 5 sources"
```

Three visual blocks appear inline in the chat:

| # | Block | During | Content | Collapses to |
|---|-------|--------|---------|-------------|
| 1 | **Planning** | LLM planner call (streaming) | Streaming thinking tokens from planner | "🔍 Planned N queries" |
| 2 | **Searching** | Parallel query execution | Counter badge + bullet results appearing as each query resolves | "🔍 N sources via Provider" |
| 3 | **Responding** | Main model streaming | Standard response stream (existing behavior) | Final AI answer |

**No web search?** Pipeline skipped — typing dots → response stream (unchanged from today).

## Interaction

- Collapsed breadcrumb is clickable — re-expands inline to show planning details or search results
- Blocks auto-collapse as pipeline advances (no user action required)
- Only the final breadcrumb + AI answer remain visible after completion

## DOM Structure

### Planning block (during planner streaming)

```html
<div class="msg-row pipeline-block" data-phase="plan">
  <div class="msg-inner">
    <div class="avatar av-ai">◆</div>
    <div class="msg-body">
      <div class="msg-meta">
        <span class="msg-name">MultiChat</span>
        <span class="phase-badge phase-plan">🔍 Planning</span>
      </div>
      <div class="think-block" style="display:block">
        <div class="think-body vis" id="plan-think-body"></div>
      </div>
    </div>
  </div>
</div>
```

### Search block (during query execution)

```html
<div class="msg-row pipeline-block" data-phase="search">
  <div class="msg-inner">
    <div class="avatar av-ai">◆</div>
    <div class="msg-body">
      <div class="msg-meta">
        <span class="msg-name">MultiChat</span>
        <span class="phase-badge phase-search">🔍 Searching · 1 of 3</span>
      </div>
      <ul class="search-bullet-list" id="search-bullets">
        <li class="search-bullet-result">
          <span class="sb-title">Result Title</span>
          <a class="sb-url" href="https://..." target="_blank" rel="noopener">domain.com</a>
          <span class="sb-snippet">Snippet text excerpt...</span>
        </li>
        <!-- appended per result -->
      </ul>
    </div>
  </div>
</div>
```

### Collapsed breadcrumb (replaces both after pipeline complete)

```html
<div class="msg-row pipeline-breadcrumb collapsed" onclick="togglePipelineCrumb(this)">
  <div class="msg-inner">
    <div class="avatar av-ai" style="font-size:11px">🔍</div>
    <div class="msg-body">
      <span class="crumb-label">Planned 3 queries · 5 sources via Tavily</span>
    </div>
  </div>
</div>
```

## CSS (new classes, using existing theme tokens)

```css
/* Phase badge — pill inline with msg-meta */
.phase-badge {
  display:inline-flex; align-items:center; gap:4px;
  padding:2px 8px; border-radius:12px;
  font-size:11px; font-family:var(--font-mono);
  background:var(--accent-bg); color:var(--accent);
  border:1px solid var(--accent-border);
  animation:badgePulse 1.8s ease-in-out infinite;
}
@keyframes badgePulse {
  0%,100% { opacity:1; }
  50%     { opacity:0.6; }
}

/* Search bullet list — minimal, fast-rendering */
.search-bullet-list { list-style:none; margin:8px 0 0; padding:0; }
.search-bullet-result {
  padding:5px 0; border-bottom:1px solid var(--border);
  animation:msgIn 0.25s ease forwards;
}
.search-bullet-result:last-child { border-bottom:none; }
.sb-title { font-size:12px; font-weight:500; color:var(--text); display:block; line-height:1.4; }
.sb-url   { font-size:10px; font-family:var(--font-mono); color:var(--accent); text-decoration:none; display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.sb-snippet { font-size:11px; color:var(--text3); line-height:1.45; display:block; margin-top:2px; }

/* Pipeline breadcrumb — compact one-liner */
.pipeline-breadcrumb { cursor:pointer; }
.pipeline-breadcrumb .crumb-label { font-size:12px; color:var(--text2); }
.pipeline-breadcrumb:hover .crumb-label { color:var(--text); }
```

## JavaScript Changes

### New functions

| Function | Purpose |
|----------|---------|
| `appendPlanningBlock()` | Creates planning block DOM, returns `{row, thinkEl}` refs |
| `updatePlanningBlock(block, text)` | Appends text to planning block think area |
| `collapsePlanningBlock(queries, el)` | Collapses planning → "🔍 Planned N queries" text |
| `appendSearchBlock(n)` | Creates search block with "Searching · 0 of N" counter, returns `{row, listEl, badgeEl}` |
| `appendSearchResult(block, result)` | Appends one `<li>` bullet, updates counter in badge |
| `collapseSearchBlock(block, total, provider)` | Collapses search → "🔍 N sources via Provider" |
| `removePipelineBlocks()` | Removes all `.pipeline-block` and `.pipeline-breadcrumb` from DOM |
| `finalizePipeline()` | Collapses both blocks, appends or updates breadcrumb |
| `togglePipelineCrumb(el)` | Expands/collapses the breadcrumb to show/hide pipeline details |

### Modified functions

| Function | Change |
|----------|--------|
| `planSearchQueries()` | Changed from `stream: false` to `stream: true`. Accepts callback `onToken(text)` for streaming planner tokens. Parses JSON from accumulated full content on [DONE]. |
| `sendMessage()` | Pipeline orchestration: creates planning block → runs streaming planner → creates search block → runs parallel searches with per-result callbacks → finalizes pipeline → streams response. |
| `stopGeneration()` | Must also call `removePipelineBlocks()` to clean up any partial pipeline state. |

### Planner streaming loop (pseudocode)

```js
async function planSearchQueries(userMessage, provider, model, apiKey, onToken) {
  // ... same payload, but stream: true
  const reader = resp.body.getReader();
  let fullContent = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    // ... SSE parsing same as main stream
    if (txtDelta) { fullContent += txtDelta; onToken(txtDelta); }
  }
  // Parse JSON from fullContent
  const json = extractJSON(fullContent);
  return { needs_search: json.needs_search, search_queries: json.search_queries };
}
```

### Search execution with per-result callbacks (pseudocode)

```js
// Fire all queries in parallel, append results as they land
const results = await Promise.allSettled(
  queries.map(q => executeSearch(q, provider).then(items => {
    items.forEach(item => appendSearchResult(searchBlock, item));
    return { query: q, items };
  }))
);
// After all done
collapseSearchBlock(searchBlock, totalResults, provider);
```

## Edge Cases & Error States

| Scenario | Behavior |
|----------|----------|
| No web search enabled | No pipeline blocks. Typing dots → response stream (unchanged) |
| Planner call fails (HTTP error) | Remove planning block. Show toast. Fall back to regex heuristic (`detectSearchNeeded`). Skip to search block if queries found. |
| Planner returns `needs_search: false` or empty queries | Collapse planning → "🔍 No search needed". Skip search block entirely. Go to response stream. |
| Search returns 0 results | Collapse search → "🔍 No results found". Show toast. Proceed to response stream. |
| Some queries fail, some succeed | Failed: "✗ error" bullet in list. Succeeded: normal bullet items. Counter updates accurately. |
| All searches fail | Collapse search → "🔍 Search failed". Show error toast. Proceed to response stream with no search context. |
| User stops generation (ESC) | `stopGeneration()` calls `removePipelineBlocks()` + aborts fetch + removes stream row. |
| User sends another message mid-pipeline | Blocked by `isStreaming` flag (existing guard). |
| Rate limit / auth error mid-stream | Remove all pipeline blocks. Show error toast. Restore input text (existing behavior). |
| Very fast responses (< 1s) | Pipeline blocks render briefly, then collapse. No hanging state — better than invisible wait. |

## Non-changes

- The final AI response block (`appendStreamRow` / `updateStreamRow`) is **unchanged**
- The existing search panel inside the final response (via `renderSearchPanel`) is **retained**
- `showToast()` notifications for search results are **retained** (they serve the final state summary)
- The input footer search indicator (`#search-indicator`) is **unchanged**

## Scope

This is a single-file change to `index.html`. No new files, no new dependencies. Targets approximately:
- ~30 lines of new CSS
- ~120 lines of new JS (8 new functions)
- ~40 lines of modified JS (3 modified functions)
- Total delta: ~190 lines
