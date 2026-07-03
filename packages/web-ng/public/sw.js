/*
 * SpecShip Desktop — offline service worker (REQ-OFFLINE-001).
 *
 * Dependency-free network-first cache with an offline shell fallback so the
 * dashboard loads from cache when the `specship serve` process is down, instead
 * of the browser's native "this site can't be reached" page.
 *
 * Strategy — network-first for every handled request:
 *   - When the server is reachable, always fetch fresh and update the cache.
 *     This keeps users on the current build (REQ-OFFLINE-001.A3) and is correct
 *     whether or not asset filenames are content-hashed (dev builds reuse
 *     `main.js`; a cache-first strategy would pin a stale bundle).
 *   - When a fetch fails (server down), serve the cached copy. Navigations fall
 *     back to the cached app shell so any route renders the SPA offline.
 *   - /api/* and EventSource streams are NOT handled here — the app's own
 *     per-surface cache (apiResource → localStorage) owns offline DATA and
 *     staleness so the UI controls how stale data is presented (REQ-OFFLINE-003).
 *
 * Only same-origin GETs are handled; cross-origin (an API on another host/port,
 * Google Fonts, …) passes straight through.
 */

// v3: drops v2 caches that may hold HTML poisoned under asset URLs
// (cached before the content-type guard below existed — REQ-OFFLINE-006.A3).
const CACHE = 'specship-shell-v3';
const SHELL = '/index.html';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((c) => c.add(SHELL).catch(() => undefined))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;        // API on another origin, fonts, etc.
  if (url.pathname.startsWith('/api/')) return;            // data layer owns offline data
  if (req.headers.get('accept') === 'text/event-stream') return; // SSE must stream live

  // Cache key: all navigations share the SPA shell entry; assets key on the request.
  const isNav = req.mode === 'navigate';
  const key = isNav ? SHELL : req;

  // Network-first: fresh when reachable, cached copy when the server is down.
  // Never cache an HTML-typed response for a non-navigation request
  // (REQ-OFFLINE-006): a server answering a missing asset with the SPA shell
  // would otherwise store HTML under the asset's URL, and every offline load
  // after that replays it as a broken module/stylesheet.
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok && res.type === 'basic') {
          const ct = (res.headers.get('content-type') || '').toLowerCase();
          const poisoned = !isNav && ct.indexOf('text/html') !== -1;
          if (!poisoned) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(key, copy)).catch(() => undefined);
          }
        }
        return res;
      })
      .catch(() =>
        caches.match(key).then((hit) => hit || (isNav ? caches.match(SHELL) : undefined)).then((hit) => hit || Response.error()),
      ),
  );
});
