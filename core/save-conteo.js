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

/** Bomba de reintentos en segundo plano hasta vaciar la cola */
let pumpTimer = 0;
let pumpRound = 0;
const PUMP_DELAYS_MS = [600, 1200, 2500, 4000, 7000, 10000, 15000];

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

function guardarLocal(data, { silentBadge = false } = {}) {
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
  if (!silentBadge) updateNetBadge();

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

/**
 * Reintenta en segundo plano hasta que no quede nada pendiente.
 * No bloquea la UI.
 */
export function startBackgroundPump() {
  programarSubidaEnFondo().catch(() => {});
  if (pumpTimer) {
    clearTimeout(pumpTimer);
    pumpTimer = 0;
  }
  pumpRound = 0;

  const tick = async () => {
    pumpTimer = 0;
    if (!isOnline() || flushBlocked) return;
    try {
      await flushPendingQueue({ force: true });
    } catch { /* ok */ }

    if (!getQueue().length) {
      pumpRound = 0;
      updateNetBadge();
      return;
    }

    const delay = PUMP_DELAYS_MS[Math.min(pumpRound, PUMP_DELAYS_MS.length - 1)];
    pumpRound += 1;
    programarSubidaEnFondo().catch(() => {});
    pumpTimer = window.setTimeout(() => {
      tick().catch(() => {});
    }, delay);
  };

  // Primer intento al toque (microtask)
  Promise.resolve()
    .then(() => tick())
    .catch(() => {});
}

/**
 * Guarda ya en el celular y sube en línea (o en segundo plano si falla/sin red).
 * Así no se pierde el conteo y la cola se vacía sola.
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
    // 1) Siempre local primero (no se pierde si corta la red)
    const entry = guardarLocal(data, { silentBadge: isOnline() });
    programarSubidaEnFondo().catch(() => {});
    window.dispatchEvent(new CustomEvent('historial:update'));

    if (!isOnline()) {
      updateNetBadge();
      return { saved: true, synced: false, payload: entry, updated: editar };
    }

    // 2) En línea: un intento ya; si ok → 0 pend.
    const resp = await guardarConteo(
      { ...entry, editar: true },
      uploadTimeoutMs(),
      { maxAttempts: 1 }
    );

    if (isAuthError(resp)) {
      toast('Token incorrecto — revise api-config.js', 'error');
      updateNetBadge();
      return { saved: false };
    }

    if (isConteoSuccess(resp)) {
      marcarSincronizado(entry);
      window.dispatchEvent(new CustomEvent('historial:update'));
      return {
        saved: true,
        synced: true,
        payload: entry,
        updated: Boolean(resp.updated || editar)
      };
    }

    // 3) Falló la red: queda en cola y se bombea en segundo plano
    updateNetBadge();
    startBackgroundPump();
    window.dispatchEvent(new CustomEvent('historial:update'));
    return { saved: true, synced: false, payload: entry, updated: editar };
  } catch {
    updateNetBadge();
    startBackgroundPump();
    window.dispatchEvent(new CustomEvent('historial:update'));
    const entry = getQueue().find((q) => conteoKey(q) === conteoKey(data)) || data;
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
  const espera = Math.min(10000, 1000 * intentos);
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
        const resp = await guardarConteo(
          { ...item, editar: true },
          uploadTimeoutMs(),
          { maxAttempts: opts.force ? 3 : 2 }
        );
        if (isAuthError(resp)) {
          flushBlocked = true;
          break;
        }
        if (isConteoSuccess(resp)) {
          marcarSincronizado(item);
          subidos.push(item);
          continue;
        }
        aplazarIntento(item);
        // Con force seguimos con el resto; sin force paramos si es red
        const red = !resp || resp.code === 'TIMEOUT' || resp.code === 'NETWORK' || resp.code === 'PARSE_ERROR';
        if (red && !opts.force) break;
      } catch {
        aplazarIntento(item);
        if (!opts.force) break;
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

  if (subidos.length) await notificarPendientesSubidos(subidos);

  if (getQueue().length) {
    // Seguir bombeando en fondo
    if (!pumpTimer) startBackgroundPump();
    else programarSubidaEnFondo().catch(() => {});
  } else {
    pumpRound = 0;
  }
}

export function isFlushBlocked() {
  return flushBlocked;
}
