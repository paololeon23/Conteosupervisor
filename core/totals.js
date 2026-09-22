/**
 * Conteo de PERSONAS:
 * - TOTAL (roles) = Cosechadores + Escáner + Calidad + Supervisor  → ej. 43
 * - ZONAS = reparto libre de esas mismas personas (muchas zonas, sin rol por zona)
 * - La suma de todas las zonas debe ser igual al total (43 = 43)
 * - Error si zonas superan el total o al guardar si no coinciden
 */

export function calcTotalPersonalFromRoles(roles = {}) {
  const cosechadores = num(roles.cosechadores);
  const escaner = num(roles.escaner);
  const calidad = num(roles.calidad);
  const supervisorCount = num(roles.supervisorCount ?? roles.numSupervisores);
  return cosechadores + escaner + calidad + supervisorCount;
}

export function calcTotalPersonalFromPayload(d = {}) {
  return calcTotalPersonalFromRoles({
    cosechadores: d.cosechadores,
    escaner: d.escaner,
    calidad: d.calidad,
    supervisorCount: d.supervisorCount
  });
}

/**
 * Totales del dashboard en vivo: suma la lista de quien ya envió.
 * No usa t.total pegado del servidor.
 */
export function totalesDashboardEnVivo(data = {}) {
  const lista = Array.isArray(data.supervisores) ? data.supervisores : [];
  const base = data.totales || {};
  const fromList = lista.length > 0;

  const cosechadores = fromList ? lista.reduce((a, s) => a + num(s.cosechadores), 0) : num(base.cosechadores);
  const escaner = fromList ? lista.reduce((a, s) => a + num(s.escaner), 0) : num(base.escaner);
  const calidad = fromList ? lista.reduce((a, s) => a + num(s.calidad), 0) : num(base.calidad);
  const supervisorRol = fromList ? lista.reduce((a, s) => a + num(s.supervisorCount), 0) : num(base.supervisorCount);
  const supervisoresUnicos = fromList ? lista.length : num(base.supervisoresUnicos);
  const conteos = fromList ? lista.reduce((a, s) => a + num(s.conteos), 0) : num(base.conteos);

  return {
    ...base,
    cosechadores,
    escaner,
    calidad,
    supervisorCount: supervisorRol,
    supervisoresUnicos,
    conteos,
    total: cosechadores + escaner + calidad + supervisoresUnicos,
    almuerzos: num(base.almuerzos),
    permisos: num(base.permisos),
    faltas: num(base.faltas)
  };
}

export function calcTotalZonasFromList(zonas = []) {
  return zonas.reduce((s, z) => s + num(z.cantidad), 0);
}

export function totalsCoinciden(totalPersonal, totalZonas) {
  return totalPersonal > 0 && totalPersonal === totalZonas;
}

export function zonasExcedenTotal(totalPersonal, totalZonas) {
  return totalPersonal > 0 && totalZonas > totalPersonal;
}

export function maxPersonasEnZona(totalPersonal, totalOtrasZonas) {
  if (totalPersonal <= 0) return Infinity;
  return Math.max(0, totalPersonal - totalOtrasZonas);
}

function num(v) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}
