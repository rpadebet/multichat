const fs = require('fs');
const https = require('https');

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Node.js Model Updater' } }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

function fmtPrice(n) {
  if (!n || isNaN(n) || n === 0) return '0';
  if (n < 0.01) return n.toFixed(4);
  if (n < 1) return n.toFixed(3);
  return n.toFixed(2);
}

function fmtCtx(n) {
  if (n >= 1000000) return (n/1000000).toFixed(0)+'M';
  if (n >= 1000) return Math.round(n/1024)+'K';
  return n;
}

async function run() {
  console.log('Fetching latest models from OpenRouter and OpenCode Go...');

  const [orData, ocData] = await Promise.all([
    fetchJson('https://openrouter.ai/api/v1/models'),
    fetchJson('https://opencode.ai/zen/go/v1/models')
  ]);

  const openrouterModels = orData.data || [];
  const opencodeModels = ocData.data || [];

  // Sort OpenRouter models: free first, then by context window descending
  const orSorted = openrouterModels.sort((a, b) => {
    const aFree = parseFloat(a.pricing?.prompt || '1') === 0;
    const bFree = parseFloat(b.pricing?.prompt || '1') === 0;
    if (aFree && !bFree) return -1;
    if (!aFree && bFree) return 1;
    return (b.context_length || 0) - (a.context_length || 0);
  }).slice(0, 40);

  const formattedOr = orSorted.map(m => {
    const inP = parseFloat(m.pricing?.prompt || '0');
    const outP = parseFloat(m.pricing?.completion || '0');
    const isFree = inP === 0 && outP === 0;
    const priceStr = isFree ? 'FREE' : `$${fmtPrice(inP*1e6)}/$${fmtPrice(outP*1e6)}`;
    const freeTag = isFree ? '🆓 ' : '';
    const ctx = m.context_length ? ` (${fmtCtx(m.context_length)})` : '';
    const cleanName = `${freeTag}${m.name || m.id}${ctx}`.replace(/[\r\n]+/g, ' ').replace(/'/g, "\\'");
    return { id: m.id, name: cleanName, p: priceStr };
  });

  // Read index.html (relative to script, in repo root)
  const indexPath = __dirname + '/index.html';
  let indexHtml = fs.readFileSync(indexPath, 'utf8');

  // Extract static model names/prices from current opencode entry for fallback display names
  const ocNameMap = {};
  const ocStaticRegex = /opencode:\{label:'OpenCode Go',badge:'badge-opencode',usageUrl:'[^']+',url:'[^']+',models:\[([\s\S]*?)\]\}/;
  const ocStaticMatch = indexHtml.match(ocStaticRegex);
  if (ocStaticMatch) {
    const modelLines = ocStaticMatch[1].match(/\{id:'([^']+)',\s*name:'([^']+)',\s*p:'([^']+)'\}/g) || [];
    modelLines.forEach(line => {
      const m = line.match(/id:'([^']+)',\s*name:'([^']+)',\s*p:'([^']+)'/);
      if (m) ocNameMap[m[1]] = { name: m[2], p: m[3] };
    });
  }

  // Format OpenCode Go models (no pricing from API — use static names)
  const formattedOc = opencodeModels
    .filter(m => m.object === 'model')
    .map(m => {
      const known = ocNameMap[m.id];
      return {
        id: m.id,
        name: (known ? known.name : m.id).replace(/'/g, "\\'"),
        p: known ? known.p : '',
      };
    });

  // Preserve existing unknowns from static list (models NOT in the live API response)
  const liveOcIds = new Set(formattedOc.map(m => m.id));
  Object.entries(ocNameMap).forEach(([id, info]) => {
    if (!liveOcIds.has(id)) {
      formattedOc.push({ id, name: info.name.replace(/'/g, "\\'"), p: info.p });
    }
  });

  // Replace OpenRouter
  const orRegex = /openrouter:\{label:'OpenRouter',badge:'badge-openrouter',usageUrl:'[^']+',url:'[^']+',models:\[[\s\S]*?\n\s*\]\},?/;
  if (!orRegex.test(indexHtml)) {
    throw new Error('OpenRouter regex failed to match PROVIDERS in index.html');
  }
  let newOrText = formattedOr.map(m => `    {id:'${m.id}', name:'${m.name}', p:'${m.p}'},`).join('\n');
  indexHtml = indexHtml.replace(orRegex, () => `openrouter:{label:'OpenRouter',badge:'badge-openrouter',usageUrl:'https://openrouter.ai/activity',url:'https://openrouter.ai/api/v1',models:[\n${newOrText}\n  ]},`);

  // Replace OpenCode Go
  const ocRegex = /opencode:\{label:'OpenCode Go',badge:'badge-opencode',usageUrl:'[^']+',url:'[^']+',models:\[[\s\S]*?\n\s*\]\},?/;
  if (!ocRegex.test(indexHtml)) {
    throw new Error('OpenCode Go regex failed to match PROVIDERS in index.html');
  }
  let newOcText = formattedOc.map(m => `    {id:'${m.id}', name:'${m.name}', p:'${m.p}'},`).join('\n');
  indexHtml = indexHtml.replace(ocRegex, () => `opencode:{label:'OpenCode Go',badge:'badge-opencode',usageUrl:'https://opencode.ai/workspace/wrk_01KQA49DFKK6FNKT2MX99WVGQH/usage',url:'https://proxy.opencodechat.dpdns.org/zen/go/v1',models:[\n${newOcText}\n  ]},`);

  fs.writeFileSync(indexPath, indexHtml);
  console.log(`Successfully updated index.html — OpenRouter: ${formattedOr.length} models, OpenCode Go: ${formattedOc.length} models`);
}

run().catch(console.error);
