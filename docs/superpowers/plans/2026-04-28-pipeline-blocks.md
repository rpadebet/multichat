# Pipeline Progress Blocks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show progressive pipeline blocks (Planning → Searching → Responding) inline in chat so users see live activity during the send→search→response flow. Blocks auto-collapse into a compact breadcrumb when the final answer arrives.

**Architecture:** Three inline `.msg-row` blocks stack during the pipeline: a **Planning** block that streams planner thinking tokens, a **Searching** block that shows results trickling in as parallel queries resolve, and the existing **Response** stream block. After completion, the first two collapse into a clickable breadcrumb. All changes are in `index.html` — no new files.

**Tech Stack:** Vanilla HTML/CSS/JS, no dependencies, no build tools.

---

### Task 1: Add CSS for pipeline blocks

**Files:**
- Modify: `index.html:575` (after `#search-indicator`, before typing indicator CSS)

- [ ] **Step 1: Insert pipeline CSS at line 575**

Insert this CSS block after the `#search-indicator` rule (line 575) and before the typing indicator comment (line 577):

```css
/* ── Pipeline progress blocks ──
   Inline chat blocks showing Planning → Searching phases before the final
   AI response. Each block uses .msg-row styling with a phase badge pill.
   All blocks auto-collapse to a breadcrumb when their phase completes. */
.phase-badge{
  display:inline-flex;align-items:center;gap:4px;
  padding:2px 8px;border-radius:12px;
  font-size:11px;font-family:var(--font-mono);
  background:var(--accent-bg);color:var(--accent);
  border:1px solid var(--accent-border);
  animation:badgePulse 1.8s ease-in-out infinite;
}
@keyframes badgePulse{0%,100%{opacity:1;}50%{opacity:0.55;}}
.phase-badge.done{animation:none;background:var(--bg3);color:var(--text3);border-color:var(--border);}

/* Search bullet list — minimal inline results appearing as queries resolve */
.search-bullet-list{list-style:none;margin:8px 0 0;padding:0;}
.search-bullet-result{
  padding:5px 0;border-bottom:1px solid var(--border);
  animation:msgIn 0.25s ease forwards;
  cursor:pointer;
}
.search-bullet-result:last-child{border-bottom:none;padding-bottom:0;}
.sb-title{font-size:12px;font-weight:500;color:var(--text);display:block;line-height:1.4;margin-bottom:1px;}
.sb-url{font-size:10px;font-family:var(--font-mono);color:var(--accent);text-decoration:none;display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.sb-snippet{font-size:11px;color:var(--text3);line-height:1.45;display:block;margin-top:2px;}

/* Pipeline breadcrumb — compact one-liner after phases collapse */
.pipeline-breadcrumb{cursor:pointer;transition:background 0.15s;border-radius:var(--radius);}
.pipeline-breadcrumb:hover{background:var(--bg3);}
.pipeline-breadcrumb .crumb-label{font-size:12px;color:var(--text2);}
.pipeline-breadcrumb:hover .crumb-label{color:var(--text);}
.pipeline-breadcrumb .crumb-chev{font-size:8px;transition:transform 0.18s;margin-left:4px;color:var(--text3);}
.pipeline-breadcrumb.expanded .crumb-chev{transform:rotate(90deg);}
```

- [ ] **Step 2: Commit**

```bash
git add index.html
git commit -m "style: add pipeline progress block CSS classes"
```

---

### Task 2: Add pipeline DOM helper functions

**Files:**
- Modify: `index.html:1641` (after `setTypingSearchStatus`, before `SEARCH_PATTERNS`)

- [ ] **Step 1: Insert pipeline helper functions after `setTypingSearchStatus`**

Insert this code after the closing `}` of `setTypingSearchStatus` (line 1641) and before the `// ── Heuristic search detection` comment (line 1643):

```js
// ══════════════════════════════════════════
// PIPELINE PROGRESS BLOCKS
// ══════════════════════════════════════════

let pipelineBlocks = []; // track planning+search blocks for cleanup

function appendPlanningBlock() {
  const msgs = document.getElementById('messages');
  const row = document.createElement('div');
  row.id = 'pipeline-plan'; row.className = 'msg-row pipeline-block';
  row.innerHTML = `<div class="msg-inner"><div class="avatar av-ai" style="font-size:11px;">🔍</div><div class="msg-body">
    <div class="msg-meta">
      <span class="msg-name">MultiChat</span>
      <span class="phase-badge" id="plan-badge">Planning</span>
    </div>
    <div class="think-block" style="display:block;margin-top:6px;">
      <div class="think-body vis" id="plan-think-body" style="font-size:12px;color:var(--text3);">Analyzing query…</div>
    </div>
  </div></div>`;
  msgs.appendChild(row);
  pipelineBlocks.push(row);
  msgs.scrollTop = msgs.scrollHeight;
  return { row, thinkEl: document.getElementById('plan-think-body'), badgeEl: document.getElementById('plan-badge') };
}

function updatePlanningBlock(block, text) {
  if (!block?.thinkEl) return;
  block.thinkEl.textContent += text;
  document.getElementById('messages').scrollTop = 99999;
}

function collapsePlanningBlock(queries, block) {
  if (!queries || !queries.length) {
    block.row.remove();
    pipelineBlocks = pipelineBlocks.filter(b => b !== block.row);
    return;
  }
  const badge = block.badgeEl;
  if (badge) { badge.textContent = `Planned ${queries.length} quer${queries.length===1?'y':'ies'}`; badge.classList.add('done'); }
  block.thinkEl.style.display = 'none';
}

function appendSearchBlock(n) {
  const msgs = document.getElementById('messages');
  const row = document.createElement('div');
  row.id = 'pipeline-search'; row.className = 'msg-row pipeline-block';
  row.innerHTML = `<div class="msg-inner"><div class="avatar av-ai" style="font-size:11px;">🔍</div><div class="msg-body">
    <div class="msg-meta">
      <span class="msg-name">MultiChat</span>
      <span class="phase-badge" id="search-badge">Searching · 0 of ${n}</span>
    </div>
    <ul class="search-bullet-list" id="search-bullets"></ul>
  </div></div>`;
  msgs.appendChild(row);
  pipelineBlocks.push(row);
  msgs.scrollTop = msgs.scrollHeight;
  return { row, listEl: document.getElementById('search-bullets'), badgeEl: document.getElementById('search-badge'), total: n, count: 0 };
}

function appendSearchResult(block, result) {
  if (!block?.listEl) return false;
  const { title, url, snippet } = result || {};
  if (!title && !url && !snippet) return false;
  const li = document.createElement('li');
  li.className = 'search-bullet-result';
  li.title = 'Click to open source';
  li.onclick = function(){ if(url) window.open(url, '_blank', 'noopener,noreferrer'); };
  const shortUrl = (url || '').replace(/^https?:\/\//, '').slice(0, 70);
  li.innerHTML = `<span class="sb-title">${esc(title || 'Source')}</span>
    ${url ? `<a class="sb-url" href="${esc(url)}" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation()">${esc(shortUrl)}</a>` : ''}
    ${snippet ? `<span class="sb-snippet">${esc(snippet.slice(0,250))}${snippet.length>250?'…':''}</span>` : ''}`;
  block.listEl.appendChild(li);
  block.count++;
  block.badgeEl.textContent = `Searching · ${block.count} of ${block.total}`;
  document.getElementById('messages').scrollTop = 99999;
  return true;
}

function collapseSearchBlock(block, total, provider) {
  if (!block?.row) return;
  const badge = block.badgeEl;
  const provLabel = SEARCH_PROVIDERS[provider]?.label || provider;
  if (total > 0) {
    if (badge) { badge.textContent = `${total} source${total===1?'':'s'} via ${provLabel}`; badge.classList.add('done'); }
  } else {
    if (badge) { badge.textContent = 'No results'; badge.classList.add('done'); badge.style.color = 'var(--red)'; }
  }
}

function removePipelineBlocks() {
  pipelineBlocks.forEach(b => b.remove());
  pipelineBlocks = [];
  const crumb = document.getElementById('pipeline-crumb');
  if (crumb) crumb.remove();
}

function finalizePipeline(queries, total, provider) {
  // Collapse planning block
  const planRow = document.getElementById('pipeline-plan');
  if (planRow) {
    const planBadge = planRow.querySelector('.phase-badge');
    const thinkEl = planRow.querySelector('.think-body');
    if (queries && queries.length) {
      if (planBadge) { planBadge.textContent = `Planned ${queries.length} quer${queries.length===1?'y':'ies'}`; planBadge.classList.add('done'); }
      if (thinkEl) thinkEl.style.display = 'none';
    } else {
      planRow.remove();
      pipelineBlocks = pipelineBlocks.filter(b => b !== planRow);
    }
  }

  // Collapse search block
  const searchRow = document.getElementById('pipeline-search');
  if (searchRow) {
    const searchBadge = searchRow.querySelector('.phase-badge');
    const provLabel = SEARCH_PROVIDERS[provider]?.label || provider;
    if (total > 0) {
      if (searchBadge) { searchBadge.textContent = `${total} source${total===1?'':'s'} via ${provLabel}`; searchBadge.classList.add('done'); }
    } else {
      if (searchBadge) { searchBadge.textContent = 'No results'; searchBadge.classList.add('done'); searchBadge.style.color = 'var(--red)'; }
      searchRow.remove();
      pipelineBlocks = pipelineBlocks.filter(b => b !== searchRow);
    }
  }

  // Determine breadcrumb text
  const crumbs = [];
  if (queries?.length) crumbs.push(`Planned ${queries.length} quer${queries.length===1?'y':'ies'}`);
  if (total > 0) crumbs.push(`${total} source${total===1?'':'s'} via ${SEARCH_PROVIDERS[provider]?.label || provider}`);
  if (!crumbs.length) return;

  // Append breadcrumb (above the coming stream row)
  const msgs = document.getElementById('messages');
  const crumb = document.createElement('div');
  crumb.id = 'pipeline-crumb'; crumb.className = 'msg-row pipeline-breadcrumb collapsed';
  crumb.onclick = function(){ this.classList.toggle('expanded'); togglePipelineDetail(); };
  crumb.innerHTML = `<div class="msg-inner">
    <div class="avatar av-ai" style="font-size:10px;">🔍</div>
    <div class="msg-body"><span class="crumb-label">${crumbs.join(' · ')}</span><span class="crumb-chev">▸</span></div>
  </div>`;
  msgs.appendChild(crumb);
  msgs.scrollTop = msgs.scrollHeight;

  // Store expansion state as data attributes on the crumb
  crumb._planRow = planRow;
  crumb._searchRow = searchRow;
}

function togglePipelineDetail() {
  const crumb = document.getElementById('pipeline-crumb');
  if (!crumb) return;
  const expanded = crumb.classList.contains('expanded');
  const planRow = crumb._planRow;
  const searchRow = crumb._searchRow;
  if (expanded) {
    if (planRow) planRow.style.display = '';
    if (searchRow) searchRow.style.display = '';
  } else {
    if (planRow) planRow.style.display = 'none';
    if (searchRow) searchRow.style.display = 'none';
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add index.html
git commit -m "feat: add pipeline DOM helper functions"
```

---

### Task 3: Make planSearchQueries streaming with onToken callback

**Files:**
- Modify: `index.html:1747-1795` (`planSearchQueries` function)

- [ ] **Step 1: Replace planSearchQueries with streaming version**

Replace the current `planSearchQueries` function (lines 1747-1795) with this streaming version:

```js
// ── Two-phase LLM search planner ──
// Phase 1: sends a streaming request to the active model asking it to decide
// whether web search is needed and what queries to run. Streams thinking tokens
// via onToken callback so the Planning block shows live progress. Falls back
// silently to the regex heuristic (detectSearchNeeded) if the LLM call fails.
async function planSearchQueries(userMessage, provider, model, apiKey, onToken) {
  const yr = new Date().getFullYear();
  const systemPrompt = `You are a web search query planner. Today: ${new Date().toLocaleDateString('en-US', {year:'numeric',month:'long',day:'numeric'})}.

Your job: read the user's message and output a JSON object deciding whether web search is needed and what queries to run.

needs_search = true for: current prices/stocks/crypto, live data, news from 2024 onwards, recent product releases, current events, status of living people/companies.
needs_search = false for: definitions, explanations, math, coding, creative tasks, history before 2024.

Query rules:
- One query per DISTINCT information need — if user asks about 2 separate topics, output 2 queries
- Never combine unrelated topics into one query
- 4-8 words each, include ${yr} for time-sensitive data
- Maximum 3 queries

You MUST output ONLY a raw JSON object. No markdown. No explanation. No code fences. Just the JSON:
{"needs_search": true, "search_queries": ["query 1", "query 2"]}`;

  try {
    const providerUrl = PROVIDERS[provider]?.url;
    if (!providerUrl) throw new Error('Unknown provider');
    const resp = await fetch(providerUrl + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage.slice(0, 600) }
        ],
        max_tokens: 200,
        temperature: 0.1,
        stream: true,
        ...(provider === 'openrouter' ? {} : {})
      })
    });
    if (!resp.ok) throw new Error(`Planner HTTP ${resp.status}`);

    const reader = resp.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    let fullContent = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\n'); buf = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') continue;
        try {
          const j = JSON.parse(data);
          const d = j.choices?.[0]?.delta;
          if (!d) continue;
          const txtDelta = d.content || '';
          if (txtDelta) { fullContent += txtDelta; if (onToken) onToken(txtDelta); }
        } catch (e) {}
      }
    }

    let raw = fullContent;
    // Strip markdown code fences if present
    raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
    const plan = JSON.parse(raw);
    if (typeof plan.needs_search !== 'boolean' || !Array.isArray(plan.search_queries)) throw new Error('Bad plan format');
    return { needs_search: plan.needs_search, search_queries: plan.search_queries.filter(q => q?.trim()).slice(0, 3) };
  } catch (e) {
    // Fallback: use regex heuristic
    const fallback = detectSearchNeeded(userMessage);
    return { needs_search: fallback.needed, search_queries: fallback.needed ? [fallback.query] : [] };
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add index.html
git commit -m "feat: make planSearchQueries streaming with onToken callback"
```

---

### Task 4: Modify sendMessage to orchestrate pipeline

**Files:**
- Modify: `index.html:3021-3213` (`sendMessage` function, lines 3054-3110 section)

- [ ] **Step 1: Replace the typing-indicator + search section in sendMessage**

Replace lines 3054-3109 (from `appendTypingIndicator();` through `setTypingSearchStatus(null);` } ) with this pipeline-orchestrated version:

```js
  appendTypingIndicator();

  isStreaming = true;
  document.getElementById('send-btn').disabled = true;

  const settings = getSettings();

  // ── Pre-flight web search (two-phase: LLM plans queries → parallel search) ──
  lastSearchMeta = null;
  const wss = JSON.parse(localStorage.getItem('mc_settings') || '{}');
  if (wss.webSearchEnabled) {
    const searchProvider = wss.webSearchProvider || 'tavily';
    removeTypingIndicator();

    // Phase 1: Stream planner thinking into Planning block
    const planBlock = appendPlanningBlock();
    let plan = { needs_search: false, search_queries: [] };
    try {
      const currentModel = document.getElementById('model-sel').value;
      plan = await planSearchQueries(text, provider, currentModel, apiKey, (token) => {
        updatePlanningBlock(planBlock, token);
      });
      collapsePlanningBlock(plan.search_queries, planBlock);
    } catch (searchErr) {
      showToast(`🔍 Planner error: ${searchErr.message}`, 'err');
      planBlock.row.remove();
      pipelineBlocks = pipelineBlocks.filter(b => b !== planBlock.row);
    }

    let queriesToRun = plan.search_queries;
    const shouldSearch = wss.webSearchMode === 'always'
      ? (queriesToRun.length > 0 || (queriesToRun = [detectSearchNeeded(text).query || text.slice(0, 80)], true))
      : (wss.webSearchMode === 'auto' && plan.needs_search && queriesToRun.length > 0);

    if (shouldSearch && queriesToRun.length > 0) {
      // Phase 2: Execute queries, appending results to Search block as they resolve
      const searchBlock = appendSearchBlock(queriesToRun.length);

      const results = await Promise.allSettled(
        queriesToRun.map(q =>
          executeSearch(q, searchProvider)
            .then(items => {
              (items || []).forEach(item => appendSearchResult(searchBlock, item));
              return { query: q, items };
            })
            .catch(e => {
              appendSearchResult(searchBlock, { title: '✗ Error', snippet: e.message });
              return { query: q, items: [], error: e.message };
            })
        )
      );

      const succeeded = results.filter(r => r.status === 'fulfilled' && r.value.items?.length > 0).map(r => r.value);
      const allItems = succeeded.flatMap(r => r.items);

      if (allItems.length > 0) {
        lastSearchMeta = { queries: queriesToRun, provider: searchProvider, results: allItems, grouped: succeeded };
        collapseSearchBlock(searchBlock, allItems.length, searchProvider);
        const provLabel = SEARCH_PROVIDERS[searchProvider]?.label || searchProvider;
        showToast(`🔍 ${allItems.length} source${allItems.length===1?'':'s'} via ${provLabel} (${queriesToRun.length} quer${queriesToRun.length===1?'y':'ies'})`);
      } else {
        collapseSearchBlock(searchBlock, 0, searchProvider);
        showToast('🔍 Search returned no results — model will answer from training data');
      }

      const failed = results.filter(r => r.status === 'rejected' || (r.status === 'fulfilled' && r.value.error));
      if (failed.length > 0) {
        const errMsg = failed[0].status === 'rejected' ? failed[0].reason?.message : failed[0].value.error;
        showToast(`🔍 ${failed.length} quer${failed.length===1?'y':'ies'} failed: ${errMsg}`, 'err');
      }

    } else {
      // No search needed — try to collapse planning, or clean up
      const planRow = document.getElementById('pipeline-plan');
      if (planRow) { planRow.remove(); pipelineBlocks = pipelineBlocks.filter(b => b !== planRow); }
    }

    // Finalize pipeline: collapse blocks, add breadcrumb
    finalizePipeline(queriesToRun, lastSearchMeta?.results?.length || 0, searchProvider);

    // Re-show typing indicator while main model call starts
    appendTypingIndicator();
  }
```

- [ ] **Step 2: Verify the rest of sendMessage is intact**

Read the section from line 3111 onwards to confirm the existing `buildApiMessages`, `payload`, `fetch`, and streaming loop code is unchanged after the edit. The code from `// Build API messages (with search context injected if available)` through the end of `sendMessage` must remain as-is.

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat: orchestrate pipeline blocks in sendMessage flow"
```

---

### Task 5: End-to-end verification

**Files:**
- Verify: `index.html` (no edits)

- [ ] **Step 1: Open index.html in a browser**

Open `index.html` directly in a browser (no server required — the app is self-contained).

- [ ] **Step 2: Verify basic pipeline (with web search off)**

1. Add an API key in Settings
2. Select a provider/model
3. Ensure web search is **off** in Settings
4. Send a message
5. **Expected:** Typing dots appear briefly, then response streams as before. No pipeline blocks appear. No breadcrumb. Behavior is identical to current.

- [ ] **Step 3: Verify search pipeline appears**

1. Enable web search in Settings (Toggle ON)
2. Send a message that requires search (e.g., "What is Bitcoin's price right now?")
3. **Expected:** 
   - 🔍 Planning block appears with streaming thinking tokens
   - Planning block collapses → badge reads "Planned N queries"
   - 🔍 Searching block appears with counter incrementing
   - Search results appear as bullet items one-by-one
   - Searching block collapses → badge reads "N sources via Tavily"
   - Breadcrumb appears: "Planned N queries · N sources via Tavily"
   - Typing dots appear briefly
   - AI response streams normal

- [ ] **Step 4: Verify breadcrumb collapse/expand**

1. After a search completes, click the breadcrumb
2. **Expected:** Planning and Search blocks toggle visibility. Chevron rotates.
3. Click again — blocks hide. Chevron returns.

- [ ] **Step 5: Verify planner failure fallback**

1. Use a provider that might not support streaming for small models (or temporarily break the planner URL)
2. Send a search-requiring message
3. **Expected:** Toast shows "Planner error: ...", planning block removed, falls back to regex heuristic, search block still appears with regex query results.

- [ ] **Step 6: Verify search with 0 results**

1. Search for something that returns no results (e.g., a query of gibberish like "xyzzy glorp blorf 239847298")
2. **Expected:** Search block appears, shows "No results" badge, toast says "Search returned no results", response still streams from training data.
