import { toast } from './utils.js';

export function registerSW() {
  if (!('serviceWorker' in navigator)) return;

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    window.location.reload();
  });
}

export async function ensureOfflineReady() {
  if (!('serviceWorker' in navigator)) return false;

  try {
    const reg = await navigator.serviceWorker.register('/service-worker.js', {
      scope: '/',
      updateViaCache: 'none'
    });

    await navigator.serviceWorker.ready;
    reg.active?.postMessage({ type: 'WARM' });
    await new Promise((r) => setTimeout(r, 400));

    const cache = await caches.open('qb-conteo-v3.1.0');
    return Boolean(await cache.match('/index.html'));
  } catch {
    return false;
  }
}

export function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches
    || window.navigator.standalone === true;
}

let deferredInstallPrompt = null;

export function initInstallPrompt(btnId = '#btn-install-app') {
  if (isStandalone()) return;

  const btn = document.querySelector(btnId);
  if (!btn) return;

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    btn.hidden = false;
  });

  btn.addEventListener('click', async () => {
    if (!deferredInstallPrompt) {
      toast('Instalación no disponible en este navegador', 'info');
      return;
    }

    try {
      await deferredInstallPrompt.prompt();
      const { outcome } = await deferredInstallPrompt.userChoice;
      if (outcome === 'accepted') btn.hidden = true;
    } catch {
      toast('No se pudo abrir la instalación', 'warn');
    } finally {
      deferredInstallPrompt = null;
    }
  });

  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    btn.hidden = true;
    toast('App instalada correctamente', 'info');
  });
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
    reg.waiting.postMessage({ type: 'SKIP_WAITING' });
    toast('Actualizando app…', 'info');
    return;
  }

  try {
    await reg.update();
  } catch { /* sin red */ }

  if (reg.waiting) {
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
