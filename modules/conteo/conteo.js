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
let draftPaused = false;
let editMode = false;

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

function clampZonasAlPersonal(tp) {
  let used = 0;
  zonasAgregadas.forEach((z, i) => {
    const max = maxPersonasEnZona(tp, used);
    const actual = Math.max(0, Number(z.cantidad) || 0);
    const next = Math.min(actual, max);
    z.cantidad = next;
    used += next;
    const inp = document.querySelector(`.zona-row__qty[data-idx="${i}"]`);
    if (inp) {
      inp.max = String(max);
      inp.value = next > 0 ? String(next) : '';
    }
  });
}

function updateTotals() {
  const tp = calcTotalRoles();
  clampZonasAlPersonal(tp);
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
  });
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

  if (Array.isArray(b.zonas)) zonasAgregadas = b.zonas.map(z => ({ ...z }));

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
  const distribucionZonas = zonasAgregadas.map(z => ({ zona: z.zona, cantidad: z.cantidad || 0 }));
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
    permisos: 0,
    faltas: 0,
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
  await loadSupervisoresCosecha();
  initSupervisorSelect(onSupervisorChange);

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
      zona: z.zona,
      cantidad: Number(z.cantidad) || 0
    }));
  }

  // Fecha principal = siempre hoy Lima (nunca se “pega” a un día anterior)
  setFecha(todayStr(), { silent: true });

  renderZonasList();
  updateTotals();
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
      toast(`Supera el total de ${payload.totalPersonal} personas`, 'warn');
    } else {
      toast(`Complete el reparto: ${payload.totalZonas} de ${payload.totalPersonal} personas`, 'warn');
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

  aplicarLicapa('');
  desbloquearDniInput();
  resetSupervisor();

  document.querySelectorAll('#roles-grid .num-input, .resumen-grid .num-input').forEach((el) => {
    el.value = '';
  });

  zonasAgregadas = [];

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
