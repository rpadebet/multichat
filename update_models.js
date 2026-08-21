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

function isUsableModel(m) {
  return typeof m.id === 'string' && !m.id.startsWith('~');
}

function opencodeDisplayName(id) {
  return id
    .replace(/^minimax-/i, 'MiniMax ')
    .replace(/^kimi-/i, 'Kimi ')
    .replace(/^glm-/i, 'GLM ')
    .replace(/^deepseek-/i, 'DeepSeek ')
    .replace(/^qwen/i, 'Qwen ')
    .replace(/^mimo-/i, 'MiMo ')
    .replace(/^hy/i, 'Hunyuan ')
    .replace(/^grok-/i, 'Grok ')
    .replace(/^gpt-/i, 'GPT-')
    .replace(/^muse-spark-/i, 'Muse Spark ');
}

async function run() {
  console.log('Fetching latest models from OpenRouter, OpenCode Go, and NeuralWatt...');

  const [orData, ocData, nwData] = await Promise.all([
    fetchJson('https://openrouter.ai/api/v1/models'),
    fetchJson('https://opencode.ai/zen/go/v1/models'),
    fetchJson('https://api.neuralwatt.com/v1/models')
  ]);

  const openrouterModels = orData.data || [];
  const opencodeModels = ocData.data || [];
  const neuralwattModels = nwData.data || [];

  // Sort OpenRouter models: free first, then by context window descending
  const orSorted = openrouterModels.filter(isUsableModel).sort((a, b) => {
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
    const priceStr = inP < 0 || outP < 0 ? '' : isFree ? 'FREE' : `$${fmtPrice(inP*1e6)}/$${fmtPrice(outP*1e6)}`;
    const freeTag = isFree ? '🆓 ' : '';
    const ctx = m.context_length ? ` (${fmtCtx(m.context_length)})` : '';
    const cleanName = `${freeTag}${m.name || m.id}${ctx}`.replace(/[\r\n]+/g, ' ').replace(/'/g, "\\'");
    return { id: m.id, name: cleanName, p: priceStr };
  });

  // Read models.js (relative to script, in repo root)
  const indexPath = __dirname + '/models.js';
  let indexHtml = fs.readFileSync(indexPath, 'utf8');

  // Extract static model names/prices from current opencode entry for fallback display names
  const ocNameMap = {};
  const ocStaticRegex = /opencode:\{label:'OpenCode Go',badge:'badge-opencode',usageUrl:'[^']+',url:'[^']+',models:\[([\s\S]*?)\]\}/;
  const ocStaticMatch = indexHtml.match(ocStaticRegex);
  if (ocStaticMatch) {
    const modelLines = ocStaticMatch[1].match(/\{id:'([^']+)',\s*name:'([^']*)',\s*p:'([^']*)'\}/g) || [];
    modelLines.forEach(line => {
      const m = line.match(/id:'([^']+)',\s*name:'([^']*)',\s*p:'([^']*)'/);
      if (m) ocNameMap[m[1]] = { name: m[2], p: m[3] };
    });
  }

  // Format OpenCode Go models (no pricing from API — use static names/prices or generate clean display name)
  const formattedOc = opencodeModels
    .filter(m => m.object === 'model' && isUsableModel(m))
    .map(m => {
      const known = ocNameMap[m.id];
      return {
        id: m.id,
        name: (known ? known.name : opencodeDisplayName(m.id)).replace(/'/g, "\\'"),
        p: known ? known.p : '',
      };
    });

  // Preserve existing unknowns from static list (models NOT in the live API response)
  const liveOcIds = new Set(formattedOc.map(m => m.id));
  Object.entries(ocNameMap).forEach(([id, info]) => {
    if (!liveOcIds.has(id) && !id.startsWith('~')) {
      formattedOc.push({ id, name: info.name.replace(/'/g, "\\'"), p: info.p });
    }
  });

  // Extract static model names/prices from current neuralwatt entry
  const nwNameMap = {};
  const nwStaticRegex = /neuralwatt:\{label:'NeuralWatt',badge:'badge-neuralwatt',usageUrl:'[^']+',url:'[^']+',models:\[([\s\S]*?)\]\}/;
  const nwStaticMatch = indexHtml.match(nwStaticRegex);
  if (nwStaticMatch) {
    const modelLines = nwStaticMatch[1].match(/\{id:'([^']+)',\s*name:'([^']*)',\s*p:'([^']*)'\}/g) || [];
    modelLines.forEach(line => {
      const m = line.match(/id:'([^']+)',\s*name:'([^']*)',\s*p:'([^']*)'/);
      if (m) nwNameMap[m[1]] = { name: m[2], p: m[3] };
    });
  }

  // Format NeuralWatt models
  const formattedNw = neuralwattModels
    .filter(m => !(m.metadata && m.metadata.deprecated) && isUsableModel(m))
    .map(m => {
      const md = m.metadata || {};
      const pr = md.pricing || {};
      const inP = pr.input_per_million, outP = pr.output_per_million;
      const priceStr = (inP != null && outP != null) ? `$${fmtPrice(inP)}/$${fmtPrice(outP)}` : (nwNameMap[m.id]?.p || '');
      const ctxLen = (md.limits && md.limits.max_context_length) || m.max_model_len || 0;
      const ctx = ctxLen ? ` (${fmtCtx(ctxLen)})` : '';
      const known = nwNameMap[m.id];
      const displayName = known?.name || `${md.display_name || m.id}${ctx}`;
      return {
        id: m.id,
        name: displayName.replace(/'/g, "\\'"),
        p: priceStr
      };
    });

  // Preserve existing models from static list (custom or account-specific models not in public unauthenticated API)
  const liveNwIds = new Set(formattedNw.map(m => m.id));
  Object.entries(nwNameMap).forEach(([id, info]) => {
    if (!liveNwIds.has(id) && !id.startsWith('~')) {
      formattedNw.push({ id, name: info.name.replace(/'/g, "\\'"), p: info.p });
    }
  });

  // Replace OpenRouter
  const orRegex = /openrouter:\{label:'OpenRouter',badge:'badge-openrouter',usageUrl:'[^']+',url:'[^']+',models:\[[\s\S]*?\n\s*\]\},?/;
  if (!orRegex.test(indexHtml)) {
    throw new Error('OpenRouter regex failed to match PROVIDERS in models.js');
  }
  let newOrText = formattedOr.map(m => `    {id:'${m.id}', name:'${m.name}', p:'${m.p}'},`).join('\n');
  indexHtml = indexHtml.replace(orRegex, () => `openrouter:{label:'OpenRouter',badge:'badge-openrouter',usageUrl:'https://openrouter.ai/activity',url:'https://openrouter.ai/api/v1',models:[\n${newOrText}\n  ]},`);

  // Replace OpenCode Go
  const ocRegex = /opencode:\{label:'OpenCode Go',badge:'badge-opencode',usageUrl:'[^']+',url:'[^']+',models:\[[\s\S]*?\n\s*\]\},?/;
  if (!ocRegex.test(indexHtml)) {
    throw new Error('OpenCode Go regex failed to match PROVIDERS in models.js');
  }
  let newOcText = formattedOc.map(m => `    {id:'${m.id}', name:'${m.name}', p:'${m.p}'},`).join('\n');
  indexHtml = indexHtml.replace(ocRegex, () => `opencode:{label:'OpenCode Go',badge:'badge-opencode',usageUrl:'https://opencode.ai/workspace/wrk_01KQA49DFKK6FNKT2MX99WVGQH/usage',url:'https://proxy.opencodechat.dpdns.org/zen/go/v1',models:[\n${newOcText}\n  ]},`);

  // Replace NeuralWatt
  const nwRegex = /neuralwatt:\{label:'NeuralWatt',badge:'badge-neuralwatt',usageUrl:'[^']+',url:'[^']+',models:\[[\s\S]*?\n\s*\]\},?/;
  if (!nwRegex.test(indexHtml)) {
    throw new Error('NeuralWatt regex failed to match PROVIDERS in models.js');
  }
  let newNwText = formattedNw.map(m => `    {id:'${m.id}', name:'${m.name}', p:'${m.p}'},`).join('\n');
  indexHtml = indexHtml.replace(nwRegex, () => `neuralwatt:{label:'NeuralWatt',badge:'badge-neuralwatt',usageUrl:'https://portal.neuralwatt.com',url:'https://api.neuralwatt.com/v1',models:[\n${newNwText}\n  ]},`);

  fs.writeFileSync(indexPath, indexHtml);
  console.log(`Successfully updated models.js — OpenRouter: ${formattedOr.length} models, OpenCode Go: ${formattedOc.length} models, NeuralWatt: ${formattedNw.length} models`);
}

run().catch(console.error);
