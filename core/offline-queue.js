import { STORAGE_KEYS } from './api-config.js';
import { uid } from './utils.js';

const IDB_NAME = 'qb_conteo_idb_v1';
const IDB_STORE = 'kv';

function openIDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(key) {
  try {
    const db = await openIDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } catch { return null; }
}

async function idbSet(key, val) {
  try {
    const db = await openIDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(val, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch { /* fallback only */ }
}

function lsGet(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
}

function lsSet(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* quota */ }
  idbSet(key, val);
}

export function getQueue() {
  return lsGet(STORAGE_KEYS.QUEUE, []);
}

/** Una sola clave por grupo + fecha (un conteo por día y grupo) */
export function conteoKey(d) {
  return `${d.grupoCosecha}|${d.fecha}`;
}

export function saveQueue(queue) {
  lsSet(STORAGE_KEYS.QUEUE, queue);
}

export function enqueue(item) {
  const queue = getQueue();
  const key = conteoKey(item);
  if (queue.some(q => q.localId === item.localId || conteoKey(q) === key)) {
    return queue.find(q => q.localId === item.localId || conteoKey(q) === key);
  }
  const entry = { ...item, localId: item.localId || uid(), queuedAt: Date.now(), status: 'pending' };
  queue.push(entry);
  saveQueue(queue);
  return entry;
}

export function removeFromQueue(localId) {
  saveQueue(getQueue().filter(q => q.localId !== localId));
}

export function getHistorial() {
  return lsGet(STORAGE_KEYS.HISTORIAL, []);
}

export function saveHistorial(list) {
  lsSet(STORAGE_KEYS.HISTORIAL, list);
}

export function addToHistorial(entry) {
  const list = getHistorial();
  list.unshift(entry);
  saveHistorial(list);
  return entry;
}

export function updateHistorial(localId, patch) {
  const list = getHistorial().map(h => h.localId === localId ? { ...h, ...patch } : h);
  saveHistorial(list);
}

export async function restoreFromIDB() {
  for (const key of Object.values(STORAGE_KEYS)) {
    if (!localStorage.getItem(key)) {
      const val = await idbGet(key);
      if (val) lsSet(key, val);
    }
  }
}
