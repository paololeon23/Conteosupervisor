import { toast, openModalElement, closeModalElement, $ } from './utils.js';

const CACHE_NAME = 'qb-conteo-v3.1.2';
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
    await new Promise((r) => setTimeout(r, 400));

    const cache = await caches.open(CACHE_NAME);
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

export async function refreshApp() {
  if (!('serviceWorker' in navigator)) {
    window.location.reload();
    return;
  }

  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) {
    window.location.reload();
    return;
  }

  if (reg.waiting) {
    swReloadPending = true;
    reg.waiting.postMessage({ type: 'SKIP_WAITING' });
    toast('Actualizando app…', 'info');
    return;
  }

  try {
    await reg.update();
  } catch { /* sin red */ }

  if (reg.waiting) {
    swReloadPending = true;
    reg.waiting.postMessage({ type: 'SKIP_WAITING' });
    toast('Actualizando app…', 'info');
    return;
  }

  if (reg.active) reg.active.postMessage({ type: 'WARM' });

  toast('App al día — recargando…', 'info');
  window.setTimeout(() => window.location.reload(), 400);
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
    try {
      await refreshApp();
    } finally {
      btn.disabled = false;
    }
  });
}
