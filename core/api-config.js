/** Conexión DIRECTA a Google Apps Script */
export const SCRIPT = {
  CONTEO: 'https://script.google.com/macros/s/AKfycbxBt01BESHhHZQdoUILCtGVoSsoQVc8LexaikPgnJUa8XfsCgqRvus14Qce_lKyTK9nxA/exec',
  TOKEN: 'TU_TOKEN_SECRETO'
};

export const STORAGE_KEYS = {
  QUEUE: 'qb_conteo_queue_v1',
  HISTORIAL: 'qb_conteo_historial_v1',
  BORRADOR: 'qb_conteo_borrador_v1'
};

export const APP_VERSION = '1.0.0';
export const TZ = 'America/Lima';
export const HISTORIAL_TTL_MS = 48 * 60 * 60 * 1000;

export const ROLES = [
  { key: 'cosechadores', label: 'Cosechadores' },
  { key: 'escaner', label: 'Escaner' },
  { key: 'calidad', label: 'Calidad' },
  { key: 'numSupervisores', label: 'Supervisor' }
];
