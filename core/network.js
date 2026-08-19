import { pingConteo } from './api.js';
import { getQueue } from './offline-queue.js';

let online = navigator.onLine;

window.addEventListener('online', () => { online = true; updateNetBadge(); window.dispatchEvent(new CustomEvent('net:online')); });
window.addEventListener('offline', () => { online = false; updateNetBadge(); window.dispatchEvent(new CustomEvent('net:offline')); });

export function isOnline() {
  return online;
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
    if (online) {
      netPill.classList.add('is-online');
      netText.textContent = 'En línea';
      netPill.title = 'Con internet';
    } else {
      netPill.classList.add('is-offline');
      netText.textContent = 'Sin red';
      netPill.title = 'Sin conexión';
    }
  }

  if (queuePill && queueText) {
    queuePill.classList.toggle('is-empty', pending === 0);
    queuePill.classList.toggle('has-pending', pending > 0);
    queueText.textContent = pending === 1 ? '1 pend.' : `${pending} pend.`;
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
