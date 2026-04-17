const CACHE = 'multichat-v3';
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

// Fetch: serve shell from cache, everything else from network
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
