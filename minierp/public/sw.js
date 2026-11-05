/*
 * A small service worker so MiniERP keeps working with no network.
 * - Every same-origin GET is answered from the cache when it is there and refreshed from the network in the
 *   background (stale-while-revalidate), so the first visit fills the cache and later visits are instant and offline-proof.
 * - Only same-origin requests are touched; the app makes no others.
 * Bump CACHE when this file's behaviour changes so old caches are dropped.
 */
const CACHE = 'minierp-v1';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) => Promise.all(names.filter((n) => n !== CACHE).map((n) => caches.delete(n)))).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(request, { ignoreSearch: false });
      const network = fetch(request)
        .then((response) => {
          if (response.ok) cache.put(request, response.clone());
          return response;
        })
        .catch(() => undefined);
      if (cached) {
        void network; // refresh in the background
        return cached;
      }
      return (await network) ?? (await cache.match('./')) ?? Response.error();
    }),
  );
});
