/** Catálogo oficial + zonas custom guardadas en el celular */
export const ZONAS_CATALOGO = [
  'ALTO TRUJILLO',
  'CASA GRANDE',
  'CHICAMA',
  'CHICLIN',
  'CHOCOPE',
  'FACALA',
  'FLORENCIA DE MORA',
  'MILAGRO',
  'CARTAVIO',
  'MOCAN',
  'PAIJAN',
  'PORVENIR',
  'ROMA',
  'LAREDO',
  'TRUJILLO',
  'BUENOS AIRES',
  'ESPERANZA',
  'SAUSAL',
  'MAGDALENA DE CAO',
  'PACANGUIA',
  'ASCOPE',
  'PUERTO MALABRIGO',
  'GRAN CHIMU',
  'CONSTANCIA',
  'MANUEL AREVALO',
  'GARRAPON',
  'PACASMAYO'
];

const CUSTOM_KEY = 'qb_zonas_custom_v1';
const ZONA_VALID_RE = /^[A-ZÁÉÍÓÚÜÑ0-9][A-ZÁÉÍÓÚÜÑ0-9 -]*$/;

export function getAllZonas() {
  const custom = getCustomZonas();
  const set = new Set([...ZONAS_CATALOGO, ...custom]);
  return [...set].sort((a, b) => a.localeCompare(b, 'es'));
}

export function getCustomZonas() {
  try {
    return JSON.parse(localStorage.getItem(CUSTOM_KEY) || '[]');
  } catch {
    return [];
  }
}

export function normalizarZona(s) {
  return String(s || '').trim().toLocaleUpperCase('es-PE').replace(/\s+/g, ' ');
}

/** Valida nombre de zona antes de guardar localmente */
export function validarZona(s) {
  const nombre = normalizarZona(s);
  if (!nombre) return { ok: false, msg: 'Escriba el nombre de la zona' };
  if (nombre.length < 2) return { ok: false, msg: 'Mínimo 2 caracteres' };
  if (nombre.length > 40) return { ok: false, msg: 'Máximo 40 caracteres' };
  if (!ZONA_VALID_RE.test(nombre)) {
    return { ok: false, msg: 'Solo letras, números y guiones' };
  }
  const letras = nombre.replace(/[^A-ZÁÉÍÓÚÜÑ]/g, '');
  if (letras.length < 2) return { ok: false, msg: 'Use al menos 2 letras' };
  return { ok: true, nombre };
}

export function zonaExiste(nombre) {
  return getAllZonas().includes(normalizarZona(nombre));
}

export function addCustomZona(nombre) {
  const val = validarZona(nombre);
  if (!val.ok) return null;
  nombre = val.nombre;
  const custom = getCustomZonas();
  if (!custom.includes(nombre) && !ZONAS_CATALOGO.includes(nombre)) {
    custom.push(nombre);
    localStorage.setItem(CUSTOM_KEY, JSON.stringify(custom));
  }
  return nombre;
}

export function filtrarZonas(query) {
  const q = normalizarZona(query);
  const all = getAllZonas();
  if (!q) return all;
  return all.filter(z => z.includes(q));
}
