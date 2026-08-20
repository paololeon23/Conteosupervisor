const CACHE = 'qb-conteo-v2.12.6';
const ASSETS = [
  '/index.html',
  '/css/app.css',
  '/modules/app.js',
  '/modules/conteo/conteo.js',
  '/modules/historial/historial.js',
  '/core/api-config.js',
  '/core/utils.js',
  '/core/network.js',
  '/core/api.js',
  '/core/offline-queue.js',
  '/core/draft.js',
  '/core/licapa-data.js',
  '/core/lote-select.js',
  '/core/grupo-select.js',
  '/core/date-picker.js',
  '/core/zonas-catalog.js',
  '/core/zona-select.js',
  '/core/comprobante.js',
  '/core/save-conteo.js',
  '/core/totals.js',
  '/core/icons.js',
  '/core/pwa.js',
  '/data/lotes-licapa.json',
  '/assets/favicon.svg',
  '/assets/icon-192.png',
  '/assets/icon-512.png',
  '/assets/logo-qberries.png',
  '/manifest.webmanifest'
];

self.addEventListener('message', (e) => {
  if (e.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  if (e.request.method !== 'GET') return;

  if (url.origin !== self.location.origin) {
    if (url.hostname.includes('script.google.com')) {
      e.respondWith(fetch(e.request).catch(() => new Response('{"ok":false,"offline":true}', {
        headers: { 'Content-Type': 'application/json' }
      })));
    }
    return;
  }

  const path = url.pathname;
  const isAppCode = path.endsWith('.js') || path.endsWith('.css') || path.endsWith('.html') || path === '/';

  if (isAppCode) {
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE).then((c) => c.put(e.request, clone));
          }
          return res;
        })
        .catch(() => caches.match(e.request).then((cached) => cached || caches.match('/index.html')))
    );
    return;
  }

  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      }).catch(() => caches.match('/index.html'));
    })
  );
});
