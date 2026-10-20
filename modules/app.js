import { registerSW, ensureOfflineReady, initInstallPrompt } from '../core/pwa.js';
import { restoreFromIDB, pullQueueFromIDB } from '../core/offline-queue.js';
import { restoreBorradorFromIDB } from '../core/draft.js';
import { isOnline, updateNetBadge, initStatusPills } from '../core/network.js';
import { initPrettySelects } from '../core/pretty-select.js';
import { toast, resetBodyScrollLock, closeAllModals } from '../core/utils.js';
import { loadSupervisoresCosecha } from '../core/supervisores-catalog.js';

let dedupeQueue = () => {};
let flushPendingQueue = async () => {};
let isFlushBlocked = () => false;

let historialReady = false;
let dataReady = false;
let conteoReady = false;

/** En computadora (≥1024px + mouse) solo existe #/data. Celular/táctil nunca. */
export function isDeskDataOnly() {
  // Celular / tablet táctil (aunque Chrome ponga “sitio de escritorio”)
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  const noHover = window.matchMedia('(hover: none)').matches;
  if (coarse || noHover) return false;
  return window.matchMedia('(min-width: 1024px)').matches;
}

async function ensureHistorial() {
  if (isDeskDataOnly()) return;
  if (historialReady) return;
  const { initHistorial } = await import('./historial/historial.js');
  initHistorial();
  historialReady = true;
}

async function ensureData() {
  if (dataReady) {
    const { initData } = await import('./data/data.js');
    initData();
    return;
  }
  const { initData } = await import('./data/data.js');
  initData();
  dataReady = true;
}

async function ensureConteo() {
  if (isDeskDataOnly()) return;
  if (conteoReady) return;
  const { initConteo } = await import('./conteo/conteo.js');
  await initConteo();
  conteoReady = true;
}

const PAGES = ['conteo', 'data', 'historial'];

function pageFromHash() {
  if (isDeskDataOnly()) return 'data';
  const name = String(location.hash || '').replace(/^#\/?/, '').split('?')[0];
  return PAGES.includes(name) ? name : 'conteo';
}

function goHistorial() {
  if (isDeskDataOnly()) {
    lockToData();
    return;
  }
  ensureHistorial().then(() => switchTab('historial'));
}

function goData() {
  switchTab('data');
  ensureData();
}

function lockToData() {
  document.documentElement.classList.add('desk-data-only');
  document.body.classList.add('desk-data-only');
  document.body.dataset.page = 'data';
  document.querySelectorAll('.tab-panel').forEach((p) => {
    p.classList.toggle('tab-panel--active', p.id === 'tab-data');
  });
  if (location.hash !== '#/data') {
    history.replaceState({ page: 'data' }, '', '#/data');
  }
  ensureData();
}

function openPage(tab) {
  if (isDeskDataOnly()) {
    lockToData();
    return;
  }
  if (tab === 'historial') goHistorial();
  else if (tab === 'data') goData();
  else {
    switchTab('conteo');
    ensureConteo();
  }
}

async function init() {
  closeAllModals();
  resetBodyScrollLock();

  // Primero el select estilizado (no depende de save-conteo)
  initPrettySelects();
  initTabs();
  loadSupervisoresCosecha();

  try {
    const saveMod = await import('../core/save-conteo.js');
    dedupeQueue = saveMod.dedupeQueue;
    flushPendingQueue = saveMod.flushPendingQueue;
    isFlushBlocked = saveMod.isFlushBlocked;
  } catch (err) {
    console.error('[conteo] save-conteo', err);
  }

  // FAB: sí o sí en celulares
  const { initFab, ensureFabForViewport } = await import('../core/fab.js');
  initFab();
  window.__ensureFab = ensureFabForViewport;
  if (!isDeskDataOnly()) initStatusPills(goHistorial);

  initInstallPrompt();
  registerSW();

  try {
    await Promise.all([restoreFromIDB(), restoreBorradorFromIDB()]);
    await pullQueueFromIDB();
    dedupeQueue();

    if (isDeskDataOnly()) {
      lockToData();
    } else {
      await ensureConteo();
      updateNetBadge();
    }

    window.addEventListener('online', onReconnect);
    window.addEventListener('net:online', onReconnect);
    window.addEventListener('net:link', () => {
      if (!isFlushBlocked()) flushPendingQueue({ force: true });
    });
    window.addEventListener('offline', updateNetBadge);
    window.addEventListener('historial:update', updateNetBadge);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && !isFlushBlocked()) {
        flushPendingQueue({ force: true });
      }
    });
    navigator.serviceWorker?.addEventListener('message', (e) => {
      if (e.data?.type === 'qb-flush' && !isFlushBlocked()) flushPendingQueue({ force: true });
    });

    if (isOnline()) flushPendingQueue({ force: true });

    ensureOfflineReady().then((offlineReady) => {
      if (offlineReady && navigator.onLine && !localStorage.getItem('qb_offline_v3_2')) {
        localStorage.setItem('qb_offline_v3_2', '1');
        if (!isDeskDataOnly()) toast('Lista para usar sin internet', 'success');
      }
    });
  } catch (err) {
    console.error('[conteo] init error', err);
    toast('Error al iniciar — recargue la app', 'error');
  }
}

function switchTab(tab) {
  if (isDeskDataOnly()) {
    lockToData();
    return;
  }
  const page = PAGES.includes(tab) ? tab : 'conteo';
  document.querySelectorAll('.tab-panel').forEach(p =>
    p.classList.toggle('tab-panel--active', p.id === `tab-${page}`));
  document.body.dataset.page = page;
  const next = `#/${page}`;
  if (location.hash !== next) history.pushState({ page }, '', next);
  document.querySelector('.app')?.scrollTo(0, 0);
}

function initTabs() {
  window.addEventListener('app:goto-tab', (e) => {
    if (isDeskDataOnly()) {
      lockToData();
      return;
    }
    const tab = e.detail?.tab;
    if (tab) openPage(tab);
  });

  window.addEventListener('hashchange', () => {
    if (isDeskDataOnly()) {
      lockToData();
      return;
    }
    openPage(pageFromHash());
  });

  const mq = window.matchMedia('(min-width: 1024px)');
  const onViewport = () => {
    if (isDeskDataOnly()) {
      lockToData();
      document.getElementById('fab-root')?.remove();
    } else {
      document.documentElement.classList.remove('desk-data-only');
      document.body.classList.remove('desk-data-only');
      openPage(pageFromHash());
      // Recrear FAB si se borró al pasar por escritorio / rotación
      if (typeof window.__ensureFab === 'function') window.__ensureFab();
      else import('../core/fab.js').then((m) => m.ensureFabForViewport());
    }
  };
  mq.addEventListener?.('change', onViewport);
  mq.addListener?.(onViewport);
  onViewport();
}

async function onReconnect() {
  updateNetBadge();
  await flushPendingQueue({ force: true });
}

document.addEventListener('DOMContentLoaded', init);
setInterval(() => {
  if (isOnline() && !isFlushBlocked()) flushPendingQueue({ force: true });
}, 25000);
