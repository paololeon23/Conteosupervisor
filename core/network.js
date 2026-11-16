import { pingConteo } from './api.js';
import { getQueue } from './offline-queue.js';

let online = navigator.onLine;
let syncLabel = '';

window.addEventListener('online', () => { online = true; updateNetBadge(); window.dispatchEvent(new CustomEvent('net:online')); });
window.addEventListener('offline', () => { online = false; updateNetBadge(); window.dispatchEvent(new CustomEvent('net:offline')); });

navigator.connection?.addEventListener?.('change', () => {
  online = navigator.onLine;
  updateNetBadge();
  if (navigator.onLine) window.dispatchEvent(new CustomEvent('net:link'));
});

export function isOnline() {
  return online || navigator.onLine;
}

/** 2G, 3G o H+ (el navegador lo reporta como 3g). Se usa solo para timeouts, no para el chip. */
export function isSlowLink() {
  const tipo = navigator.connection?.effectiveType || '';
  return tipo === 'slow-2g' || tipo === '2g' || tipo === '3g';
}

/** Tiempo máx. por intento — en 3G/H+ más holgado para que suba y no quede pendiente. */
export function uploadTimeoutMs() {
  const tipo = navigator.connection?.effectiveType || '';
  if (tipo === 'slow-2g' || tipo === '2g') return 60000;
  if (tipo === '3g') return 50000;
  return 30000;
}

/** Ya no se usa “Subiendo 1/1” en el chip — solo cuenta de pendientes. */
export function setSyncLabel() {
  syncLabel = '';
  updateNetBadge();
}

function linkLabel() {
  if (!isOnline()) return 'Sin red';
  // Siempre “En línea” (no mostrar 3G / 2G / H+)
  return 'En línea';
}

export async function pingServer() {
  try {
    const json = await pingConteo();
    return json && json.ok === true;
  } catch {
    return false;
  }
}

export function updateNetBadge() {
  const netPill = document.getElementById('netPill');
  const netText = netPill?.querySelector('.status-text');
  const queuePill = document.getElementById('queuePill');
  const queueText = queuePill?.querySelector('.status-text');

  const pending = getQueue().length;

  if (netPill && netText) {
    netPill.classList.remove('is-online', 'is-offline');
    if (isOnline()) {
      netPill.classList.add('is-online');
      netText.textContent = linkLabel();
      netPill.title = 'Con internet — los envíos siguen en 3G/H+';
    } else {
      netPill.classList.add('is-offline');
      netText.textContent = 'Sin red';
      netPill.title = 'Sin conexión';
    }
  }

  if (queuePill && queueText) {
    queuePill.classList.toggle('is-empty', pending === 0);
    queuePill.classList.toggle('has-pending', pending > 0);
    queueText.textContent = syncLabel || (pending === 0 ? '0 pend.' : (pending === 1 ? '1 pend.' : `${pending} pend.`));
    queuePill.title = pending === 0
      ? 'Sin pendientes · Historial'
      : `${pending} pendiente${pending > 1 ? 's' : ''} · Ver historial`;
    queuePill.setAttribute('aria-label', queuePill.title);
  }
}

export function initStatusPills(onQueueClick) {
  document.getElementById('queuePill')?.addEventListener('click', () => {
    if (typeof onQueueClick === 'function') onQueueClick();
  });
}
