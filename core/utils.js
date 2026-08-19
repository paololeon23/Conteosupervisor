import { TZ } from './api-config.js';

export function todayStr() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
}

export function nowTimeStr() {
  return new Intl.DateTimeFormat('es-PE', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).format(new Date());
}

export function formatFechaLima(iso) {
  if (!iso) return '—';
  try {
    const [y, m, d] = iso.split('-');
    const meses = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
    return `${parseInt(d, 10)}-${meses[parseInt(m, 10) - 1]}`;
  } catch {
    return iso;
  }
}

export function formatHora(h) {
  if (!h) return '—';
  return h.slice(0, 5);
}

export function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function $(sel, root = document) {
  return root.querySelector(sel);
}

export function $$(sel, root = document) {
  return [...root.querySelectorAll(sel)];
}

export function toast(msg, type = 'info') {
  const el = $('#toast');
  if (!el) return;
  el.textContent = msg;
  el.className = `toast toast--${type} toast--show`;
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('toast--show'), 3200);
}

export function debounce(fn, ms = 300) {
  let t;
  const debounced = (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
  debounced.cancel = () => {
    clearTimeout(t);
  };
  return debounced;
}

let scrollLockCount = 0;
let savedScrollY = 0;

function getScrollRoot() {
  return document.querySelector('.app');
}

export function lockBodyScroll() {
  if (scrollLockCount === 0) {
    const root = getScrollRoot();
    savedScrollY = root ? root.scrollTop : window.scrollY;
    document.body.classList.add('modal-open');
  }
  scrollLockCount += 1;
}

export function unlockBodyScroll() {
  scrollLockCount = Math.max(0, scrollLockCount - 1);
  if (scrollLockCount === 0) {
    document.body.classList.remove('modal-open');
    const root = getScrollRoot();
    if (root) root.scrollTop = savedScrollY;
    else window.scrollTo(0, savedScrollY);
  }
}

/** Abre modal sin bloquear dos veces el scroll si ya estaba abierto */
export function openModalElement(modal) {
  if (!modal) return;
  const alreadyOpen = modal.classList.contains('modal--open');
  if (!alreadyOpen) {
    const trigger = document.activeElement;
    if (trigger && !modal.contains(trigger) && trigger.id) {
      modal.dataset.returnFocus = trigger.id;
    }
    lockBodyScroll();
  }
  modal.classList.add('modal--open');
  modal.setAttribute('aria-hidden', 'false');
}

export function resetBodyScrollLock() {
  scrollLockCount = 0;
  document.body.classList.remove('modal-open');
}

/** Cierra modal, devuelve foco y desbloquea scroll solo si estaba abierto */
export function closeModalElement(modal) {
  if (!modal?.classList.contains('modal--open')) return;

  const returnId = modal.dataset.returnFocus;
  const returnEl = returnId ? document.getElementById(returnId) : null;

  // Foco fuera del modal ANTES de aria-hidden (evita bloqueo y warnings)
  if (returnEl?.focus) {
    try { returnEl.focus({ preventScroll: true }); } catch { /* noop */ }
  } else if (modal.contains(document.activeElement)) {
    document.activeElement?.blur?.();
  }

  modal.classList.remove('modal--open');
  modal.setAttribute('aria-hidden', 'true');
  delete modal.dataset.returnFocus;

  try {
    unlockBodyScroll();
  } catch {
    resetBodyScrollLock();
  }
}

/** Cierra cualquier modal abierto y restaura scroll (red de seguridad) */
export function closeAllModals() {
  document.querySelectorAll('.modal.modal--open').forEach((modal) => {
    modal.classList.remove('modal--open');
    modal.setAttribute('aria-hidden', 'true');
    delete modal.dataset.returnFocus;
  });
  resetBodyScrollLock();
}
