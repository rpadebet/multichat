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
  if (n === 0) return '0';
  if (n < 0.01) return n.toFixed(4);
  const fixed = n.toFixed(3);
  return fixed.endsWith('0') ? fixed.slice(0, -1) : fixed;
}

function fmtCtx(n) {
  if (n >= 1000000) return (n/1000000).toFixed(0)+'M';
  if (n >= 1000) return Math.round(n/1024)+'K';
  return n;
}

async function run() {
  console.log('Fetching latest models from OpenRouter and DeepInfra...');
  
  const [orData, diData] = await Promise.all([
    fetchJson('https://openrouter.ai/api/v1/models'),
    fetchJson('https://api.deepinfra.com/v1/openai/models')
  ]);

  const openrouterModels = orData.data || [];
  const deepinfraModels = diData.data || [];

  // Sort OpenRouter models: free first, then by context window descending
  const orSorted = openrouterModels.sort((a, b) => {
    const aFree = parseFloat(a.pricing?.prompt || '1') === 0;
    const bFree = parseFloat(b.pricing?.prompt || '1') === 0;
    if (aFree && !bFree) return -1;
    if (!aFree && bFree) return 1;
    return (b.context_length || 0) - (a.context_length || 0);
  }).slice(0, 40); // Top 40 models

  const formattedOr = orSorted.map(m => {
    const inP = parseFloat(m.pricing?.prompt || '0');
    const outP = parseFloat(m.pricing?.completion || '0');
    const isFree = inP === 0 && outP === 0;
    const priceStr = isFree ? 'FREE' : `$${fmtPrice(inP*1e6)}/$${fmtPrice(outP*1e6)}`;
    const freeTag = isFree ? '🆓 ' : '';
    const ctx = m.context_length ? ` (${fmtCtx(m.context_length)})` : '';
    return { id: m.id, name: `${freeTag}${m.name || m.id}${ctx}`.replace(/'/g, "\\'"), p: priceStr };
  });

  const diSorted = deepinfraModels
    .filter(m => m.metadata && m.metadata.pricing && m.object === 'model')
    .sort((a, b) => (b.metadata?.context_length || 0) - (a.metadata?.context_length || 0))
    .slice(0, 30);

  const formattedDi = diSorted.map(m => {
    const inP = m.metadata.pricing.input_tokens || 0;
    const outP = m.metadata.pricing.output_tokens || 0;
    const priceStr = `$${fmtPrice(inP)}/$${fmtPrice(outP)}`;
    const ctx = m.metadata.context_length ? ` (${fmtCtx(m.metadata.context_length)})` : '';
    let nm = (m.id.split('/').pop() || m.id) + ctx;
    return { id: m.id, name: nm.replace(/'/g, "\\'"), p: priceStr };
  });

  let indexHtml = fs.readFileSync('c:/Users/rohit/OneDrive/Documents/Claude Apps/multichat/index.html', 'utf8');

  // Replace OpenRouter
  const orRegex = /openrouter:\{label:'OpenRouter',badge:'badge-openrouter',url:'https:\/\/openrouter\.ai\/api\/v1',models:\[([\s\S]*?)\]\}/;
  let newOrText = formattedOr.map(m => `    {id:'${m.id}', name:'${m.name}', p:'${m.p}'},`).join('\n');
  indexHtml = indexHtml.replace(orRegex, `openrouter:{label:'OpenRouter',badge:'badge-openrouter',url:'https://openrouter.ai/api/v1',models:[\n${newOrText}\n  ]}`);

  // Replace DeepInfra
  const diRegex = /deepinfra:\{label:'DeepInfra',badge:'badge-deepinfra',url:'https:\/\/api\.deepinfra\.com\/v1\/openai',models:\[([\s\S]*?)\]\}/;
  let newDiText = formattedDi.map(m => `    {id:'${m.id}', name:'${m.name}', p:'${m.p}'},`).join('\n');
  indexHtml = indexHtml.replace(diRegex, `deepinfra:{label:'DeepInfra',badge:'badge-deepinfra',url:'https://api.deepinfra.com/v1/openai',models:[\n${newDiText}\n  ]}`);

  fs.writeFileSync('c:/Users/rohit/OneDrive/Documents/Claude Apps/multichat/index.html', indexHtml);
  console.log('Successfully updated index.html default models!');
}

run().catch(console.error);
