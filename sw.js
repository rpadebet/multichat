const CACHE = 'multichat-v10';
const SHELL = [
  './',
  './index.html',
  './manifest.json',
];

// Hosts that need CORS proxying (these APIs don't return CORS headers)
const PROXY_HOSTS = ['opencode.ai'];

// Proxy a request through the SW to bypass CORS.
// Fetches from the SW context (no CORS restrictions), then wraps the response
// with CORS headers so the page can read it.
async function proxyWithCors(request) {
  const headers = {};
  for (const [k, v] of request.headers.entries()) {
    headers[k] = v;
  }
  let body = undefined;
  if (!['GET', 'HEAD'].includes(request.method)) {
    try { body = await request.clone().text(); } catch(e) {}
  }
  const resp = await fetch(request.url, { method: request.method, headers, body });

  if (resp.type === 'opaqueredirect') return resp;

  const corsHeaders = new Headers(resp.headers);
  corsHeaders.set('Access-Control-Allow-Origin', '*');
  corsHeaders.set('Access-Control-Expose-Headers', '*');

  return new Response(resp.body, {
    status: resp.status,
    statusText: resp.statusText,
    headers: corsHeaders,
  });
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

  // Proxy requests to hosts that don't support CORS
  const shouldProxy = PROXY_HOSTS.includes(url.hostname) || url.hostname === 'localhost';
  if (shouldProxy) {
    e.respondWith(proxyWithCors(e.request));
    return;
  }

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
