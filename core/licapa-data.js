let lotesCache = null;
let gruposCache = null;

const GRUPOS_TOTAL = 50;

function buildGruposList() {
  const list = [];
  for (let i = 1; i <= GRUPOS_TOTAL; i++) {
    list.push(`Grupo Cosecha - ${String(i).padStart(2, '0')}`);
  }
  return list;
}

export async function getLotes() {
  if (lotesCache) return lotesCache;
  try {
    const res = await fetch('/data/lotes-licapa.json');
    lotesCache = await res.json();
  } catch {
    lotesCache = [];
  }
  return lotesCache;
}

export async function getGrupos() {
  if (gruposCache) return gruposCache;
  gruposCache = buildGruposList();
  return gruposCache;
}

export function filtrarLotes(query, lotes) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return lotes;
  return lotes.filter(item => {
    const hay = [
      item.lote,
      item.codLote,
      item.modulo,
      item.turno,
      item.variedad,
      `lote ${item.lote}`
    ].join(' ').toLowerCase();
    return hay.includes(q) || hay.replace(/\s/g, '').includes(q.replace(/\s/g, ''));
  });
}

export function filtrarGrupos(query, grupos) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return grupos;

  const qNum = q.replace(/\D/g, '');
  let resultados = grupos.filter(g => {
    const gl = g.toLowerCase();
    if (gl.includes(q)) return true;
    if (!qNum) return false;
    const m = gl.match(/(\d+)/);
    if (!m) return false;
    const numInt = parseInt(m[1], 10);
    return String(numInt) === qNum || m[1].includes(qNum);
  });

  if (qNum) {
    const exact = parseInt(qNum, 10);
    if (exact >= 1 && exact <= GRUPOS_TOTAL) {
      const exactLabel = `Grupo Cosecha - ${String(exact).padStart(2, '0')}`;
      resultados = [exactLabel, ...resultados.filter(g => g !== exactLabel)];
    }
  }

  return [...new Set(resultados)];
}

export function numeroGrupo(label) {
  const m = String(label || '').match(/(\d+)/);
  return m ? String(parseInt(m[1], 10)) : label;
}

export function numeroModulo(modulo) {
  return String(modulo || '').replace(/\D/g, '') || modulo;
}

export async function preloadLicapa() {
  await Promise.all([getLotes(), getGrupos()]);
}
