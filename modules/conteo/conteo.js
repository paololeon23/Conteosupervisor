import { ROLES } from '../../core/api-config.js';
import { saveBorrador, loadBorrador, clearBorrador } from '../../core/draft.js';
import { persistConteo, conteoYaRegistrado } from '../../core/save-conteo.js';
import { openZonaSelect, initZonaSelect, SVG_X } from '../../core/zona-select.js';
import {
  initSupervisorSelect,
  aplicarSupervisor,
  resetSupervisor,
  isModoEditar,
  forzarSupervisorEditar,
  desbloquearDniInput
} from '../../core/supervisor-select.js';
import { preloadLicapa } from '../../core/licapa-data.js';
import { limpiarDni, extraerDni, buscarPorDni, loadSupervisoresCosecha } from '../../core/supervisores-catalog.js';
import {
  loadTrabajadores,
  buscarTrabajadorPorDni,
  addTrabajadorLocal
} from '../../core/trabajadores-catalog.js';
import { initDatePicker, setFecha, getFecha, syncFechaHoy } from '../../core/date-picker.js';
import { initComprobante, openComprobantePreview } from '../../core/comprobante.js';
import { addCustomZona, validarZona } from '../../core/zonas-catalog.js';
import { todayStr, nowTimeStr, toast, debounce, $ } from '../../core/utils.js';
import {
  calcTotalPersonalFromRoles,
  calcTotalZonasFromList,
  totalsCoinciden,
  zonasExcedenTotal,
  maxPersonasEnZona
} from '../../core/totals.js';

/** @type {{zona:string,cantidad:number}[]} */
let zonasAgregadas = [];
/** @type {{dni:string,nombre:string}[]} */
let listaPermisos = [];
/** @type {{dni:string,nombre:string}[]} */
let listaFaltas = [];
let draftPaused = false;
let editMode = false;
/** Total de personal al cargar edición (para avisar si cambió). */
let personalAlCargar = 0;

const saveDraftDebounced = debounce(persistirBorrador, 400);

function readNum(id) {
  const el = document.getElementById(String(id).replace(/^#/, ''));
  if (!el) return 0;
  const raw = String(el.value ?? '').trim();
  if (!raw) return 0;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function displayNum(n) {
  return n > 0 ? String(n) : '';
}

function num(id) {
  return readNum(id);
}

function calcTotalRoles() {
  return calcTotalPersonalFromRoles(rolesPayload());
}

function rolesPayload() {
  return {
    cosechadores: num('role-cosechadores'),
    escaner: num('role-escaner'),
    calidad: num('role-calidad'),
    supervisorCount: num('role-numSupervisores')
  };
}

function pulseTotal(el) {
  if (!el) return;
  el.classList.remove('total-box__val--pulse');
  void el.offsetWidth;
  el.classList.add('total-box__val--pulse');
}

/** Solo actualiza el max de cada input; NO borra cantidades al editar personal. */
function syncZonaMaxAttrs(tp) {
  zonasAgregadas.forEach((z, i) => {
    const otras = zonasAgregadas.reduce(
      (s, zona, j) => (j === i ? s : s + (Math.max(0, Math.round(Number(zona.cantidad)) || 0))),
      0
    );
    const max = maxPersonasEnZona(tp, otras);
    const inp = document.querySelector(`.zona-row__qty[data-idx="${i}"]`);
    if (inp) inp.max = String(max);
  });
}

function updateTotals() {
  const tp = calcTotalRoles();
  syncZonaMaxAttrs(tp);
  const tz = calcTotalZonas();
  const elPersonal = document.getElementById('total-personal');
  const elZonas = document.getElementById('total-zonas');
  const boxPersonal = document.getElementById('total-personal-box');
  const boxZonas = document.getElementById('total-zonas-box');

  if (elPersonal) {
    elPersonal.textContent = String(tp);
    pulseTotal(elPersonal);
  }
  if (elZonas) {
    elZonas.textContent = tp > 0 ? `${tz}/${tp}` : String(tz);
    pulseTotal(elZonas);
  }

  const match = totalsCoinciden(tp, tz);
  const over = zonasExcedenTotal(tp, tz);
  boxPersonal?.classList.toggle('total-box--match', match);
  boxZonas?.classList.toggle('total-box--match', match);
  boxZonas?.classList.toggle('total-box--over', over);

  saveDraftDebounced();
}

function calcTotalZonas() {
  return calcTotalZonasFromList(zonasAgregadas);
}

const LICAPAS = ['LICAPA I', 'LICAPA II', 'LICAPA III', 'LICAPA IV'];

function aplicarLicapa(valor) {
  const v = String(valor || '').trim().toUpperCase();
  const ok = LICAPAS.includes(v) ? v : '';
  const sel = $('#licapa');
  if (sel) sel.value = ok;
}

function syncResumenLimits() {}

function persistirBorrador() {
  if (draftPaused) return;
  saveBorrador({
    licapa: $('#licapa')?.value || '',
    supervisor: $('#supervisor')?.value || '',
    codSupervisor: $('#codSupervisor')?.value || '',
    fecha: $('#fecha')?.value || '',
    roles: ROLES.reduce((o, r) => ({ ...o, [r.key]: num(`role-${r.key}`) }), {}),
    zonas: zonasAgregadas,
    listaPermisos,
    listaFaltas,
    permisos: listaPermisos.length,
    faltas: listaFaltas.length,
  });
}

function normalizarPersonaLista(arr) {
  if (!Array.isArray(arr)) return [];
  const seen = new Set();
  return arr.map((p) => ({
    dni: limpiarDni(p?.dni),
    nombre: String(p?.nombre || '').trim().toLocaleUpperCase('es-PE')
  })).filter((p) => {
    if (p.dni.length < 8 || seen.has(p.dni)) return false;
    seen.add(p.dni);
    return true;
  });
}

function showAsistenciaMsg(text, type = 'info') {
  const el = $('#asistencia-msg');
  if (!el) return;
  el.hidden = !text;
  el.textContent = text || '';
  el.className = `zona-nueva__msg zona-nueva__msg--${type}`;
}

function renderAsistenciaListas() {
  const render = (id, list, tipo) => {
    const ul = document.getElementById(id);
    if (!ul) return;
    if (!list.length) {
      ul.innerHTML = '';
      return;
    }
    ul.innerHTML = list.map((p, i) => `
      <li>
        <strong>${p.dni}</strong>
        <span>${p.nombre || '—'}</span>
        <button type="button" data-tipo="${tipo}" data-idx="${i}" aria-label="Quitar">×</button>
      </li>
    `).join('');
  };
  render('lista-permisos', listaPermisos, 'PERMISO');
  render('lista-faltas', listaFaltas, 'FALTA');

  const cPerm = document.getElementById('count-permisos');
  const cFalt = document.getElementById('count-faltas');
  if (cPerm) cPerm.textContent = String(listaPermisos.length);
  if (cFalt) cFalt.textContent = String(listaFaltas.length);
}

function quitarPersonaAsistencia(tipo, idx) {
  if (tipo === 'PERMISO') listaPermisos = listaPermisos.filter((_, i) => i !== idx);
  else listaFaltas = listaFaltas.filter((_, i) => i !== idx);
  renderAsistenciaListas();
  saveDraftDebounced();
}

function syncAltaVisibilidad(tipo) {
  const dniId = tipo === 'PERMISO' ? 'dni-permiso' : 'dni-falta';
  const altaId = tipo === 'PERMISO' ? 'alta-permiso' : 'alta-falta';
  const nomId = tipo === 'PERMISO' ? 'nombre-permiso' : 'nombre-falta';
  const dni = limpiarDni(document.getElementById(dniId)?.value);
  const alta = document.getElementById(altaId);
  const found = dni.length >= 8 ? buscarTrabajadorPorDni(dni) : null;
  if (!alta) return;
  if (dni.length >= 8 && !found) {
    alta.hidden = false;
  } else {
    alta.hidden = true;
    const nom = document.getElementById(nomId);
    if (nom) nom.value = '';
  }
}

function agregarPersonaAsistencia(tipo) {
  const dniId = tipo === 'PERMISO' ? 'dni-permiso' : 'dni-falta';
  const nomId = tipo === 'PERMISO' ? 'nombre-permiso' : 'nombre-falta';
  const input = document.getElementById(dniId);
  const dni = limpiarDni(input?.value);
  if (!dni) {
    showAsistenciaMsg('');
    return;
  }
  if (dni.length < 8) {
    showAsistenciaMsg('Ingrese un DNI de 8 dígitos', 'error');
    return;
  }

  const ya = [...listaPermisos, ...listaFaltas].some((p) => p.dni === dni);
  if (ya) {
    showAsistenciaMsg('Ese DNI ya está en la lista', 'warn');
    return;
  }

  let found = buscarTrabajadorPorDni(dni);
  let nombre = found?.nombre || '';
  if (!nombre) {
    nombre = String(document.getElementById(nomId)?.value || '').trim().toLocaleUpperCase('es-PE');
    if (!nombre) {
      syncAltaVisibilidad(tipo);
      showAsistenciaMsg('DNI no está en padrón — escriba el nombre', 'warn');
      document.getElementById(nomId)?.focus();
      return;
    }
    addTrabajadorLocal(dni, nombre);
  }

  const row = { dni, nombre };
  if (tipo === 'PERMISO') listaPermisos = [...listaPermisos, row];
  else listaFaltas = [...listaFaltas, row];

  if (input) input.value = '';
  const nomEl = document.getElementById(nomId);
  if (nomEl) nomEl.value = '';
  syncAltaVisibilidad(tipo);
  showAsistenciaMsg('');
  renderAsistenciaListas();
  saveDraftDebounced();
}

function restaurarBorrador() {
  const b = loadBorrador();
  if (!b) return;

  if (b.licapa) aplicarLicapa(b.licapa);

  if (b.codSupervisor) aplicarSupervisor(b.codSupervisor);
  else if (b.supervisor) {
    const dni = limpiarDni(b.supervisor);
    if (dni.length >= 8) aplicarSupervisor(dni);
  }
  // Fecha siempre del día — no se restaura del borrador
  setFecha(todayStr(), { silent: true });

  if (b.roles) {
    ROLES.forEach(r => {
      const el = document.getElementById(`role-${r.key}`);
      if (el && b.roles[r.key] != null) el.value = displayNum(b.roles[r.key]);
    });
  }

  if (Array.isArray(b.zonas)) {
    zonasAgregadas = b.zonas.map(z => ({
      zona: String(z.zona || '').trim().toUpperCase(),
      cantidad: Math.max(0, Math.round(Number(z.cantidad)) || 0)
    })).filter((z) => z.zona);
  }

  listaPermisos = normalizarPersonaLista(b.listaPermisos);
  listaFaltas = normalizarPersonaLista(b.listaFaltas);
  renderAsistenciaListas();

  renderZonasList();
  updateTotals();
}

function renderZonasList() {
  const c = $('#zonas-list');
  if (!c) return;

  if (!zonasAgregadas.length) {
    c.innerHTML = '';
    updateTotals();
    return;
  }

  const tpInit = calcTotalRoles();
  c.innerHTML = zonasAgregadas.map((z, i) => {
    const otras = zonasAgregadas.reduce((s, zona, j) => (j === i ? s : s + (zona.cantidad || 0)), 0);
    const max = maxPersonasEnZona(tpInit, otras);
    return `
    <div class="zona-row" data-idx="${i}">
      <div class="zona-row__info">
        <span class="zona-row__name">${z.zona}</span>
      </div>
      <input type="number" class="num-input zona-row__qty" min="0" max="${max}" inputmode="numeric"
        value="${z.cantidad > 0 ? z.cantidad : ''}" placeholder="0" data-idx="${i}" aria-label="Personas en ${z.zona}">
      <button type="button" class="zona-row__del" data-idx="${i}" aria-label="Quitar">
        <span class="zona-row__del-icon">${SVG_X}</span>
      </button>
    </div>`;
  }).join('');

  c.querySelectorAll('.zona-row__qty').forEach(inp => {
    inp.addEventListener('input', (e) => {
      const idx = parseInt(e.target.dataset.idx, 10);
      const tp = calcTotalRoles();
      const otras = zonasAgregadas.reduce((s, z, i) => (i === idx ? s : s + (z.cantidad || 0)), 0);
      let val = Math.max(0, parseInt(e.target.value, 10) || 0);
      const max = maxPersonasEnZona(tp, otras);
      e.target.max = String(max);
      if (val > max) {
        val = max;
        toast(tp > 0
          ? `Máximo ${max} aquí · total ${tp}`
          : 'Primero ingrese el personal', 'warn');
      }
      zonasAgregadas[idx].cantidad = val;
      e.target.value = val > 0 ? String(val) : '';
      updateTotals();
    });
  });

  c.querySelectorAll('.zona-row__del').forEach(btn => {
    btn.addEventListener('click', () => {
      zonasAgregadas.splice(parseInt(btn.dataset.idx, 10), 1);
      renderZonasList();
    });
  });

  updateTotals();
}

function agregarZona(nombre) {
  const val = validarZona(nombre);
  if (!val.ok) {
    toast(val.msg, 'error');
    return false;
  }
  if (zonasAgregadas.some(z => z.zona === val.nombre)) {
    toast('Esa zona ya está agregada', 'warn');
    return false;
  }
  addCustomZona(val.nombre);
  zonasAgregadas.push({ zona: val.nombre, cantidad: 0 });
  renderZonasList();
  return true;
}

function showZonaNuevaMsg(text, type = 'info') {
  const el = $('#zona-nueva-msg');
  if (!el) return;
  el.hidden = false;
  el.textContent = text;
  el.className = `zona-nueva__msg zona-nueva__msg--${type}`;
}

function onAgregarZonaManual() {
  const input = $('#zona-nueva-input');
  if (!input) return;
  const ok = agregarZona(input.value);
  if (ok) {
    input.value = '';
    showZonaNuevaMsg('Zona agregada — guardada solo en este celular', 'ok');
    saveDraftDebounced();
    setTimeout(() => { const m = $('#zona-nueva-msg'); if (m) m.hidden = true; }, 2500);
  }
}

function onZonaNuevaInput() {
  const input = $('#zona-nueva-input');
  const msg = $('#zona-nueva-msg');
  if (!input || !msg) return;
  const raw = input.value.trim();
  if (!raw) {
    msg.hidden = true;
    return;
  }
  const val = validarZona(raw);
  if (!val.ok) {
    showZonaNuevaMsg(val.msg, 'error');
    return;
  }
  if (zonasAgregadas.some(z => z.zona === val.nombre)) {
    showZonaNuevaMsg('Ya está en la lista', 'warn');
    return;
  }
  msg.hidden = true;
}

function getPayload(extra = {}) {
  const roles = rolesPayload();
  const distribucionZonas = zonasAgregadas.map(z => ({
    zona: z.zona,
    cantidad: Math.max(0, Math.round(Number(z.cantidad)) || 0)
  }));
  const totalPersonal = calcTotalPersonalFromRoles(roles);
  const totalZonas = calcTotalZonasFromList(distribucionZonas);

  const licapa = $('#licapa')?.value?.trim() || '';
  return {
    licapa,
    grupoCosecha: licapa,
    grupoLabel: licapa,
    lote: '',
    codLote: '',
    variedad: '',
    supervisor: $('#supervisor')?.value?.trim() || '',
    codSupervisor: $('#codSupervisor')?.value?.trim() || '',
    fecha: $('#fecha')?.value || todayStr(),
    modulo: '',
    turno: '',
    ...roles,
    totalPersonal,
    distribucionZonas,
    totalZonas,
    almuerzos: 0,
    listaPermisos: listaPermisos.map((p) => ({ ...p })),
    listaFaltas: listaFaltas.map((p) => ({ ...p })),
    permisos: listaPermisos.length,
    faltas: listaFaltas.length,
    editar: editMode || isModoEditar(),
    ...extra
  };
}

export async function initConteo() {
  renderRoles();
  initZonaSelect();
  initDatePicker(() => saveDraftDebounced());
  bindEvents();
  initComprobante({ onGuardar: guardarDesdeResumen });
  setFecha(todayStr(), { silent: true });
  renderZonasList();
  bindLiveTotals();
  updateTotals();

  await preloadLicapa();
  await Promise.all([loadSupervisoresCosecha(), loadTrabajadores()]);
  initSupervisorSelect(onSupervisorChange);
  renderAsistenciaListas();

  restaurarBorrador();
  setFecha(todayStr(), { silent: true });

  // Si la PWA queda abierta de un día a otro, refrescar fecha Lima
  const refreshFechaLima = () => {
    if (document.visibilityState === 'hidden') return;
    syncFechaHoy({ silent: true });
  };
  document.addEventListener('visibilitychange', refreshFechaLima);
  window.addEventListener('pageshow', refreshFechaLima);
  window.addEventListener('focus', refreshFechaLima);
}

function onSupervisorChange({ supervisor, modoEditar, existente }) {
  editMode = Boolean(modoEditar);
  const btn = $('#btn-ver-resumen');
  if (btn) btn.textContent = editMode ? 'Ver y actualizar' : 'Ver resumen';

  if (!supervisor) return;

  if (!existente) {
    // Nuevo DNI sin marca: no rellenar con data ajena
    return;
  }

  rellenarFormularioDesde(existente, { toastMsg: 'Datos de hoy cargados — puede editarlos' });
}

/**
 * Carga un conteo del historial de ESTE celular para editar en el servidor.
 * El DNI ya viene en el registro (no se pide de nuevo).
 */
export function cargarConteoParaEditar(item) {
  if (!item?.localId) {
    toast('Solo puede editar lo enviado desde este celular', 'error');
    return false;
  }

  const dni = limpiarDni(item.codSupervisor) || extraerDni(item.supervisor);
  if (!dni || dni.length < 8) {
    toast('Este registro no tiene DNI — no se puede actualizar en el servidor', 'error');
    return false;
  }
  if (!buscarPorDni(dni)) {
    toast('DNI del registro no está en la lista de supervisores', 'error');
    return false;
  }

  draftPaused = true;
  forzarSupervisorEditar(dni, { skipNotify: true });
  editMode = true;
  const btn = $('#btn-ver-resumen');
  if (btn) btn.textContent = 'Ver y actualizar';

  rellenarFormularioDesde(item, {
    toastMsg: 'Listo para editar — al guardar se actualiza en el servidor'
  });
  draftPaused = false;
  return true;
}

function rellenarFormularioDesde(data, { toastMsg = '' } = {}) {
  draftPaused = true;

  aplicarLicapa(data.licapa || data.grupoLabel || data.grupoCosecha);

  const roleMap = {
    cosechadores: data.cosechadores,
    escaner: data.escaner,
    calidad: data.calidad,
    numSupervisores: data.supervisorCount
  };
  Object.entries(roleMap).forEach(([key, val]) => {
    const el = document.getElementById(`role-${key}`);
    if (el && val != null) el.value = displayNum(val);
  });

  if (Array.isArray(data.distribucionZonas)) {
    zonasAgregadas = data.distribucionZonas.map((z) => ({
      zona: String(z.zona || '').trim().toUpperCase(),
      cantidad: Math.max(0, Math.round(Number(z.cantidad)) || 0)
    })).filter((z) => z.zona);
  }

  listaPermisos = normalizarPersonaLista(data.listaPermisos);
  listaFaltas = normalizarPersonaLista(data.listaFaltas);
  renderAsistenciaListas();

  // Fecha principal = siempre hoy Lima (nunca se “pega” a un día anterior)
  setFecha(todayStr(), { silent: true });

  renderZonasList();
  updateTotals();
  personalAlCargar = calcTotalRoles();
  draftPaused = false;
  if (toastMsg) toast(toastMsg, 'info');
}

function bindLiveTotals() {
  const root = document.getElementById('tab-conteo');
  if (!root || root.dataset.totalsBound) return;
  root.dataset.totalsBound = '1';

  const onNumChange = (e) => {
    const t = e.target;
    if (!t?.matches?.('.role-input, .num-input, .zona-row__qty')) return;
    updateTotals();
  };

  ['input', 'change', 'keyup'].forEach(evt => root.addEventListener(evt, onNumChange));
}

function renderRoles() {
  const c = $('#roles-grid');
  if (!c) return;
  c.innerHTML = ROLES.map(r => `
    <div class="num-field">
      <label for="role-${r.key}">${r.label}</label>
      <input type="number" id="role-${r.key}" min="0" inputmode="numeric" placeholder="0" class="num-input role-input">
    </div>
  `).join('');
  updateTotals();
}

function bindEvents() {
  const form = $('#form-conteo');
  form?.addEventListener('input', (e) => {
    if (e.target.matches('.num-input')) updateTotals();
    saveDraftDebounced();
  });
  form?.addEventListener('change', (e) => {
    if (e.target.matches('.num-input')) updateTotals();
  });
  $('#licapa')?.addEventListener('change', () => {
    aplicarLicapa($('#licapa')?.value);
    saveDraftDebounced();
  });
  $('#btn-add-zona')?.addEventListener('click', () => {
    openZonaSelect(agregarZona, zonasAgregadas.map(z => z.zona));
  });
  $('#btn-zona-nueva')?.addEventListener('click', onAgregarZonaManual);
  $('#zona-nueva-input')?.addEventListener('input', onZonaNuevaInput);
  $('#zona-nueva-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); onAgregarZonaManual(); }
  });

  const bindAsistencia = (tipo, dniId, nomId, btnId) => {
    const dniEl = document.getElementById(dniId);
    const nomEl = document.getElementById(nomId);
    const btn = document.getElementById(btnId);
    dniEl?.addEventListener('input', () => {
      dniEl.value = limpiarDni(dniEl.value);
      syncAltaVisibilidad(tipo);
      showAsistenciaMsg('');
    });
    dniEl?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); agregarPersonaAsistencia(tipo); }
    });
    nomEl?.addEventListener('input', () => {
      nomEl.value = String(nomEl.value || '').toLocaleUpperCase('es-PE');
    });
    nomEl?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); agregarPersonaAsistencia(tipo); }
    });
    btn?.addEventListener('click', () => agregarPersonaAsistencia(tipo));
  };
  bindAsistencia('PERMISO', 'dni-permiso', 'nombre-permiso', 'btn-add-permiso');
  bindAsistencia('FALTA', 'dni-falta', 'nombre-falta', 'btn-add-falta');

  document.getElementById('lista-permisos')?.addEventListener('click', (e) => {
    const btn = e.target?.closest?.('button[data-idx]');
    if (!btn) return;
    quitarPersonaAsistencia('PERMISO', Number(btn.dataset.idx));
  });
  document.getElementById('lista-faltas')?.addEventListener('click', (e) => {
    const btn = e.target?.closest?.('button[data-idx]');
    if (!btn) return;
    quitarPersonaAsistencia('FALTA', Number(btn.dataset.idx));
  });

  $('#form-conteo')?.addEventListener('submit', (e) => {
    e.preventDefault();
    onVerResumen();
  });
  $('#btn-ver-resumen')?.addEventListener('click', onVerResumen);
}

function buildPayloadParaGuardar() {
  return getPayload({
    fechaRegistro: todayStr(),
    horaRegistro: nowTimeStr()
  });
}

function validarPayload(payload) {
  if (!payload.codSupervisor || limpiarDni(payload.codSupervisor).length < 8) {
    toast('Ingrese su DNI de supervisor', 'error');
    return false;
  }
  if (!payload.supervisor) { toast('Identifíquese con su DNI o registre al supervisor', 'error'); return false; }
  if (!payload.licapa) { toast('Seleccione la Licapa', 'error'); return false; }
  if (payload.totalPersonal === 0) { toast('Ingrese personal', 'error'); return false; }
  if (!payload.distribucionZonas.length) { toast('Agregue al menos una zona', 'error'); return false; }
  if (!payload.distribucionZonas.some(z => z.cantidad > 0)) {
    toast('Ingrese personas en al menos una zona', 'error');
    return false;
  }
  if (!totalsCoinciden(payload.totalPersonal, payload.totalZonas)) {
    if (zonasExcedenTotal(payload.totalPersonal, payload.totalZonas)) {
      toast(`Las zonas (${payload.totalZonas}) superan el personal (${payload.totalPersonal}). Revise el reparto`, 'warn');
    } else if (payload.editar && personalAlCargar > 0 && payload.totalPersonal !== personalAlCargar) {
      toast(
        `Se modificó la cantidad (${personalAlCargar} → ${payload.totalPersonal}). Revise las zonas: van ${payload.totalZonas} de ${payload.totalPersonal}`,
        'warn'
      );
    } else {
      toast(`Revise las zonas: deben sumar ${payload.totalPersonal} (van ${payload.totalZonas})`, 'warn');
    }
    return false;
  }
  if (!payload.editar && conteoYaRegistrado(payload)) {
    toast('Este DNI ya tiene conteo hoy — se cargará para editar', 'warn');
    return false;
  }
  return true;
}

function onVerResumen() {
  const payload = buildPayloadParaGuardar();
  if (!validarPayload(payload)) return;
  openComprobantePreview(payload);
}

async function guardarDesdeResumen(payload) {
  if (!validarPayload(payload)) return { saved: false };
  const result = await persistConteo(payload, { editar: Boolean(payload.editar) });
  if (result.saved) resetForm();
  return result;
}

function resetForm() {
  saveDraftDebounced.cancel();
  draftPaused = true;
  editMode = false;
  personalAlCargar = 0;

  aplicarLicapa('');
  desbloquearDniInput();
  resetSupervisor();

  document.querySelectorAll('#roles-grid .num-input, .resumen-grid .num-input, .asistencia-dni, .asistencia-alta input').forEach((el) => {
    el.value = '';
  });

  zonasAgregadas = [];
  listaPermisos = [];
  listaFaltas = [];
  renderAsistenciaListas();
  showAsistenciaMsg('');
  ['alta-permiso', 'alta-falta'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.hidden = true;
  });

  const zonaInput = $('#zona-nueva-input');
  if (zonaInput) zonaInput.value = '';
  const zonaMsg = $('#zona-nueva-msg');
  if (zonaMsg) zonaMsg.hidden = true;

  const btn = $('#btn-ver-resumen');
  if (btn) btn.textContent = 'Ver resumen';

  setFecha(todayStr(), { silent: true });
  renderZonasList();
  updateTotals();
  clearBorrador();
  saveDraftDebounced.cancel();
  draftPaused = false;
}
