// CENTRA service worker: makes the installed web app open offline and update itself.
// Only the app's own files are cached (never data: everything personal lives encrypted in IndexedDB).
const CACHE = 'centra-shell-v1';
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['./', './index.html', './manifest.webmanifest', './icon-192.png'])).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  // App page and version file: network first (so updates arrive), cache as fallback offline.
  if (req.mode === 'navigate' || url.pathname.endsWith('/version.json')) {
    e.respondWith(fetch(req).then((r) => { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); return r; }).catch(() => caches.match(req).then((m) => m || caches.match('./index.html'))));
    return;
  }
  // Hashed build assets never change: cache first.
  e.respondWith(caches.match(req).then((m) => m || fetch(req).then((r) => { if (r.ok) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); } return r; })));
});
