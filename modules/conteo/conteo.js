import { ROLES } from '../../core/api-config.js';
import { saveBorrador, loadBorrador, clearBorrador } from '../../core/draft.js';
import { persistConteo, conteoYaRegistrado } from '../../core/save-conteo.js';
import { openZonaSelect, initZonaSelect, SVG_X } from '../../core/zona-select.js';
import { openLoteSelect, initLoteSelect, aplicarLote, resetLote } from '../../core/lote-select.js';
import { openGrupoSelect, initGrupoSelect, aplicarGrupo, resetGrupo } from '../../core/grupo-select.js';
import {
  initSupervisorSelect,
  aplicarSupervisor,
  resetSupervisor,
  isModoEditar,
  forzarSupervisorEditar,
  desbloquearDniInput
} from '../../core/supervisor-select.js';
import { preloadLicapa } from '../../core/licapa-data.js';
import { limpiarDni, extraerDni, buscarPorDni } from '../../core/supervisores-catalog.js';
import { initDatePicker, setFecha, getFecha } from '../../core/date-picker.js';
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

function updateTotals() {
  const tp = calcTotalRoles();
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

  syncResumenLimits(tp);
  RESUMEN_FIELDS.forEach(({ id, label }) => clampResumenInput(id, label));

  saveDraftDebounced();
}

function calcTotalZonas() {
  return calcTotalZonasFromList(zonasAgregadas);
}

const RESUMEN_FIELDS = [
  { id: 'almuerzos', label: 'Almuerzos' },
  { id: 'permisos', label: 'Permisos' },
  { id: 'faltas', label: 'Faltas' }
];

function syncResumenLimits(totalPersonal) {
  RESUMEN_FIELDS.forEach(({ id }) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (totalPersonal > 0) {
      el.max = totalPersonal;
      el.setAttribute('aria-valuemax', String(totalPersonal));
    } else {
      el.removeAttribute('max');
      el.removeAttribute('aria-valuemax');
    }
  });
}

function clampResumenInput(id, label) {
  const el = document.getElementById(id);
  if (!el) return;
  const tp = calcTotalRoles();
  if (tp <= 0) return;
  const val = readNum(id);
  if (val > tp) {
    el.value = displayNum(tp);
    toast(`${label}: máximo ${tp} personas`, 'warn');
  }
}

function persistirBorrador() {
  if (draftPaused) return;
  saveBorrador({
    grupo: $('#grupo')?.value || '',
    grupoLabel: $('#grupo-label')?.value || '',
    lote: $('#lote')?.value || '',
    codLote: $('#codLote')?.value || '',
    variedad: $('#variedad')?.value || '',
    supervisor: $('#supervisor')?.value || '',
    codSupervisor: $('#codSupervisor')?.value || '',
    fecha: $('#fecha')?.value || '',
    modulo: $('#modulo')?.value || '',
    turno: $('#turno')?.value || '',
    roles: ROLES.reduce((o, r) => ({ ...o, [r.key]: num(`role-${r.key}`) }), {}),
    zonas: zonasAgregadas,
    almuerzos: num('almuerzos'),
    permisos: num('permisos'),
    faltas: num('faltas')
  });
}

function restaurarBorrador() {
  const b = loadBorrador();
  if (!b) return;

  if (b.grupoLabel) aplicarGrupo(b.grupoLabel);
  else if (b.grupo && $('#grupo')) $('#grupo').value = b.grupo;

  if (b.lote && b.modulo && b.turno) {
    aplicarLote({
      lote: b.lote,
      codLote: b.codLote || '',
      variedad: b.variedad || '',
      modulo: `M${b.modulo}`,
      turno: b.turno
    });
  }

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

  if ($('#almuerzos') && b.almuerzos != null) $('#almuerzos').value = displayNum(b.almuerzos);
  if ($('#permisos') && b.permisos != null) $('#permisos').value = displayNum(b.permisos);
  if ($('#faltas') && b.faltas != null) $('#faltas').value = displayNum(b.faltas);

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

  c.innerHTML = zonasAgregadas.map((z, i) => `
    <div class="zona-row" data-idx="${i}">
      <div class="zona-row__info">
        <span class="zona-row__name">${z.zona}</span>
        <span class="zona-row__area">PRODUCCION - COSECHA</span>
      </div>
      <input type="number" class="num-input zona-row__qty" min="0" inputmode="numeric"
        value="${z.cantidad > 0 ? z.cantidad : ''}" placeholder="0" data-idx="${i}" aria-label="Personas en ${z.zona}" title="Personas">
      <button type="button" class="zona-row__del" data-idx="${i}" aria-label="Quitar">
        <span class="zona-row__del-icon">${SVG_X}</span>
      </button>
    </div>
  `).join('');

  c.querySelectorAll('.zona-row__qty').forEach(inp => {
    inp.addEventListener('input', (e) => {
      const idx = parseInt(e.target.dataset.idx, 10);
      const tp = calcTotalRoles();
      const otras = zonasAgregadas.reduce((s, z, i) => (i === idx ? s : s + (z.cantidad || 0)), 0);
      let val = Math.max(0, parseInt(e.target.value, 10) || 0);
      const max = maxPersonasEnZona(tp, otras);
      if (tp > 0 && val > max) {
        val = max;
        toast(`Máximo ${tp} personas en total`, 'warn');
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

  return {
    grupoCosecha: $('#grupo')?.value?.trim() || '',
    grupoLabel: $('#grupo-label')?.value?.trim() || '',
    lote: $('#lote')?.value?.trim() || '',
    codLote: $('#codLote')?.value?.trim() || '',
    variedad: $('#variedad')?.value?.trim() || '',
    supervisor: $('#supervisor')?.value?.trim() || '',
    codSupervisor: $('#codSupervisor')?.value?.trim() || '',
    fecha: $('#fecha')?.value || todayStr(),
    modulo: $('#modulo')?.value?.trim() || '',
    turno: $('#turno')?.value?.trim() || '',
    ...roles,
    totalPersonal,
    distribucionZonas,
    totalZonas,
    almuerzos: num('almuerzos'),
    permisos: num('permisos'),
    faltas: num('faltas'),
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

  await Promise.all([
    preloadLicapa(),
    initLoteSelect(),
    initGrupoSelect()
  ]);
  initSupervisorSelect(onSupervisorChange);

  restaurarBorrador();
  setFecha(todayStr(), { silent: true });
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
    toastMsg: 'Listo para editar — al guardar se actualiza en el servidor',
    keepFecha: true
  });
  draftPaused = false;
  return true;
}

function rellenarFormularioDesde(data, { toastMsg = '', keepFecha = false } = {}) {
  draftPaused = true;

  if (data.grupoCosecha || data.grupoLabel) {
    const n = String(data.grupoCosecha || '').replace(/\D/g, '');
    const label = data.grupoLabel
      || (n ? `Grupo Cosecha - ${n.padStart(2, '0')}` : String(data.grupoCosecha || ''));
    if (label) aplicarGrupo(label);
  }

  if (data.lote) {
    const mod = data.modulo ? `M${String(data.modulo).replace(/\D/g, '')}` : 'M';
    aplicarLote({
      lote: data.lote,
      codLote: data.codLote || '',
      variedad: data.variedad || '',
      modulo: mod,
      turno: data.turno || ''
    });
  }

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

  if ($('#almuerzos') && data.almuerzos != null) $('#almuerzos').value = displayNum(data.almuerzos);
  if ($('#permisos') && data.permisos != null) $('#permisos').value = displayNum(data.permisos);
  if ($('#faltas') && data.faltas != null) $('#faltas').value = displayNum(data.faltas);

  if (keepFecha && data.fecha) setFecha(data.fecha, { silent: true });
  else setFecha(todayStr(), { silent: true });

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
    if (t.matches('.resumen-tile__input')) {
      const field = RESUMEN_FIELDS.find(f => f.id === t.id);
      if (field) clampResumenInput(field.id, field.label);
    }
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
  $('#btn-pick-grupo')?.addEventListener('click', () => {
    openGrupoSelect((label) => { aplicarGrupo(label); saveDraftDebounced(); });
  });
  $('#btn-pick-lote')?.addEventListener('click', () => {
    openLoteSelect((item) => { aplicarLote(item); saveDraftDebounced(); });
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
  if (!payload.supervisor) { toast('DNI no válido en la lista', 'error'); return false; }
  if (!payload.grupoCosecha) { toast('Seleccione el grupo', 'error'); return false; }
  if (!payload.lote) { toast('Seleccione el lote', 'error'); return false; }
  if (!payload.modulo || !payload.turno) { toast('Seleccione lote para módulo/turno', 'error'); return false; }
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
  for (const { id, label } of RESUMEN_FIELDS) {
    if (payload[id] > payload.totalPersonal) {
      toast(`${label}: no puede ser mayor a ${payload.totalPersonal}`, 'warn');
      return false;
    }
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

  resetGrupo();
  desbloquearDniInput();
  resetSupervisor();
  resetLote();

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
