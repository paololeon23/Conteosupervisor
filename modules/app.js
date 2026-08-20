import { registerSW, ensureOfflineReady, initAppRefresh, initInstallPrompt } from '../core/pwa.js';
import { restoreFromIDB } from '../core/offline-queue.js';
import { dedupeQueue, flushPendingQueue, isFlushBlocked } from '../core/save-conteo.js';
import { restoreBorradorFromIDB } from '../core/draft.js';
import { isOnline, updateNetBadge, initStatusPills } from '../core/network.js';
import { initConteo } from './conteo/conteo.js';
import { initHistorial } from './historial/historial.js';
import { toast, resetBodyScrollLock, closeAllModals } from '../core/utils.js';

async function init() {
  closeAllModals();
  resetBodyScrollLock();

  // UI primero — los clics no deben esperar al service worker
  initTabs();
  initStatusPills(() => switchTab('historial'));
  initAppRefresh();
  initInstallPrompt();
  registerSW();

  try {
    await restoreFromIDB();
    dedupeQueue();
    await restoreBorradorFromIDB();
    await initConteo();
    initHistorial();
    updateNetBadge();

    window.addEventListener('online', onReconnect);
    window.addEventListener('net:online', onReconnect);
    window.addEventListener('offline', updateNetBadge);
    window.addEventListener('historial:update', updateNetBadge);

    if (isOnline()) flushPendingQueue();

    ensureOfflineReady().then((offlineReady) => {
      if (offlineReady && navigator.onLine && !localStorage.getItem('qb_offline_v3_2')) {
        localStorage.setItem('qb_offline_v3_2', '1');
        toast('Lista para usar sin internet', 'success');
      }
    });
  } catch (err) {
    console.error('[conteo] init error', err);
    toast('Error al iniciar — recargue la app', 'error');
  }
}

function switchTab(tab) {
  document.querySelectorAll('.tab-btn').forEach(b =>
    b.classList.toggle('tab-btn--active', b.dataset.tab === tab));
  document.querySelectorAll('.tab-panel').forEach(p =>
    p.classList.toggle('tab-panel--active', p.id === `tab-${tab}`));
}

function initTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });
}

async function onReconnect() {
  updateNetBadge();
  toast('Conexión restaurada — sincronizando…', 'info');
  await flushPendingQueue();
}

document.addEventListener('DOMContentLoaded', init);
setInterval(() => {
  if (isOnline() && !isFlushBlocked()) flushPendingQueue();
}, 30000);
