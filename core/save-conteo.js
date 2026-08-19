import { guardarConteo, isConteoSuccess, isAuthError } from './api.js';
import { isOnline, pingServer } from './network.js';
import { todayStr, nowTimeStr, uid, toast } from './utils.js';
import {
  getQueue,
  saveQueue,
  getHistorial,
  saveHistorial,
  enqueue,
  removeFromQueue,
  conteoKey
} from './offline-queue.js';

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

/** Quita entradas repetidas en la cola (mismo grupo + fecha) */
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
  const key = conteoKey(data);
  let entry = getQueue().find(q => conteoKey(q) === key);
  if (!entry) entry = enqueue(data);

  const historial = getHistorial();
  const existe = historial.some(h => conteoKey(h) === key && h.status !== 'failed');
  if (!existe) {
    historial.unshift({ ...entry, status: 'pending' });
    saveHistorial(historial);
  }

  return entry;
}

function marcarSincronizado(data) {
  removeFromQueue(data.localId);
  saveQueue(getQueue().filter(q => conteoKey(q) !== conteoKey(data)));

  const historial = getHistorial();
  const key = conteoKey(data);
  const idx = historial.findIndex(h => h.localId === data.localId || conteoKey(h) === key);
  const patch = { status: 'synced', syncedAt: Date.now() };

  if (idx >= 0) {
    historial[idx] = { ...historial[idx], ...patch };
  } else {
    historial.unshift({ ...data, ...patch });
  }
  saveHistorial(historial);
}

/**
 * Guarda un conteo: online → servidor; sin internet → solo celular (una sola vez).
 */
export async function persistConteo(payload) {
  if (saveInFlight) return { saved: false };

  const data = prepareData(payload);
  if (conteoYaRegistrado(data)) {
    toast('Ya hay conteo para este grupo y fecha', 'warn');
    return { saved: false };
  }

  saveInFlight = true;

  try {
    const puedeEnviar = isOnline() && await pingServer();

    if (!puedeEnviar) {
      const entry = guardarLocal(data);
      toast('Guardado en el celular — se envía al tener internet', 'info');
      window.dispatchEvent(new CustomEvent('historial:update'));
      return { saved: true, synced: false, payload: entry };
    }

    const resp = await guardarConteo(data);
    if (isAuthError(resp)) {
      toast('Token incorrecto — revise api-config.js', 'error');
      return { saved: false };
    }

    if (isConteoSuccess(resp)) {
      marcarSincronizado(data);
      toast('Conteo enviado', 'success');
      window.dispatchEvent(new CustomEvent('historial:update'));
      return { saved: true, synced: true, payload: data };
    }

    const entry = guardarLocal(data);
    toast('No se pudo enviar — guardado en el celular', 'warn');
    window.dispatchEvent(new CustomEvent('historial:update'));
    return { saved: true, synced: false, payload: entry };
  } catch {
    const entry = guardarLocal(data);
    toast('Sin conexión — guardado en el celular', 'warn');
    window.dispatchEvent(new CustomEvent('historial:update'));
    return { saved: true, synced: false, payload: entry };
  } finally {
    saveInFlight = false;
  }
}

/**
 * Envía al servidor lo pendiente en cola (sin duplicar).
 */
export async function flushPendingQueue() {
  if (flushInFlight || flushBlocked) return;

  dedupeQueue();
  const queue = getQueue();
  if (!queue.length || !isOnline()) return;
  if (!await pingServer()) return;

  flushInFlight = true;

  try {
    const vistos = new Set();

    for (const item of [...getQueue()]) {
      const key = conteoKey(item);
      if (vistos.has(key)) {
        removeFromQueue(item.localId);
        continue;
      }
      vistos.add(key);

      if (sendingIds.has(item.localId)) continue;

      const yaSync = getHistorial().some(
        h => (h.localId === item.localId || conteoKey(h) === key) && h.status === 'synced'
      );
      if (yaSync) {
        removeFromQueue(item.localId);
        continue;
      }

      sendingIds.add(item.localId);
      try {
        const resp = await guardarConteo(item);
        if (isAuthError(resp)) {
          flushBlocked = true;
          toast('Sync detenido — error de autorización', 'error');
          break;
        }
        if (isConteoSuccess(resp)) {
          marcarSincronizado(item);
        }
      } catch {
        break;
      } finally {
        sendingIds.delete(item.localId);
      }
    }
  } finally {
    flushInFlight = false;
    window.dispatchEvent(new CustomEvent('historial:update'));
  }
}

export function isFlushBlocked() {
  return flushBlocked;
}
