const fs = require('fs');
const assert = require('assert');
const jsdom = require('jsdom');
const { JSDOM, VirtualConsole } = jsdom;

const html = fs.readFileSync('index.html', 'utf8');

// ══════════════════════════════════════════
// FAILURE GUARDS
// If the inline script in index.html throws while parsing/executing, the
// window 'load' handler never runs. Without these guards the process would
// exit silently with code 0 and no output. We fail loudly instead.
// ══════════════════════════════════════════
let finished = false;
let loadTimer = null;

function fatal(label, err) {
  if (finished) return;
  finished = true;
  if (loadTimer) clearTimeout(loadTimer);
  console.error('\n❌ FATAL: ' + label);
  if (err) console.error(err.stack || String(err));
  console.error('index.html failed to load/execute — tests did NOT run.');
  process.exit(1);
}

// Forward page console output, but treat uncaught script errors as fatal.
const virtualConsole = new VirtualConsole();
if (typeof virtualConsole.forwardTo === 'function') {
  virtualConsole.forwardTo(console, { jsdomErrors: 'none' }); // jsdom >= 27
} else {
  virtualConsole.sendTo(console, { omitJSDOMErrors: true });  // older jsdom
}
virtualConsole.on('jsdomError', e => {
  // An uncaught exception in the inline script means the tests can never run.
  if (e && e.type === 'unhandled-exception') {
    fatal('Uncaught exception while executing index.html', e.cause || e);
    return;
  }
  // not-implemented / css-parsing / resource-loading are benign jsdom noise.
  console.warn('⚠️  jsdom (' + (e && e.type) + '): ' + (e && e.message));
});

// Hard timeout: catches hangs (script never finishes, load never fires).
loadTimer = setTimeout(() => {
  fatal('Timed out after 15s waiting for window "load" and tests to complete');
}, 15000);

// Node's webcrypto implements crypto.subtle (AES-GCM + PBKDF2), so the real
// encryptSync/decryptSync code paths can be exercised instead of stubbed.
let nodeCrypto = null;
try { nodeCrypto = require('crypto').webcrypto || null; } catch (e) { nodeCrypto = null; }

const dom = new JSDOM(html, {
  url: 'http://localhost',
  runScripts: "dangerously",
  virtualConsole,
  beforeParse(window) {
    window.localStorage = { store: {}, getItem(k) { return this.store[k] || null; }, setItem(k, v) { this.store[k] = String(v); }, removeItem(k) { delete this.store[k]; } };
    if (nodeCrypto) {
      // jsdom's window.crypto is a getter-only accessor; defineProperty is required.
      try { Object.defineProperty(window, 'crypto', { value: nodeCrypto, configurable: true, writable: true }); }
      catch (e) { try { window.crypto = nodeCrypto; } catch (e2) { /* fall through to stub below */ } }
    }
    if (!window.crypto || !window.crypto.subtle) {
      window.crypto = { subtle: { importKey: async () => {}, deriveKey: async () => {}, encrypt: async () => {}, decrypt: async () => {} }, getRandomValues: (arr) => arr };
    }
    window.matchMedia = () => ({ matches: false });
    window.scrollTo = () => {};
    window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
    window.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
    // index.html loads models.js via <script src>, which jsdom does not fetch
    // (resources:"usable" is off). Mirror the real models.js shape here:
    // {label, badge, url, usageUrl?, models:[{id,name,p}]} for all 4 providers.
    // Note: 'kimi-k2.6' intentionally appears in BOTH opencode and neuralwatt
    // (as it does in the real registry) so providerFromModel() preference
    // ordering is actually exercised.
    window.PROVIDERS = {
      groq: { label: 'Groq LPU', badge: 'badge-groq', url: 'https://api.groq.com/openai/v1', models: [
        { id: 'openai/gpt-oss-120b', name: 'GPT-OSS 120B — Reasoning ★', p: '$0.15/$0.60' },
        { id: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B Versatile', p: '$0.59/$0.79' },
        { id: 'llama-3.1-8b-instant', name: 'Llama 3.1 8B Instant (cheapest)', p: '$0.05/$0.08' },
      ] },
      opencode: { label: 'OpenCode Go', badge: 'badge-opencode', usageUrl: 'https://opencode.ai/workspace/usage', url: 'https://proxy.opencodechat.dpdns.org/zen/go/v1', models: [
        { id: 'minimax-m2.7', name: 'MiniMax M2.7', p: '$0.30/$1.20' },
        { id: 'kimi-k2.6', name: 'Kimi K2.6', p: '$0.50/$2.50' },
        { id: 'glm-5.1', name: 'GLM 5.1', p: '$0.95/$3.15' },
      ] },
      openrouter: { label: 'OpenRouter', badge: 'badge-openrouter', usageUrl: 'https://openrouter.ai/activity', url: 'https://openrouter.ai/api/v1', models: [
        { id: 'google/lyria-3-pro-preview', name: '🆓 Google: Lyria 3 Pro Preview (1M)', p: 'FREE' },
        { id: 'inclusionai/ling-3.0-flash:free', name: '🆓 Ling-3.0-flash (free) (256K)', p: 'FREE' },
      ] },
      neuralwatt: { label: 'NeuralWatt', badge: 'badge-neuralwatt', usageUrl: 'https://portal.neuralwatt.com', url: 'https://api.neuralwatt.com/v1', models: [
        { id: 'glm-5.2', name: 'GLM-5.2 — Reasoning ★ (1M ctx)', p: '$1.45/$4.50' },
        { id: 'kimi-k2.6', name: 'Kimi K2.6 — Moonshot (262K)', p: '$0.69/$3.22' },
        { id: 'qwen3.6-35b-fast', name: 'Qwen3.6 35B Fast (cheapest)', p: '$0.29/$1.15' },
      ] },
    };
    // stub out the manifest link so it doesn't crash on null.href
    window.document.addEventListener('DOMContentLoaded', () => {
      const link = window.document.createElement('link');
      link.id = 'manifest-link';
      link.href = 'manifest.json';
      window.document.head.appendChild(link);
    });
  }
});
const window = dom.window;

window.addEventListener('error', e => fatal('window "error" event during index.html execution', e.error || e.message));

let passed = 0, failed = 0, skipped = 0;

async function runTest(name, fn) {
  try {
    await fn();
    console.log('✅ ' + name);
    passed++;
  } catch (e) {
    // Failures go to stdout too: mixing stdout/stderr scrambles the order of
    // the ✅/❌ lines in CI logs and makes failures hard to attribute.
    console.log('❌ ' + name);
    console.log('   ' + e.message.split('\n').join('\n   '));
    failed++;
  }
}
// Values crossing the jsdom realm boundary have different prototypes
// (jsdom's Array !== Node's Array), so deepStrictEqual would fail on
// structurally identical arrays. Normalise into this realm first.
function assertArray(actual, expected, msg) {
  assert.ok(Array.isArray(actual) || (actual && typeof actual.length === 'number'), msg || 'not array-like: ' + actual);
  assert.deepStrictEqual(Array.from(actual), expected, msg);
}
function skipTest(name, why) {
  console.log('⏭️  ' + name + ' — SKIPPED (' + why + ')');
  skipped++;
}

// wait for JSDOM to finish loading and executing scripts
window.addEventListener("load", () => {
  runAll().catch(e => fatal('Unhandled error in the test runner', e));
});

async function runAll() {
  console.log('--- Running Tests ---');

  // ══════════════════════════════════════════
  // esc()
  // ══════════════════════════════════════════
  await runTest("esc() should escape &, <, >, \", and '", () => {
    assert.strictEqual(window.esc('hello & < > " \' world'), 'hello &amp; &lt; &gt; &quot; &#39; world');
  });
  await runTest('esc() should escape & first so entities are not double-decoded', () => {
    assert.strictEqual(window.esc('&amp;'), '&amp;amp;');
    assert.strictEqual(window.esc('<script>alert("x")</script>'), '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
  });
  await runTest('esc() should coerce falsy input to an empty string', () => {
    assert.strictEqual(window.esc(null), '');
    assert.strictEqual(window.esc(undefined), '');
    assert.strictEqual(window.esc(''), '');
    // DISCREPANCY (index.html:4598): esc() uses String(s||'') so the *number*
    // 0 and false collapse to '' instead of '0'/'false'. Documented, not fixed.
    assert.strictEqual(window.esc(0), '');
    assert.strictEqual(window.esc(false), '');
    assert.strictEqual(window.esc(42), '42');
  });

  // ══════════════════════════════════════════
  // fmtText() — markdown
  // ══════════════════════════════════════════
  await runTest('fmtText() should return empty string for empty/nullish input', () => {
    assert.strictEqual(window.fmtText(''), '');
    assert.strictEqual(window.fmtText(null), '');
    assert.strictEqual(window.fmtText(undefined), '');
  });
  await runTest('fmtText() should render basic markdown', () => {
    const meta = {queries: []};
    const html = window.fmtText('Hello **bold** and *italic* and `code`', meta);
    assert.ok(html.includes('<strong>bold</strong>'));
    assert.ok(html.includes('<em>italic</em>'));
    assert.ok(html.includes('<code>code</code>'));
  });
  await runTest('fmtText() should render h1/h2/h3 headings', () => {
    assert.strictEqual(window.fmtText('# Title'), '<h1>Title</h1>');
    assert.strictEqual(window.fmtText('## Title'), '<h2>Title</h2>');
    assert.strictEqual(window.fmtText('### Title'), '<h3>Title</h3>');
    // headings still run inline formatting on their content
    assert.strictEqual(window.fmtText('## **bold** head'), '<h2><strong>bold</strong> head</h2>');
  });
  await runTest('fmtText() should render ***bold italic*** as nested tags', () => {
    assert.strictEqual(window.fmtText('***x***'), '<strong><em>x</em></strong>');
  });
  await runTest('fmtText() should render unordered lists (- and *) as <ul><li>', () => {
    assert.strictEqual(window.fmtText('- one\n- two'), '<ul><li>one</li><li>two</li></ul>');
    assert.strictEqual(window.fmtText('* one\n* two'), '<ul><li>one</li><li>two</li></ul>');
  });
  await runTest('fmtText() should render ordered lists as <ol><li>', () => {
    assert.strictEqual(window.fmtText('1. one\n2. two'), '<ol><li>one</li><li>two</li></ol>');
  });
  await runTest('fmtText() should convert newlines to <br>', () => {
    assert.strictEqual(window.fmtText('a\nb'), 'a<br>b');
  });
  await runTest('fmtText() should render blockquotes (escaped > matched after esc)', () => {
    assert.strictEqual(window.fmtText('> hello'), '<blockquote>hello</blockquote>');
    assert.strictEqual(window.fmtText('> a\n> b'), '<blockquote>a</blockquote><br><blockquote>b</blockquote>');
  });

  // ══════════════════════════════════════════
  // fmtText() — XSS hardening
  // ══════════════════════════════════════════
  await runTest('fmtText() should prevent XSS in markdown elements', () => {
    const meta = {queries: []};
    const xss1 = window.fmtText('**<img src=x onerror=alert(1)>**', meta);
    const xss2 = window.fmtText('### <script>alert(1)</script>', meta);
    assert.ok(!xss1.includes('<img src='), "XSS 1 failed");
    assert.ok(xss1.includes('&lt;img'), "XSS 1 should be escaped");
    assert.ok(!xss2.includes('<script>'), "XSS 2 failed");
    assert.ok(xss2.includes('&lt;script&gt;'), "XSS 2 should be escaped");
  });
  await runTest('fmtText() should escape XSS inside headings and blockquotes', () => {
    const h = window.fmtText('# <svg onload=alert(1)>');
    assert.strictEqual(h, '<h1>&lt;svg onload=alert(1)&gt;</h1>');
    assert.ok(!h.includes('<svg'));
    const bq = window.fmtText('> <script>alert(1)</script>');
    assert.ok(!bq.includes('<script'), 'blockquote XSS leaked');
    assert.ok(bq.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  });
  await runTest('fmtText() should escape XSS inside inline code and fenced blocks', () => {
    const inline = window.fmtText('`<script>alert(1)</script>`');
    assert.strictEqual(inline, '<code>&lt;script&gt;alert(1)&lt;/script&gt;</code>');
    const fenced = window.fmtText('```\n<script>alert(1)</script>\n```');
    assert.strictEqual(fenced, '<pre><code>&lt;script&gt;alert(1)&lt;/script&gt;</code></pre>');
    // quotes inside code must be escaped too (attribute-injection defence)
    assert.strictEqual(window.fmtText('`a "b" \'c\'`'), '<code>a &quot;b&quot; &#39;c&#39;</code>');
  });
  await runTest('fmtText() should NOT process markdown inside code blocks', () => {
    assert.strictEqual(window.fmtText('```\n**not bold**\n```'), '<pre><code>**not bold**</code></pre>');
    assert.strictEqual(window.fmtText('`**not bold**`'), '<code>**not bold**</code>');
    // language hint is consumed, content trimmed
    assert.strictEqual(window.fmtText('```js\nconst a=1;\n```'), '<pre><code>const a=1;</code></pre>');
  });

  // ══════════════════════════════════════════
  // fmtText() — code-block placeholder collision guard
  // ══════════════════════════════════════════
  await runTest('fmtText() should not corrupt a literal ___CODE_BLOCK_N___ in user text', () => {
    assert.strictEqual(window.fmtText('___CODE_BLOCK_0___'), '___CODE_BLOCK_0___');
    assert.ok(window.fmtText('___CODE_BLOCK_0___ text').includes('___CODE_BLOCK_0___'));
    // real block gets substituted, out-of-range literal placeholder survives
    const mixed = window.fmtText('```\nX\n```\nand ___CODE_BLOCK_5___');
    assert.ok(mixed.includes('<pre><code>X</code></pre>'), 'real code block missing');
    assert.ok(mixed.includes('___CODE_BLOCK_5___'), 'literal placeholder was eaten');
  });

  // ══════════════════════════════════════════
  // fmtText() — citation links
  // ══════════════════════════════════════════
  await runTest('fmtText() should turn [N] into a citation link when results exist', () => {
    const out = window.fmtText('See [1]', { results: [{ url: 'https://example.com/a?b=1' }] });
    assert.ok(out.includes('href="https://example.com/a?b=1"'), out);
    assert.ok(out.includes('class="citation-link"'));
    assert.ok(out.includes('rel="noopener noreferrer"'));
    assert.ok(out.includes('>[1]</a>'));
  });
  await runTest('fmtText() should escape quotes in citation URLs', () => {
    const out = window.fmtText('See [1]', { results: [{ url: 'https://e.com/"onmouseover="alert(1)' }] });
    assert.ok(!out.includes('onmouseover="'), 'attribute injection via citation URL: ' + out);
    assert.ok(out.includes('&quot;onmouseover=&quot;alert(1)'), out);
  });
  await runTest('fmtText() should leave out-of-range / url-less citations as literal text', () => {
    assert.strictEqual(window.fmtText('See [9]', { results: [{ url: 'https://e.com' }] }), 'See [9]');
    assert.strictEqual(window.fmtText('See [0]', { results: [{ url: 'https://e.com' }] }), 'See [0]');
    assert.strictEqual(window.fmtText('See [1]', { results: [{ title: 'no url' }] }), 'See [1]');
    assert.strictEqual(window.fmtText('See [1]', { results: [] }), 'See [1]');
    assert.strictEqual(window.fmtText('See [1]'), 'See [1]');
  });

  // ══════════════════════════════════════════
  // renderSearchPanel()
  // ══════════════════════════════════════════
  await runTest('renderSearchPanel() should return "" when there are no results', () => {
    assert.strictEqual(window.renderSearchPanel(undefined), '');
    assert.strictEqual(window.renderSearchPanel({}), '');
    assert.strictEqual(window.renderSearchPanel({ results: [] }), '');
  });
  await runTest('renderSearchPanel() legacy entry (no queries) shows "Search results"', () => {
    const out = window.renderSearchPanel({ provider: 'tavily', results: [{ url: 'https://x.com', title: 'X', snippet: 'y' }] });
    assert.ok(out.includes('🔍 Web search: Search results'), out);
    assert.ok(!out.includes('Web search: &quot;&quot;'), 'legacy entry rendered an empty quoted query');
    assert.ok(out.includes('1 source · Tavily (AI-optimized)'), out);
  });
  await runTest('renderSearchPanel() should quote a single query and pluralise sources', () => {
    const out = window.renderSearchPanel({ provider: 'tavily', queries: ['a b'], results: [{ url: 'https://x.com', title: 'X' }] });
    assert.ok(out.includes('🔍 Web search: &quot;a b&quot;'), out);
    assert.ok(out.includes('1 source ·'), out);
    assert.ok(!out.includes('1 sources'), out);
  });
  await runTest('renderSearchPanel() should join multiple queries with " · "', () => {
    const out = window.renderSearchPanel({ provider: 'serper', queries: ['a', 'b'], results: [{ url: 'https://x.com', title: 'X' }, { url: 'https://y.com', title: 'Y' }] });
    assert.ok(out.includes('&quot;a&quot; · &quot;b&quot;'), out);
    assert.ok(out.includes('2 sources · Serper (Google results)'), out);
  });
  await runTest('renderSearchPanel() should accept a legacy single "query" string', () => {
    const out = window.renderSearchPanel({ provider: 'searxng', query: 'legacy q', results: [{ url: 'https://x.com', title: 'X' }] });
    assert.ok(out.includes('&quot;legacy q&quot;'), out);
    assert.ok(out.includes('SearXNG (self-hosted)'), out);
  });
  await runTest('renderSearchPanel() should escape malicious titles, urls and queries', () => {
    const out = window.renderSearchPanel({
      provider: 'tavily',
      queries: ['<img src=x onerror=alert(1)>'],
      results: [{ url: 'https://x.com/"onx="1', title: '<script>alert(1)</script>', snippet: '<b>snip</b>' }]
    });
    assert.ok(!out.includes('<script>alert(1)</script>'), 'title XSS leaked');
    assert.ok(out.includes('&lt;script&gt;alert(1)&lt;/script&gt;'), out);
    assert.ok(!out.includes('<img src=x'), 'query XSS leaked');
    assert.ok(!out.includes('onx="1"') && out.includes('&quot;onx=&quot;1'), 'url attribute injection: ' + out);
    assert.ok(out.includes('&lt;b&gt;snip&lt;/b&gt;'), 'snippet not escaped');
  });
  await runTest('renderSearchPanel() should fall back to "Source N" and truncate long snippets', () => {
    const long = 'z'.repeat(300);
    const out = window.renderSearchPanel({ provider: 'tavily', results: [{ url: 'https://x.com', snippet: long }] });
    assert.ok(out.includes('>Source 1<'), out);
    assert.ok(out.includes('z'.repeat(220) + '…'), 'snippet not truncated at 220 chars');
    assert.ok(!out.includes('z'.repeat(221)), 'snippet longer than 220 chars');
  });

  // ══════════════════════════════════════════
  // extractThink() / stripThink()
  // ══════════════════════════════════════════
  await runTest('extractThink() should pull out <think> and <thinking> contents', () => {
    assert.strictEqual(window.extractThink('<think>abc</think> rest'), 'abc');
    assert.strictEqual(window.extractThink('<thinking>abc</thinking> rest'), 'abc');
    assert.strictEqual(window.extractThink('<THINK>abc</THINK>'), 'abc');
    assert.strictEqual(window.extractThink('<think>a</think>x<think>b</think>'), 'a\nb');
    assert.strictEqual(window.extractThink('no think here'), '');
  });
  await runTest('stripThink() should remove think blocks and trim', () => {
    assert.strictEqual(window.stripThink('<think>abc</think> rest'), 'rest');
    assert.strictEqual(window.stripThink('<thinking>abc</thinking>\n\n  rest  '), 'rest');
    assert.strictEqual(window.stripThink('<think>multi\nline</think>answer'), 'answer');
    assert.strictEqual(window.stripThink('plain'), 'plain');
  });

  // ══════════════════════════════════════════
  // fmtChatItemDate() — compact sidebar timestamps
  // ══════════════════════════════════════════
  await runTest('fmtChatItemDate() should show time only for today and yesterday', () => {
    const NOW = new Date(2026, 6, 15, 12, 0, 0).getTime(); // Jul 15 2026 12:00 local
    assert.strictEqual(window.fmtChatItemDate(NOW, NOW), window.fmtTime(NOW));
    assert.strictEqual(window.fmtChatItemDate(NOW - 86400000, NOW), window.fmtTime(NOW - 86400000));
    assert.ok(!window.fmtChatItemDate(NOW, NOW).includes('·'));
  });
  await runTest('fmtChatItemDate() should show short date + time for older same-year items', () => {
    const NOW = new Date(2026, 6, 15, 12, 0, 0).getTime();
    const older = new Date(2026, 5, 13, 10, 30, 0).getTime(); // Jun 13 2026
    const expectedDate = new Date(older).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    assert.strictEqual(window.fmtChatItemDate(older, NOW), expectedDate + ' · ' + window.fmtTime(older));
  });
  await runTest('fmtChatItemDate() should include the year when it differs', () => {
    const NOW = new Date(2026, 6, 15, 12, 0, 0).getTime();
    const old = new Date(2025, 5, 13, 10, 30, 0).getTime(); // Jun 13 2025
    const expectedDate = new Date(old).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    assert.strictEqual(window.fmtChatItemDate(old, NOW), expectedDate + ' · ' + window.fmtTime(old));
  });

  // ══════════════════════════════════════════
  // fmtPrice()
  // ══════════════════════════════════════════
  await runTest('fmtPrice() should pick precision by magnitude', () => {
    assert.strictEqual(window.fmtPrice(0), '0');
    assert.strictEqual(window.fmtPrice(0.005), '0.0050');   // < 0.01 → 4dp
    assert.strictEqual(window.fmtPrice(0.15), '0.150');     // < 1    → 3dp
    assert.strictEqual(window.fmtPrice(1.5), '1.50');       // >= 1   → 2dp
    assert.strictEqual(window.fmtPrice(0.0099), '0.0099');
    assert.strictEqual(window.fmtPrice(12.345), '12.35');
  });
  await runTest('fmtPrice() has NO nullish guard (documented gap)', () => {
    // DISCREPANCY (index.html:3382): fmtPrice() does not guard undefined/null,
    // so it throws on `.toFixed`. Callers must pre-validate. NaN returns 'NaN'.
    // (Matched by message, not by `TypeError`: the error comes from jsdom's
    // realm so it is not an instanceof this realm's TypeError.)
    assert.throws(() => window.fmtPrice(undefined), /toFixed/);
    assert.throws(() => window.fmtPrice(null), /toFixed/);
    assert.strictEqual((() => { try { window.fmtPrice(undefined); } catch (e) { return e.name; } })(), 'TypeError');
    assert.strictEqual(window.fmtPrice(NaN), 'NaN');
  });

  // ══════════════════════════════════════════
  // providerFromModel()
  // ══════════════════════════════════════════
  await runTest('providerFromModel() should resolve ids from the registry', () => {
    assert.strictEqual(window.providerFromModel('minimax-m2.7'), 'opencode');
    assert.strictEqual(window.providerFromModel('llama-3.1-8b-instant'), 'groq');
    assert.strictEqual(window.providerFromModel('inclusionai/ling-3.0-flash:free'), 'openrouter');
  });
  await runTest('providerFromModel() should prefer opencode for ids shared with neuralwatt', () => {
    // 'kimi-k2.6' exists in both; the preferred list puts opencode first.
    assert.strictEqual(window.providerFromModel('kimi-k2.6'), 'opencode');
  });
  await runTest('providerFromModel() should find neuralwatt-only ids via the fallback scan', () => {
    // neuralwatt is NOT in the `preferred` array, so this exercises the
    // Object.entries(PROVIDERS) loop at index.html:3800.
    assert.strictEqual(window.providerFromModel('qwen3.6-35b-fast'), 'neuralwatt');
    assert.strictEqual(window.providerFromModel('glm-5.2'), 'neuralwatt');
  });
  await runTest('providerFromModel() should apply the minimax heuristic then default to groq', () => {
    assert.strictEqual(window.providerFromModel('unregistered-model-xyz'), 'groq');
    assert.strictEqual(window.providerFromModel(''), 'groq');
    assert.strictEqual(window.providerFromModel(null), 'groq');
    assert.strictEqual(window.providerFromModel('some-minimax-thing'), 'opencode');
    assert.strictEqual(window.providerFromModel('MiniMax-Unlisted'), 'opencode');
  });

  // ══════════════════════════════════════════
  // wordCount() / fmtSize() / fileIcon()
  // ══════════════════════════════════════════
  await runTest('wordCount() should count whitespace-separated words', () => {
    assert.strictEqual(window.wordCount('a b  c'), 3);
    assert.strictEqual(window.wordCount(' one\ttwo\nthree '), 3);
    assert.strictEqual(window.wordCount(''), 0);
    assert.strictEqual(window.wordCount('   '), 0);
    assert.strictEqual(window.wordCount(null), 0);
  });
  await runTest('fmtSize() should format bytes/KB/MB', () => {
    assert.strictEqual(window.fmtSize(5), '5B');
    assert.strictEqual(window.fmtSize(0), '0B');
    assert.strictEqual(window.fmtSize(1025), '1KB');
    assert.strictEqual(window.fmtSize(2 * 1024 * 1024 + 1), '2.0MB');
    // DISCREPANCY (index.html:4600): boundaries use `>` not `>=`, so exactly
    // 1024 renders as '1024B' and exactly 1MB renders in KB.
    assert.strictEqual(window.fmtSize(1024), '1024B');
    assert.strictEqual(window.fmtSize(1024 * 1024), '1024KB');
  });
  await runTest('fileIcon() should map extensions and default to 📄', () => {
    assert.strictEqual(window.fileIcon('test.py'), '🐍');
    assert.strictEqual(window.fileIcon('a.md'), '📝');
    assert.strictEqual(window.fileIcon('a.pdf'), '📕');
    assert.strictEqual(window.fileIcon('A.PY'), '🐍', 'extension match should be case-insensitive');
    assert.strictEqual(window.fileIcon('x.zzz'), '📄');
    assert.strictEqual(window.fileIcon('noextension'), '📄');
  });

  // ══════════════════════════════════════════
  // chunkText()
  // ══════════════════════════════════════════
  await runTest('chunkText() should chunk long text correctly', () => {
    const chunks = window.chunkText('A\n\n'.repeat(20000));
    assert.ok(chunks.length > 1, 'Length is ' + chunks.length);
    assert.ok(chunks[0].length <= 50000);
  });
  await runTest('chunkText() should return a single chunk for short input', () => {
    assertArray(window.chunkText('hello world'), ['hello world']);
    // Behaviour check (index.html:2897): the early return is `return [text]`,
    // so empty/nullish input yields a 1-element array holding that value —
    // NOT an empty array. Callers must tolerate ['']/[null].
    assertArray(window.chunkText(''), ['']);
    assertArray(window.chunkText(null), [null]);
  });
  await runTest('chunkText() should honour a custom targetTokens and preserve content', () => {
    const text = ('para-' + 'x'.repeat(200) + '\n\n').repeat(30);
    const chunks = window.chunkText(text, 100); // 400 chars target
    assert.ok(chunks.length > 1, 'expected multiple chunks, got ' + chunks.length);
    assert.ok(chunks.every(c => typeof c === 'string' && c.length > 0));
    assert.ok(chunks.join('').includes('para-'), 'content lost during chunking');
  });

  // ══════════════════════════════════════════
  // detectSearchNeeded()
  // ══════════════════════════════════════════
  await runTest('detectSearchNeeded() should detect search intent', () => {
    assert.strictEqual(window.detectSearchNeeded('search for news today').needed, true);
    assert.strictEqual(window.detectSearchNeeded('what is the weather right now').needed, true);
    assert.strictEqual(window.detectSearchNeeded('write a python script to reverse a string').needed, false);
  });
  await runTest('detectSearchNeeded() should return false for evergreen questions', () => {
    for (const q of ['hello', 'what is 2+2', 'explain recursion', 'refactor this function', 'translate hola to english']) {
      assert.strictEqual(window.detectSearchNeeded(q).needed, false, 'expected needed=false for: ' + q);
    }
  });
  await runTest('detectSearchNeeded() should match the time-sensitive pattern families', () => {
    for (const q of ['who is the CEO of Acme', 'bitcoin price of a coin', 'latest release date', 'the 2025 election result']) {
      assert.strictEqual(window.detectSearchNeeded(q).needed, true, 'expected needed=true for: ' + q);
    }
  });
  await runTest('detectSearchNeeded() should clean the extracted query', () => {
    // strips conversational openers + trailing "?"
    assert.strictEqual(window.detectSearchNeeded('explain recursion').query, 'explain recursion');
    assert.strictEqual(window.detectSearchNeeded('can you explain recursion?').query, 'explain recursion');
    assert.strictEqual(window.detectSearchNeeded('what is 2+2').query, '2+2');
    // first sentence only + compound clause dropped
    assert.strictEqual(window.detectSearchNeeded('explain foo. then bar').query, 'explain foo');
    assert.strictEqual(window.detectSearchNeeded('explain foo and how does bar work').query, 'explain foo');
    // caps at 90 chars
    assert.ok(window.detectSearchNeeded('x'.repeat(200)).query.length <= 90);
  });
  await runTest('detectSearchNeeded() should append the current year when needed and absent', () => {
    const year = String(new Date().getFullYear());
    const withoutYear = window.detectSearchNeeded('news today');
    assert.strictEqual(withoutYear.needed, true);
    assert.ok(withoutYear.query.endsWith(year), withoutYear.query);
    const withYear = window.detectSearchNeeded('news from 2024');
    assert.strictEqual(withYear.needed, true);
    assert.strictEqual(withYear.query, 'news from 2024', 'should not double-append a year');
    // no year appended when search is not needed
    assert.ok(!window.detectSearchNeeded('explain recursion').query.includes(year));
  });

  // ══════════════════════════════════════════
  // encryptSync() / decryptSync()  (AES-GCM + PBKDF2 via crypto.subtle)
  // Uses Node's require('crypto').webcrypto injected in beforeParse. If that
  // injection ever fails (very old Node, or jsdom locking down window.crypto)
  // these are skipped rather than faked, because the stubbed subtle would
  // assert nothing meaningful.
  // ══════════════════════════════════════════
  const cryptoOk = !!(window.crypto && window.crypto.subtle && nodeCrypto && window.crypto === nodeCrypto);
  if (!cryptoOk) {
    skipTest('encryptSync()/decryptSync() round-trip', 'window.crypto.subtle is stubbed — real WebCrypto unavailable');
  } else {
    await runTest('encryptSync() should return a 3-part salt:iv:cipher payload', async () => {
      const out = await window.encryptSync('hello', 'pass');
      const parts = out.split(':');
      assert.strictEqual(parts.length, 3, 'expected salt:iv:cipher, got: ' + out);
      assert.ok(parts.every(p => p.length > 0), 'empty payload segment: ' + out);
      assert.ok(!out.includes('hello'), 'plaintext leaked into ciphertext');
    });
    await runTest('encryptSync() should use a random salt+iv per call', async () => {
      const a = await window.encryptSync('same', 'pass');
      const b = await window.encryptSync('same', 'pass');
      assert.notStrictEqual(a, b, 'identical ciphertexts — salt/iv not randomised');
    });
    await runTest('decryptSync() should round-trip the new 3-part format', async () => {
      const out = await window.encryptSync('hello', 'pass');
      assert.strictEqual(await window.decryptSync(out, 'pass'), 'hello');
      const json = JSON.stringify({ chats: [{ id: 1, title: 'ünïcødé 😀' }] });
      assert.strictEqual(await window.decryptSync(await window.encryptSync(json, 'pw'), 'pw'), json);
    });
    await runTest('decryptSync() should still read the legacy 2-part iv:cipher format', async () => {
      // Legacy payloads were encrypted with the hardcoded salt (deriveKey(pw, null)).
      const key = await window.deriveKey('pass', null);
      const iv = window.crypto.getRandomValues(new Uint8Array(12));
      const cipher = await window.crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new window.TextEncoder().encode('legacy-secret'));
      const payload = window.arrayBufferToBase64(iv) + ':' + window.arrayBufferToBase64(cipher);
      assert.strictEqual(payload.split(':').length, 2);
      assert.strictEqual(await window.decryptSync(payload, 'pass'), 'legacy-secret');
    });
    await runTest('decryptSync() should reject malformed payloads and wrong passphrases', async () => {
      await assert.rejects(() => window.decryptSync('onlyonepart', 'pass'), /Invalid encrypted payload format/);
      await assert.rejects(() => window.decryptSync('a:b:c:d', 'pass'), /Invalid encrypted payload format/);
      const out = await window.encryptSync('secret', 'right');
      await assert.rejects(() => window.decryptSync(out, 'wrong'));
    });
  }

  // ══════════════════════════════════════════
  finished = true;
  if (loadTimer) clearTimeout(loadTimer);
  console.log('\nResults: ' + passed + ' passed, ' + failed + ' failed' + (skipped ? ', ' + skipped + ' skipped' : ''));
  // Explicit exit: jsdom keeps timers/handles alive, so returning is not enough.
  process.exit(failed > 0 ? 1 : 0);
}
