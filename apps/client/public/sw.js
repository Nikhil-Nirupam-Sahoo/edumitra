// EduMitra service worker — offline shell with correct update semantics.
//
// Two caching strategies, chosen by what the request is for:
//
//  * App shell / HTML (navigations, index.html): NETWORK-FIRST. The shell names
//    hashed bundles; serving a stale shell pins the app to an old build and
//    strands the user until they clear caches by hand. We try the network,
//    cache the fresh response, and only fall back to cache when offline.
//  * Hashed static assets (/assets/*): CACHE-FIRST. Filenames are
//    content-hashed, so a cached hit is always correct and free.
const CACHE = 'edumitra-v3';
const SHELL = '/index.html';
const PRECACHE = ['/index.html', '/manifest.webmanifest', '/icons/icon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      // Individually, so one 404 cannot fail the whole precache.
      .then((c) => Promise.all(PRECACHE.map((u) => c.add(u).catch(() => undefined))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    // Offline: fall back to the cached shell, then bare '/'.
    return (await cache.match(request)) || (await cache.match(SHELL)) || Response.error();
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // API + third-party: straight to network

  // Never cache the sync API — stale xAPI/checkpoints would corrupt merges.
  if (url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request));
    return;
  }

  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // Everything else (manifest, icons): cache-first is safe and fast.
  event.respondWith(cacheFirst(request).catch(() => fetch(request)));
});