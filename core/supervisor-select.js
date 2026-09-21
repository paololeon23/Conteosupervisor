import { buscarPorDni, limpiarDni, addCustomSupervisor } from './supervisores-catalog.js';
import { consultarConteo } from './api.js';
import { isOnline } from './network.js';
import { $, toast, todayStr } from './utils.js';

/** @type {null | { dni: string, nombre: string, fundo: string }} */
let actual = null;
/** @type {boolean} */
let modoEditar = false;
/** @type {((info: object) => void) | null} */
let onChangeCb = null;
let consultando = false;
let lastQueryToken = 0;

export function initSupervisorSelect(onChange) {
  onChangeCb = typeof onChange === 'function' ? onChange : null;
  const input = $('#supervisor-dni');
  if (!input || input.dataset.bound) return;
  input.dataset.bound = '1';

  input.addEventListener('input', () => {
    input.value = limpiarDni(input.value);
    if (input.value.length < 8) {
      limpiarIdentidad(false);
      return;
    }
    if (input.value.length >= 8) identificarDebounced();
  });

  input.addEventListener('change', () => identificar());
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      identificar();
    }
  });

  const nombreAlta = $('#supervisor-alta-nombre');
  const btnAlta = $('#btn-supervisor-alta');
  if (nombreAlta && !nombreAlta.dataset.bound) {
    nombreAlta.dataset.bound = '1';
    nombreAlta.addEventListener('input', () => {
      nombreAlta.value = String(nombreAlta.value || '').toLocaleUpperCase('es-PE');
      const msg = $('#supervisor-alta-msg');
      if (msg) msg.hidden = true;
    });
    nombreAlta.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        registrarSupervisorNuevo();
      }
    });
  }
  if (btnAlta && !btnAlta.dataset.bound) {
    btnAlta.dataset.bound = '1';
    btnAlta.addEventListener('click', () => registrarSupervisorNuevo());
  }
}

const identificarDebounced = (() => {
  let t = 0;
  return () => {
    clearTimeout(t);
    t = setTimeout(() => identificar(), 450);
  };
})();

export function isModoEditar() {
  return modoEditar;
}

export function getSupervisorActual() {
  return actual ? { ...actual } : null;
}

/** Identifica supervisor y fuerza modo editar (sin consultar servidor). */
export function forzarSupervisorEditar(dni, { skipNotify = false } = {}) {
  const found = buscarPorDni(dni);
  if (!found) return null;
  lastQueryToken += 1;
  actual = found;
  modoEditar = true;
  const input = $('#supervisor-dni');
  if (input) {
    input.value = found.dni;
    input.readOnly = true;
  }
  setHidden(found.dni, found.nombre);
  setNombre(found.nombre);
  setEstado('Editando su conteo — solo su DNI', 'edit');
  syncSaveButton();
  if (!skipNotify) notify(null);
  return found;
}

export function desbloquearDniInput() {
  const input = $('#supervisor-dni');
  if (input) input.readOnly = false;
}

export async function identificar() {
  const input = $('#supervisor-dni');
  const dni = limpiarDni(input?.value);
  if (!input) return null;

  if (dni.length < 8) {
    setEstado('Ingrese su DNI (8 dígitos)', 'warn');
    limpiarIdentidad(false);
    setAltaVisible(false);
    return null;
  }

  const found = buscarPorDni(dni);
  if (!found) {
    actual = null;
    modoEditar = false;
    setHidden('', '');
    setNombre('');
    setEstado('DNI no está en la lista — puede registrarlo abajo', 'warn');
    setAltaVisible(true);
    notify();
    return null;
  }

  setAltaVisible(false);

  actual = found;
  setHidden(found.dni, found.nombre);
  setNombre(found.nombre);
  input.value = found.dni;

  const token = ++lastQueryToken;
  setEstado('Verificando si ya marcó…', 'info');

  let existente = null;
  if (isOnline()) {
    consultando = true;
    try {
      const resp = await consultarConteo({
        codSupervisor: found.dni,
        fecha: $('#fecha')?.value || todayStr()
      });
      if (token !== lastQueryToken) return actual;
      if (resp?.ok && resp.existe && resp.data) {
        existente = resp.data;
        modoEditar = true;
        setEstado('Ya marcó hoy — puede editar y guardar de nuevo', 'edit');
      } else {
        modoEditar = false;
        setEstado('Sin marcar hoy — complete y guarde su conteo', 'ok');
      }
    } catch {
      if (token !== lastQueryToken) return actual;
      modoEditar = false;
      setEstado('Sin verificar servidor — puede guardar igual', 'warn');
    } finally {
      consultando = false;
    }
  } else {
    modoEditar = false;
    setEstado('Sin internet — se validará al sincronizar', 'warn');
  }

  notify(existente);
  return actual;
}

export function aplicarSupervisor(dniOrNombre) {
  const dni = limpiarDni(dniOrNombre);
  const input = $('#supervisor-dni');
  if (dni.length >= 8) {
    if (input) input.value = dni;
    return identificar();
  }
  // borrador antiguo con solo nombre: no aplica
  resetSupervisor();
  return Promise.resolve(null);
}

export function resetSupervisor() {
  lastQueryToken += 1;
  actual = null;
  modoEditar = false;
  const input = $('#supervisor-dni');
  if (input) {
    input.value = '';
    input.readOnly = false;
  }
  setHidden('', '');
  setNombre('');
  setEstado('');
  setAltaVisible(false);
  notify();
}

function limpiarIdentidad(clearInput) {
  actual = null;
  modoEditar = false;
  if (clearInput) {
    const input = $('#supervisor-dni');
    if (input) input.value = '';
  }
  setHidden('', '');
  setNombre('');
  notify();
}

function setAltaVisible(show) {
  const box = $('#supervisor-alta');
  if (!box) return;
  box.hidden = !show;
  if (!show) {
    const input = $('#supervisor-alta-nombre');
    const msg = $('#supervisor-alta-msg');
    if (input) input.value = '';
    if (msg) {
      msg.hidden = true;
      msg.textContent = '';
    }
  } else {
    $('#supervisor-alta-nombre')?.focus();
  }
}

function setAltaMsg(text, type = 'error') {
  const el = $('#supervisor-alta-msg');
  if (!el) return;
  if (!text) {
    el.hidden = true;
    el.textContent = '';
    return;
  }
  el.hidden = false;
  el.textContent = text;
  el.className = `zona-nueva__msg zona-nueva__msg--${type}`;
}

export async function registrarSupervisorNuevo() {
  const dni = limpiarDni($('#supervisor-dni')?.value);
  const nombre = $('#supervisor-alta-nombre')?.value;
  const result = addCustomSupervisor(dni, nombre);
  if (!result.ok) {
    setAltaMsg(result.msg, 'error');
    toast(result.msg, 'error');
    return null;
  }
  setAltaMsg('Registrado en este celular', 'ok');
  toast('Supervisor registrado — complete su conteo', 'success');
  return identificar();
}

function setHidden(dni, nombre) {
  const cod = $('#codSupervisor');
  const sup = $('#supervisor');
  if (cod) cod.value = dni || '';
  // Solo el nombre: el DNI va en codSupervisor (columnas separadas en Sheet)
  if (sup) sup.value = nombre ? String(nombre).trim().toUpperCase() : '';
}

function setNombre(nombre) {
  const el = $('#supervisor-nombre');
  if (!el) return;
  if (!nombre) {
    el.hidden = true;
    el.textContent = '';
    return;
  }
  el.hidden = false;
  el.textContent = nombre;
}

function setEstado(msg, kind = '') {
  const el = $('#supervisor-estado');
  if (!el) return;
  if (!msg) {
    el.hidden = true;
    el.textContent = '';
    el.className = 'sup-estado';
    return;
  }
  el.hidden = false;
  el.textContent = msg;
  el.className = `sup-estado${kind ? ` sup-estado--${kind}` : ''}`;
}

function notify(existente = null) {
  syncSaveButton();
  if (!onChangeCb) return;
  onChangeCb({
    supervisor: actual,
    modoEditar,
    existente,
    consultando
  });
}

function syncSaveButton() {
  const btn = $('#btn-ver-resumen');
  if (!btn) return;
  btn.textContent = modoEditar ? 'Ver y actualizar' : 'Ver resumen';
}

export function openSupervisorSelect() {
  $('#supervisor-dni')?.focus();
  toast('Ingrese su DNI para identificarse', 'info');
}

export function closeSupervisorSelect() {}
