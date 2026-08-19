import { toast } from './utils.js';

export function registerSW() {
  if (!('serviceWorker' in navigator)) return;

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    window.location.reload();
  });

  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('/service-worker.js', { scope: '/' });

      reg.addEventListener('updatefound', () => {
        const worker = reg.installing;
        if (!worker) return;
        worker.addEventListener('statechange', () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) {
            window.dispatchEvent(new CustomEvent('sw:update-ready'));
          }
        });
      });

      if (reg.waiting) window.dispatchEvent(new CustomEvent('sw:update-ready'));
    } catch (err) {
      console.warn('SW registro falló', err);
    }
  });
}

export function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches
    || window.navigator.standalone === true;
}

/** Evento diferido del navegador para instalar la PWA */
let deferredInstallPrompt = null;

/**
 * Captura el aviso de instalación y lo muestra solo al pulsar el botón.
 * Chrome registra "Banner not shown…" en consola: es informativo, no un fallo.
 */
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
  } catch {
    /* sin red u otro error — recargar igual */
  }

  if (reg.waiting) {
    reg.waiting.postMessage({ type: 'SKIP_WAITING' });
    toast('Actualizando app…', 'info');
    return;
  }

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
