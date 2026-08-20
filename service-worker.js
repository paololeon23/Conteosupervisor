const CACHE = 'qb-conteo-v3.1.1';

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

const OFFLINE_HTML = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Conteo · Sin conexión</title><style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#F4F6F8;color:#1A1D21;text-align:center;padding:24px}p{max-width:320px;line-height:1.5}</style></head><body><p>Abra la app <strong>una vez con internet</strong> desde el icono del inicio. Después funcionará sin señal.</p></body></html>`;

self.addEventListener('message', (e) => {
  if (e.data?.type === 'SKIP_WAITING') self.skipWaiting();
  if (e.data?.type === 'WARM') e.waitUntil(precacheAll());
});

function isHtmlRequest(request) {
  if (request.mode === 'navigate') return true;
  if (request.destination === 'document') return true;
  const accept = request.headers.get('accept') || '';
  return accept.includes('text/html');
}

async function cacheShell(cache) {
  const index = await cache.match('/index.html');
  if (!index) return;
  await cache.put('/', index);
  await cache.put('/index.html', index);
  const scope = self.registration?.scope || self.location.origin + '/';
  await cache.put(scope, index);
  await cache.put(scope + 'index.html', index);
}

async function precacheAll() {
  const cache = await caches.open(CACHE);
  await Promise.allSettled(
    ASSETS.map((url) => cache.add(new Request(url, { cache: 'reload' })))
  );
  await cacheShell(cache);
}

self.addEventListener('install', (e) => {
  e.waitUntil(precacheAll().then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

async function openShell() {
  const cache = await caches.open(CACHE);
  const tries = [
    '/index.html',
    '/',
    self.registration?.scope,
    (self.registration?.scope || '') + 'index.html'
  ].filter(Boolean);

  for (const url of tries) {
    const hit = await cache.match(url);
    if (hit) return hit;
  }

  const keys = await cache.keys();
  for (const req of keys) {
    if (req.url.includes('index.html') || req.url.endsWith('/')) {
      const hit = await cache.match(req);
      if (hit) return hit;
    }
  }
  return null;
}

async function respondHtml() {
  const shell = await openShell();
  if (shell) return shell;
  try {
    const res = await fetch('/index.html');
    if (res.ok) {
      const cache = await caches.open(CACHE);
      await cache.put('/index.html', res.clone());
      await cacheShell(cache);
      return res;
    }
  } catch { /* offline */ }
  return new Response(OFFLINE_HTML, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' }
  });
}

async function respondAsset(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const res = await fetch(request);
    if (res.ok) {
      const cache = await caches.open(CACHE);
      cache.put(request, res.clone());
    }
    return res;
  } catch {
    return caches.match(request);
  }
}

self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  if (url.origin !== self.location.origin) {
    if (url.hostname.includes('script.google.com')) {
      e.respondWith(
        fetch(request).catch(() => new Response('{"ok":false,"offline":true}', {
          headers: { 'Content-Type': 'application/json' }
        }))
      );
    }
    return;
  }

  if (isHtmlRequest(request)) {
    e.respondWith(respondHtml());
    return;
  }

  e.respondWith(respondAsset(request));
});
