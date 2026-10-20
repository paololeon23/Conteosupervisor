const CACHE = 'qb-conteo-v3.6.78';

const ASSETS = [
  '/index.html',
  '/css/app.css',
  '/modules/app.js',
  '/modules/conteo/conteo.js',
  '/modules/historial/historial.js',
  '/modules/data/data.js',
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
  '/core/supervisores-catalog.js',
  '/core/supervisor-select.js',
  '/core/comprobante.js',
  '/core/save-conteo.js',
  '/core/sync-notify.js',
  '/core/sup-resumen.js',
  '/core/export-excel.js',
  '/core/totals.js',
  '/core/icons.js',
  '/core/pwa.js',
  '/core/pretty-select.js',
  '/core/fab.js',
  '/data/lotes-licapa.json',
  '/data/supervisores-cosecha.json',
  '/assets/favicon.svg',
  '/assets/icon-192.png',
  '/assets/icon-512.png',
  '/assets/logo-qberries.png',
  '/assets/bus.png',
  '/manifest.webmanifest'
];

const OFFLINE_HTML = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Conteo · Sin conexión</title><style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#F4F6F8;color:#1A1D21;text-align:center;padding:24px}p{max-width:320px;line-height:1.5}</style></head><body><p>Abra la app <strong>una vez con internet</strong> desde el icono del inicio. Después funcionará sin señal.</p></body></html>`;

self.addEventListener('message', (e) => {
  if (e.data?.type === 'SKIP_WAITING') self.skipWaiting();
  if (e.data?.type === 'WARM') e.waitUntil(precacheAll());
  if (e.data?.type === 'PURGE_AND_WARM') {
    e.waitUntil(
      caches.keys()
        .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
        .then(() => precacheAll())
    );
  }
});

function isHtmlRequest(request) {
  if (request.mode === 'navigate') return true;
  if (request.destination === 'document') return true;
  const accept = request.headers.get('accept') || '';
  return accept.includes('text/html');
}

/** Clonar en cada put — un Response solo se puede leer una vez */
async function cacheShell(cache) {
  const index = await cache.match('/index.html');
  if (!index) return;

  const scope = self.registration?.scope || (self.location.origin + '/');
  const urls = ['/', '/index.html', scope, scope + 'index.html'];
  const unique = [...new Set(urls.filter(Boolean))];

  await Promise.all(
    unique.map((url) => cache.put(url, index.clone()).catch(() => {}))
  );
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
    // Apps Script: no interceptar (el cliente maneja cache local del dashboard)
    return;
  }

  if (isHtmlRequest(request)) {
    e.respondWith(respondHtml());
    return;
  }

  e.respondWith(respondAsset(request));
});

const IDB_NAME = 'qb_conteo_idb_v1';
const IDB_STORE = 'kv';
const QUEUE_KEY = 'qb_conteo_queue_v1';
const HIST_KEY = 'qb_conteo_historial_v1';
const REV_KEY = 'qb_queue_rev';
const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxBt01BESHhHZQdoUILCtGVoSsoQVc8LexaikPgnJUa8XfsCgqRvus14Qce_lKyTK9nxA/exec';
const SCRIPT_TOKEN = 'TU_TOKEN_SECRETO';

function idbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(IDB_STORE)) {
        req.result.createObjectStore(IDB_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbGet(key) {
  return idbOpen().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readonly');
    const req = tx.objectStore(IDB_STORE).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }));
}

function idbPut(key, val) {
  return idbOpen().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(val, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  }));
}

async function postGuardar(data) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 65000);
  try {
    const res = await fetch(SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'guardar', token: SCRIPT_TOKEN, data }),
      redirect: 'follow',
      cache: 'no-store',
      signal: ctrl.signal
    });
    const text = await res.text();
    try { return JSON.parse(text); } catch { return { ok: false, code: 'PARSE_ERROR' }; }
  } catch (err) {
    return { ok: false, code: err && err.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK' };
  } finally {
    clearTimeout(timer);
  }
}

async function flushDesdeSegundoPlano() {
  const queue = await idbGet(QUEUE_KEY);
  if (!Array.isArray(queue) || !queue.length) return;
  const subidos = [];
  for (const item of queue) {
    const resp = await postGuardar({ ...item, editar: true });
    if (!resp || resp.ok !== true) break;
    subidos.push(item);
  }
  if (!subidos.length) return;

  const done = new Set(subidos.map((item) => item.localId));
  const fresh = await idbGet(QUEUE_KEY);
  const siguiente = (Array.isArray(fresh) ? fresh : queue).filter((item) => !done.has(item.localId));
  await idbPut(QUEUE_KEY, siguiente);

  const historial = await idbGet(HIST_KEY);
  const lista = Array.isArray(historial) ? historial : [];
  subidos.forEach((item) => {
    const idx = lista.findIndex((h) => h.localId === item.localId);
    const patch = { ...item, status: 'synced', syncedAt: Date.now() };
    if (idx >= 0) lista[idx] = { ...lista[idx], ...patch };
    else lista.unshift(patch);
  });
  await idbPut(HIST_KEY, lista);
  await idbPut(REV_KEY, Date.now());

  const title = subidos.length === 1 ? 'Pendiente subido' : 'Pendientes subidos';
  const body = subidos.length === 1
    ? 'El conteo pendiente ya está en el servidor'
    : subidos.length + ' conteos ya están en el servidor';
  await self.registration.showNotification(title, {
    body,
    icon: '/assets/icon-192.png',
    badge: '/assets/icon-192.png',
    tag: 'qb-pendiente-subido',
    renotify: true,
    data: { tab: 'historial' }
  });
}

self.addEventListener('sync', (event) => {
  if (event.tag !== 'qb-flush-queue') return;
  event.waitUntil((async () => {
    const ventanas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (ventanas.length) {
      ventanas.forEach((client) => client.postMessage({ type: 'qb-flush' }));
      return;
    }
    await flushDesdeSegundoPlano();
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const ventanas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const abierta = ventanas.find((client) => client.url.includes(self.location.origin));
    if (abierta) {
      await abierta.focus();
      abierta.postMessage({ type: 'qb-flush' });
      return;
    }
    await self.clients.openWindow('/');
  })());
});
