const CACHE = 'multichat-v9';
const SHELL = [
  './',
  './index.html',
  './manifest.json',
];

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

// Fetch: serve shell from cache, proxy OpenCode Go, bypass other cross-origin
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Proxy OpenCode Go API requests through SW to bypass CORS
  // (opencode.ai server doesn't return CORS headers)
  if (url.hostname === 'opencode.ai') {
    e.respondWith(
      (async () => {
        const headers = {};
        for (const [k, v] of e.request.headers.entries()) {
          headers[k] = v;
        }
        return fetch(e.request.url, {
          method: e.request.method,
          headers: headers,
          body: ['GET','HEAD'].includes(e.request.method) ? undefined : await e.request.clone().text(),
        });
      })()
    );
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
