import { toast, openModalElement, closeModalElement, $ } from './utils.js';
import { wipeLocalWorkingState } from './offline-queue.js';
import { clearBorrador } from './draft.js';
import { updateNetBadge } from './network.js';

const INSTALL_DISMISS_KEY = 'qb_install_banner_dismiss';

let swReloadPending = false;
let deferredInstallPrompt = null;

export function registerSW() {
  if (!('serviceWorker' in navigator)) return;

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!swReloadPending) return;
    swReloadPending = false;
    window.location.reload();
  });
}

function waitWithTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(resolve, ms))
  ]);
}

export async function ensureOfflineReady() {
  if (!('serviceWorker' in navigator)) return false;

  try {
    const reg = await navigator.serviceWorker.getRegistration('/')
      || await navigator.serviceWorker.register('/service-worker.js', {
        scope: '/',
        updateViaCache: 'none'
      });

    await waitWithTimeout(navigator.serviceWorker.ready, 6000);
    reg.active?.postMessage({ type: 'WARM' });

    const cacheKeys = await caches.keys();
    const qbKey = cacheKeys.find((k) => k.startsWith('qb-conteo-'));
    if (!qbKey) return false;
    const cache = await caches.open(qbKey);
    return Boolean(await cache.match('/index.html'));
  } catch {
    return false;
  }
}

export function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches
    || window.navigator.standalone === true;
}

export function isAndroid() {
  return /Android/i.test(navigator.userAgent);
}

function isInstallDismissed() {
  try {
    return localStorage.getItem(INSTALL_DISMISS_KEY) === '1';
  } catch {
    return false;
  }
}

function dismissInstallBanner() {
  try { localStorage.setItem(INSTALL_DISMISS_KEY, '1'); } catch { /* ok */ }
  hideInstallUI();
}

function hideInstallUI() {
  $('#install-banner')?.setAttribute('hidden', '');
  ['#btn-install-app', '#btn-install-banner', '#btn-install-historial'].forEach((sel) => {
    const el = $(sel);
    if (el) el.hidden = true;
  });
}

function showInstallUI() {
  if (isStandalone() || isInstallDismissed()) return;

  if (isAndroid()) {
    $('#install-banner')?.removeAttribute('hidden');
  }

  ['#btn-install-app', '#btn-install-banner', '#btn-install-historial'].forEach((sel) => {
    const el = $(sel);
    if (el) el.hidden = false;
  });
}

function openInstallHelp() {
  openModalElement($('#install-help-modal'));
}

function closeInstallHelp() {
  closeModalElement($('#install-help-modal'));
}

async function triggerInstall() {
  if (deferredInstallPrompt) {
    try {
      await deferredInstallPrompt.prompt();
      const { outcome } = await deferredInstallPrompt.userChoice;
      if (outcome === 'accepted') {
        hideInstallUI();
        toast('Instalando app en su celular…', 'success');
      }
    } catch {
      toast('No se pudo abrir la instalación', 'warn');
      if (isAndroid()) openInstallHelp();
    } finally {
      deferredInstallPrompt = null;
    }
    return;
  }

  if (isAndroid()) {
    openInstallHelp();
    return;
  }

  toast('Use Chrome en Android para instalar la app', 'info');
}

function bindInstallButtons(selectors) {
  selectors.forEach((sel) => {
    $(sel)?.addEventListener('click', (e) => {
      e.preventDefault();
      triggerInstall();
    });
  });
}

export function initInstallPrompt() {
  if (isStandalone()) return;

  bindInstallButtons([
    '#btn-install-app',
    '#btn-install-banner',
    '#btn-install-historial'
  ]);

  $('#btn-install-dismiss')?.addEventListener('click', dismissInstallBanner);
  $('#install-help-close')?.addEventListener('click', closeInstallHelp);
  $('#install-help-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'install-help-modal') closeInstallHelp();
  });
  $('#install-help-retry')?.addEventListener('click', () => {
    closeInstallHelp();
    triggerInstall();
  });

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    showInstallUI();
  });

  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    hideInstallUI();
    toast('App instalada — ábrala desde el icono del inicio', 'success');
  });

  // Android: mostrar banner aunque el evento tarde unos segundos
  if (isAndroid() && !isInstallDismissed()) {
    showInstallUI();
    window.setTimeout(() => {
      if (!isStandalone() && !isInstallDismissed()) showInstallUI();
    }, 2500);
  }
}

async function hardReload() {
  const url = new URL(window.location.href);
  url.searchParams.set('fresh', String(Date.now()));
  window.location.replace(url.pathname + url.search + url.hash);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function refreshModalEls() {
  return {
    modal: $('#refresh-app-modal'),
    status: $('#refresh-app-status'),
    bar: $('#refresh-app-bar'),
    fill: $('#refresh-app-bar-fill'),
    steps: $('#refresh-app-steps')
  };
}

function setRefreshProgress(step, pct, message) {
  const { status, bar, fill, steps } = refreshModalEls();
  if (status && message) status.textContent = message;
  if (bar) bar.setAttribute('aria-valuenow', String(pct));
  if (fill) fill.style.width = `${Math.max(0, Math.min(100, pct))}%`;
  if (steps) {
    steps.querySelectorAll('[data-step]').forEach((li) => {
      const n = Number(li.getAttribute('data-step'));
      li.classList.toggle('is-done', n < step);
      li.classList.toggle('is-active', n === step);
    });
  }
}

function openRefreshModal() {
  const { modal } = refreshModalEls();
  if (!modal) return;
  setRefreshProgress(1, 8, 'Preparando actualización…');
  openModalElement(modal);
}

export async function refreshApp() {
  openRefreshModal();
  await sleep(280);

  setRefreshProgress(1, 22, 'Limpiando pendientes locales…');
  try {
    await wipeLocalWorkingState();
    clearBorrador();
    updateNetBadge();
  } catch { /* seguir con la actualización */ }
  await sleep(320);

  setRefreshProgress(2, 48, 'Borrando caché de la app…');
  try {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
  } catch { /* ok */ }
  await sleep(280);

  setRefreshProgress(3, 72, 'Buscando nueva versión…');

  if (!('serviceWorker' in navigator)) {
    setRefreshProgress(4, 100, 'Recargando app limpia…');
    await sleep(450);
    hardReload();
    return;
  }

  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) {
    setRefreshProgress(4, 100, 'Recargando app limpia…');
    await sleep(450);
    hardReload();
    return;
  }

  try {
    await reg.update();
  } catch { /* sin red: igual recarga limpia */ }
  await sleep(220);

  if (reg.waiting) {
    swReloadPending = true;
    reg.waiting.postMessage({ type: 'SKIP_WAITING' });
    setRefreshProgress(4, 100, 'Instalando actualización…');
    await sleep(700);
    hardReload();
    return;
  }

  reg.active?.postMessage({ type: 'PURGE_AND_WARM' });
  setRefreshProgress(4, 100, 'Listo — reiniciando…');
  await sleep(550);
  hardReload();
}

export function initAppRefresh(btnId = '#btn-refresh-app') {
  const btn = document.querySelector(btnId);
  if (!btn) return;

  const markReady = () => btn.classList.add('is-update-ready');

  window.addEventListener('sw:update-ready', markReady);
  navigator.serviceWorker?.ready.then((reg) => {
    if (reg.waiting) markReady();
  });

  btn.addEventListener('click', async () => {
    if (btn.disabled) return;
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');
    try {
      await refreshApp();
    } catch {
      const { status } = refreshModalEls();
      if (status) status.textContent = 'No se pudo completar. Reintente.';
      setRefreshProgress(4, 100, 'No se pudo completar. Reintente.');
      toast('Error al actualizar', 'error');
      window.setTimeout(() => {
        btn.disabled = false;
        btn.removeAttribute('aria-busy');
        closeModalElement($('#refresh-app-modal'));
      }, 2200);
    }
  });
}
