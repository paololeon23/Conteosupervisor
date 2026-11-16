/** Padrón de trabajadores — DNI → nombre (Permisos / Faltantes) */

let fromJson = null;
let loadPromise = null;

function limpiarDni(v) {
  return String(v || '').replace(/\D/g, '').slice(0, 8);
}

function mapFromByDni(byDni) {
  if (!byDni || typeof byDni !== 'object') return new Map();
  const map = new Map();
  Object.keys(byDni).forEach((dniRaw) => {
    const dni = limpiarDni(dniRaw);
    if (dni.length < 8) return;
    const row = byDni[dniRaw] || {};
    const nombre = String(row.nombre || '').trim().toLocaleUpperCase('es-PE');
    if (!nombre) return;
    map.set(dni, { dni, nombre, cargo: String(row.cargo || '').trim() });
  });
  return map;
}

export async function loadTrabajadores() {
  if (fromJson) return fromJson;
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    try {
      const res = await fetch('/data/trabajadores.json', { cache: 'no-cache' });
      if (!res.ok) throw new Error('sin padron');
      const data = await res.json();
      fromJson = mapFromByDni(data?.byDni);
    } catch {
      fromJson = new Map();
    }
    return fromJson;
  })();
  return loadPromise;
}

export function buscarTrabajadorPorDni(dni) {
  const clean = limpiarDni(dni);
  if (clean.length < 8 || !fromJson) return null;
  return fromJson.get(clean) || null;
}

export function addTrabajadorLocal(dni, nombre) {
  const clean = limpiarDni(dni);
  const nom = String(nombre || '').trim().toLocaleUpperCase('es-PE');
  if (clean.length < 8 || !nom) return null;
  if (!fromJson) fromJson = new Map();
  const row = { dni: clean, nombre: nom, cargo: '' };
  fromJson.set(clean, row);
  return row;
}

export { limpiarDni };
