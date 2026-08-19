import { STORAGE_KEYS } from './api-config.js';

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
  } catch { /* ok */ }
}

function persist(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* quota */ }
  idbSet(key, val);
}

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
}

export function saveBorrador(data) {
  persist(STORAGE_KEYS.BORRADOR, { ...data, savedAt: Date.now() });
}

export function loadBorrador() {
  return read(STORAGE_KEYS.BORRADOR, null);
}

export function clearBorrador() {
  try { localStorage.removeItem(STORAGE_KEYS.BORRADOR); } catch { /* ok */ }
  idbSet(STORAGE_KEYS.BORRADOR, null);
}

export async function restoreBorradorFromIDB() {
  if (!localStorage.getItem(STORAGE_KEYS.BORRADOR)) {
    const val = await idbGet(STORAGE_KEYS.BORRADOR);
    if (val) persist(STORAGE_KEYS.BORRADOR, val);
  }
}
