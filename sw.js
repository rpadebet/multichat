const CACHE = 'multichat-v36';
const SHELL = [
  './',
  './index.html',
  './models.js',
  './manifest.json',
];

// Hosts that need CORS proxying (these APIs don't return CORS headers)
const PROXY_HOSTS = ['opencode.ai', '127.0.0.1', '[::1]'];

// Proxy a request through the SW to bypass CORS.
// Forwards the original Request object directly (preserving all metadata),
// then wraps the response with synthetic CORS headers so the page can read it.
async function proxyWithCors(request) {
  // ── Handle CORS preflight (OPTIONS) directly — no need to forward ──
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
        'Access-Control-Allow-Headers': '*',
        'Access-Control-Allow-Private-Network': 'true',
        'Access-Control-Max-Age': '86400',
      }
    });
  }

  try {
    const resp = await fetch(request);

    if (resp.type === 'opaqueredirect') return resp;

    const corsHeaders = new Headers(resp.headers);
    corsHeaders.set('Access-Control-Allow-Origin', '*');
    corsHeaders.set('Access-Control-Expose-Headers', '*');
    corsHeaders.set('Access-Control-Allow-Private-Network', 'true');

    return new Response(resp.body, {
      status: resp.status,
      statusText: resp.statusText,
      headers: corsHeaders,
    });
  } catch (err) {
    console.error('[SW proxy] Failed for', request.url, err);
    throw err;
  }
}

// Install: cache the app shell
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

// Activate: clean up old caches
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Fetch: proxy CORS-blocked hosts, bypass other cross-origin, cache shell
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Bypass Service Worker entirely for cross-origin API calls 
  // (Prevents WebKit/Safari bugs where SW drops Authorization headers on POST requests)
  if (url.hostname !== location.hostname) {
    return;
  }

  // Cache-first for app shell assets
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request).then(resp => {
      const clone = resp.clone();
      caches.open(CACHE).then(c => c.put(e.request, clone));
      return resp;
    }))
  );
});
