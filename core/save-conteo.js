import { guardarConteo, isConteoSuccess, isAuthError } from './api.js';
import { isOnline, uploadTimeoutMs, updateNetBadge } from './network.js';
import { todayStr, nowTimeStr, uid, toast } from './utils.js';
import {
  getQueue,
  saveQueue,
  getHistorial,
  saveHistorial,
  enqueue,
  removeFromQueue,
  conteoKey,
  pullQueueFromIDB
} from './offline-queue.js';
import {
  pedirPermisoNotificaciones,
  notificarPendientesSubidos,
  programarSubidaEnFondo
} from './sync-notify.js';

let saveInFlight = false;
let flushInFlight = false;
let flushBlocked = false;
const sendingIds = new Set();

function prepareData(payload) {
  return {
    ...payload,
    localId: payload.localId || uid(),
    fechaRegistro: payload.fechaRegistro || todayStr(),
    horaRegistro: payload.horaRegistro || nowTimeStr()
  };
}

/** ¿Ya existe este conteo en cola o historial (pendiente/sincronizado)? */
export function conteoYaRegistrado(data) {
  const key = conteoKey(data);
  const enCola = getQueue().some(q => conteoKey(q) === key);
  const enHistorial = getHistorial().some(
    h => conteoKey(h) === key && h.status !== 'failed'
  );
  return enCola || enHistorial;
}

/** Quita entradas repetidas en la cola (mismo DNI + fecha) */
export function dedupeQueue() {
  const queue = getQueue();
  const seen = new Map();
  const limpia = [];

  for (const item of queue) {
    const key = conteoKey(item);
    if (seen.has(key)) continue;
    seen.set(key, item.localId);
    limpia.push(item);
  }

  if (limpia.length !== queue.length) saveQueue(limpia);
  return limpia;
}

function guardarLocal(data) {
  const entry = enqueue(data);

  const historial = getHistorial();
  const key = conteoKey(data);
  const idx = historial.findIndex(h => conteoKey(h) === key && h.status !== 'failed');
  if (idx >= 0) {
    historial[idx] = { ...historial[idx], ...entry, status: 'pending' };
  } else {
    historial.unshift({ ...entry, status: 'pending' });
  }
  saveHistorial(historial);
  updateNetBadge();

  return entry;
}

function marcarSincronizado(data) {
  removeFromQueue(data.localId);
  saveQueue(getQueue().filter(q => conteoKey(q) !== conteoKey(data)));

  const historial = getHistorial();
  const key = conteoKey(data);
  const idx = historial.findIndex(h => h.localId === data.localId || conteoKey(h) === key);
  const patch = { status: 'synced', syncedAt: Date.now(), ...data };

  if (idx >= 0) {
    historial[idx] = { ...historial[idx], ...patch };
  } else {
    historial.unshift({ ...data, ...patch });
  }
  saveHistorial(historial);
  updateNetBadge();
}

function liberarColaParaReintento() {
  const queue = getQueue();
  if (!queue.length) return;
  let changed = false;
  const limpia = queue.map((q) => {
    if (!q.nextTryAt) return q;
    changed = true;
    const { nextTryAt, ...rest } = q;
    return rest;
  });
  if (changed) saveQueue(limpia);
}

function scheduleFlush() {
  Promise.resolve()
    .then(() => flushPendingQueue({ force: true }))
    .catch(() => {});
}

/**
 * Con internet: POST directo al servidor (sin toasts ni “1 pend.”).
 * Sin internet: cola local.
 */
export async function persistConteo(payload, opts = {}) {
  if (saveInFlight) return { saved: false };

  const editar = Boolean(opts.editar || payload.editar);
  const data = prepareData({ ...payload, editar });

  if (!editar && conteoYaRegistrado(data)) {
    toast('Este DNI ya tiene conteo hoy — edite e actualice', 'warn');
    return { saved: false };
  }

  pedirPermisoNotificaciones();
  saveInFlight = true;

  try {
    if (!isOnline()) {
      const entry = guardarLocal(data);
      programarSubidaEnFondo();
      window.dispatchEvent(new CustomEvent('historial:update'));
      return { saved: true, synced: false, payload: entry, updated: editar };
    }

    // POST directo — sin mensajes
    const resp = await guardarConteo(data, uploadTimeoutMs(), { maxAttempts: 1 });

    if (isAuthError(resp)) {
      toast('Token incorrecto — revise api-config.js', 'error');
      return { saved: false };
    }

    if (isConteoSuccess(resp)) {
      marcarSincronizado(data);
      window.dispatchEvent(new CustomEvent('historial:update'));
      return { saved: true, synced: true, payload: data, updated: Boolean(resp.updated || editar) };
    }

    // Solo si falló la red: cola silenciosa + reintento
    const entry = guardarLocal(data);
    programarSubidaEnFondo();
    scheduleFlush();
    window.dispatchEvent(new CustomEvent('historial:update'));
    return { saved: true, synced: false, payload: entry, updated: editar };
  } catch {
    const entry = guardarLocal(data);
    programarSubidaEnFondo();
    scheduleFlush();
    window.dispatchEvent(new CustomEvent('historial:update'));
    return { saved: true, synced: false, payload: entry, updated: editar };
  } finally {
    saveInFlight = false;
  }
}

async function holdWakeLock() {
  try {
    return await navigator.wakeLock?.request('screen');
  } catch {
    return null;
  }
}

function aplazarIntento(item) {
  const intentos = (item.intentos || 0) + 1;
  const espera = Math.min(45000, 2500 * intentos);
  const queue = getQueue().map((q) => (
    q.localId === item.localId
      ? { ...q, intentos, nextTryAt: Date.now() + espera }
      : q
  ));
  saveQueue(queue);
}

/**
 * Sube pendientes en silencio (sin “Subiendo 1/1”).
 */
export async function flushPendingQueue(opts = {}) {
  if (flushInFlight || flushBlocked) return;
  if (!isOnline()) return;

  await pullQueueFromIDB();
  dedupeQueue();
  if (opts.force) liberarColaParaReintento();

  const queue = getQueue();
  if (!queue.length) {
    updateNetBadge();
    return;
  }

  flushInFlight = true;
  const subidos = [];
  const wake = await holdWakeLock();

  try {
    const vistos = new Set();
    const pendientes = [...getQueue()];

    for (let i = 0; i < pendientes.length; i++) {
      const item = pendientes[i];
      const key = conteoKey(item);
      if (vistos.has(key)) {
        removeFromQueue(item.localId);
        continue;
      }
      vistos.add(key);
      if (!opts.force && item.nextTryAt && Date.now() < item.nextTryAt) continue;
      if (sendingIds.has(item.localId)) continue;

      sendingIds.add(item.localId);
      try {
        const resp = await guardarConteo({ ...item, editar: true }, uploadTimeoutMs(), { maxAttempts: 2 });
        if (isAuthError(resp)) {
          flushBlocked = true;
          break;
        }
        if (isConteoSuccess(resp)) {
          marcarSincronizado(item);
          subidos.push(item);
          continue;
        }
        const red = !resp || resp.code === 'TIMEOUT' || resp.code === 'NETWORK' || resp.code === 'PARSE_ERROR';
        aplazarIntento(item);
        if (red) break;
      } catch {
        aplazarIntento(item);
        break;
      } finally {
        sendingIds.delete(item.localId);
      }
    }
  } finally {
    try { await wake?.release(); } catch { /* ok */ }
    flushInFlight = false;
    updateNetBadge();
    window.dispatchEvent(new CustomEvent('historial:update'));
  }

  if (!subidos.length) return;
  await notificarPendientesSubidos(subidos);
  if (getQueue().length) programarSubidaEnFondo();
}

export function isFlushBlocked() {
  return flushBlocked;
}
