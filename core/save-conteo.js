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
}

/**
 * Guarda o actualiza un conteo: online → servidor; sin internet → celular.
 * @param {object} payload
 * @param {{ editar?: boolean }} [opts]
 */
export async function persistConteo(payload, opts = {}) {
  if (saveInFlight) return { saved: false };

  const editar = Boolean(opts.editar || payload.editar);
  const data = prepareData({ ...payload, editar });

  if (!editar && conteoYaRegistrado(data)) {
    toast('Este DNI ya tiene conteo hoy — edite e actualice', 'warn');
    return { saved: false };
  }

  saveInFlight = true;

  try {
    const puedeEnviar = isOnline() && await pingServer();

    if (!puedeEnviar) {
      const entry = guardarLocal(data);
      toast(editar
        ? 'Actualizado en el celular — se envía al tener internet'
        : 'Guardado en el celular — se envía al tener internet', 'info');
      window.dispatchEvent(new CustomEvent('historial:update'));
      return { saved: true, synced: false, payload: entry, updated: editar };
    }

    const resp = await guardarConteo(data);
    if (isAuthError(resp)) {
      toast('Token incorrecto — revise api-config.js', 'error');
      return { saved: false };
    }

    if (isConteoSuccess(resp)) {
      marcarSincronizado(data);
      toast((resp.updated || editar) ? 'Conteo actualizado en el servidor' : 'Conteo enviado', 'success');
      window.dispatchEvent(new CustomEvent('historial:update'));
      return { saved: true, synced: true, payload: data, updated: Boolean(resp.updated || editar) };
    }

    const entry = guardarLocal(data);
    toast('No se pudo enviar — guardado en el celular', 'warn');
    window.dispatchEvent(new CustomEvent('historial:update'));
    return { saved: true, synced: false, payload: entry, updated: editar };
  } catch {
    const entry = guardarLocal(data);
    toast('Sin conexión — guardado en el celular', 'warn');
    window.dispatchEvent(new CustomEvent('historial:update'));
    return { saved: true, synced: false, payload: entry, updated: editar };
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

      sendingIds.add(item.localId);
      try {
        const resp = await guardarConteo({ ...item, editar: true });
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
