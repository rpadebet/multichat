const http = require('http');
const https = require('https');
const { URL } = require('url');

const PROXY_PORT = 3456;
const PROXY_KEY = process.env.PROXY_KEY || null; // set PROXY_KEY env var to enable simple auth
const privateHostnames = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\]|host\.docker\.internal|0\.0\.0\.0|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/i;

function isAllowedTargetHost(hostname) {
  const normalized = hostname.toLowerCase();
  return normalized === 'opencode.ai'
    || normalized.endsWith('.supabase.co')
    || privateHostnames.test(normalized)
    || !normalized.includes('.'); // bare hostname like a Docker container name
}

function rejectUnauthorized(res) {
  res.writeHead(403, {
    'Content-Type': 'text/plain',
    'Access-Control-Allow-Origin': '*',
  });
  res.end('Forbidden');
}

function handleProxy(req, res, targetUrlStr) {
  // ── Optional simple auth check ──
  if (PROXY_KEY) {
    const providedKey = req.headers['x-proxy-key'] || '';
    if (providedKey !== PROXY_KEY) {
      console.warn('[proxy] rejected request — invalid or missing x-proxy-key header');
      rejectUnauthorized(res);
      return;
    }
  }

  let targetUrl;
  try {
    targetUrl = new URL(targetUrlStr);
  } catch (e) {
    res.writeHead(400, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
    res.end('Invalid target URL');
    return;
  }

  if (!isAllowedTargetHost(targetUrl.hostname)) {
    console.warn(`[proxy] rejected target host — ${targetUrl.hostname}`);
    rejectUnauthorized(res);
    return;
  }

  const options = {
    hostname: targetUrl.hostname,
    port: targetUrl.port || (targetUrl.protocol === 'https:' ? 443 : 80),
    path: targetUrl.pathname + targetUrl.search,
    method: req.method,
    headers: {
      ...req.headers,
      host: targetUrl.host,
    },
  };

  // Do not forward the proxy auth header to the target
  delete options.headers['x-proxy-key'];

  const client = targetUrl.protocol === 'https:' ? https : http;

  const proxyReq = client.request(options, (proxyRes) => {
    const headers = { ...proxyRes.headers };
    headers['access-control-allow-origin'] = '*';
    headers['access-control-allow-headers'] = '*';
    headers['access-control-expose-headers'] = '*';
    headers['access-control-allow-private-network'] = 'true';

    res.writeHead(proxyRes.statusCode, proxyRes.statusMessage, headers);
    proxyRes.pipe(res);
  });

  proxyReq.on('error', (err) => {
    console.error('[proxy] error:', err.message);
    res.writeHead(502, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
    res.end('Proxy error: ' + err.message);
  });

  req.pipe(proxyReq);
}

const server = http.createServer((req, res) => {
  // ── CORS preflight ──
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Allow-Private-Network': 'true',
      'Access-Control-Max-Age': '86400',
    });
    res.end();
    return;
  }

  const reqUrl = new URL(req.url, `http://localhost:${PROXY_PORT}`);

  // ── Generic proxy endpoint: /proxy?url=<target> ──
  if (reqUrl.pathname === '/proxy') {
    const targetUrl = reqUrl.searchParams.get('url');
    if (!targetUrl) {
      res.writeHead(400, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
      res.end('Missing url parameter');
      return;
    }
    console.log(`[proxy] GENERIC ${req.method} → ${targetUrl}`);
    handleProxy(req, res, targetUrl);
    return;
  }

  // ── Default: forward to OpenCode Go ──
  console.log(`[proxy] OPENCODE ${req.method} ${req.url}`);
  handleProxy(req, res, 'https://opencode.ai' + req.url);
});

if (require.main === module) {
  server.listen(PROXY_PORT, () => {
    console.log(`CORS proxy running on http://localhost:${PROXY_PORT}`);
    console.log(`OpenCode Go:   http://localhost:${PROXY_PORT}/zen/go/v1/...`);
    console.log(`Generic proxy: http://localhost:${PROXY_PORT}/proxy?url=<target>`);
    console.log(`Proxy key:     ${!PROXY_KEY ? 'disabled (set PROXY_KEY env var)' : 'enabled'}`);
    console.log(`Press Ctrl+C to stop`);
  });
}

module.exports = { isAllowedTargetHost, privateHostnames, server };
