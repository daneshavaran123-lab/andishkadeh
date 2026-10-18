/* Kiosk web app service worker: offline app shell. Generated at build time from sw-template.js. */
const VERSION = '__VERSION__';
const PRECACHE = __PRECACHE__;
const CACHE = `kiosk-shell-${VERSION}`;
const SCOPE = self.registration.scope;
const NAV_TIMEOUT_MS = 4000;
/** Other parts of the same site (served at the root, the worker's scope covers them): never handled here. */
const OTHER_PARTS = /^(api|admin|kiosk)(\/|$)/;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(PRECACHE.map((p) => new URL(p, SCOPE).toString())))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('kiosk-shell-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  // Only the app's own files: API calls, media downloads, the admin panel, kiosk management and
  // other origins always go to the network.
  if (req.method !== 'GET' || !req.url.startsWith(SCOPE)) return;
  if (OTHER_PARTS.test(new URL(req.url).pathname.slice(new URL(SCOPE).pathname.length))) return;
  if (req.mode === 'navigate') {
    // Network first so updates arrive while online, but a slow or failing server (timeout, 502)
    // falls back to the precached shell of this version. Navigations are never written to the
    // cache: the shell must always match the precached scripts.
    event.respondWith(
      (async () => {
        const network = fetch(req);
        const timeout = new Promise((resolve) => setTimeout(() => resolve(null), NAV_TIMEOUT_MS));
        const res = await Promise.race([network.catch(() => null), timeout]);
        if (res && res.ok) return res;
        const shell = await caches.match(new URL('./', SCOPE).toString(), { cacheName: CACHE });
        if (shell) return shell;
        return res ?? network; // not installed yet: wait for the network after all
      })(),
    );
    return;
  }
  event.respondWith(caches.match(req, { cacheName: CACHE, ignoreSearch: true }).then((hit) => hit ?? fetch(req)));
});
