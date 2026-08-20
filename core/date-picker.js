import { $, todayStr, openModalElement, closeModalElement } from './utils.js';

const MESES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
];

let viewYear = 0;
let viewMonth = 0;
let onChangeCb = null;
let datePickerInited = false;

function parseIso(iso) {
  const raw = String(iso || '').trim();
  if (!raw) return null;

  const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    const y = parseInt(isoMatch[1], 10);
    const m = parseInt(isoMatch[2], 10);
    const d = parseInt(isoMatch[3], 10);
    if (y >= 2000 && m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return { y, m: m - 1, d };
    }
  }

  const displayMatch = raw.match(/^(\d{1,2})-([a-záéíóúñ]+)-(\d{4})$/i);
  if (displayMatch) {
    const d = parseInt(displayMatch[1], 10);
    const mesNombre = displayMatch[2].toLowerCase();
    const y = parseInt(displayMatch[3], 10);
    const mi = MESES.findIndex(m => m.toLowerCase() === mesNombre);
    if (mi >= 0 && d >= 1 && d <= 31 && y >= 2000) {
      return { y, m: mi, d };
    }
  }

  return null;
}

function todayParts() {
  const p = parseIso(todayStr());
  if (p) return p;
  const now = new Date();
  return { y: now.getFullYear(), m: now.getMonth(), d: now.getDate() };
}

function toIso(y, m, d) {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function formatFechaDisplay(iso) {
  const p = parseIso(iso);
  if (!p) return 'Elegir fecha';
  return `${p.d}-${MESES[p.m].toLowerCase()}-${p.y}`;
}

export function getFecha() {
  return $('#fecha')?.value || '';
}

export function setFecha(iso, { silent = false } = {}) {
  const input = $('#fecha');
  const label = $('#fecha-label');
  const btn = $('#btn-pick-fecha');
  if (!input) return;

  const p = parseIso(iso);
  const safeIso = p ? toIso(p.y, p.m, p.d) : '';
  input.value = safeIso;
  const text = safeIso ? formatFechaDisplay(safeIso) : 'Elegir fecha';
  if (label) label.textContent = text;
  if (btn) btn.classList.toggle('btn--pick-filled', Boolean(safeIso));

  if (!silent && onChangeCb && safeIso) onChangeCb(safeIso);
}

function syncViewToSelection() {
  const iso = getFecha() || todayStr();
  const p = parseIso(iso) || todayParts();
  viewYear = p.y;
  viewMonth = p.m;
}

function renderCalendar() {
  const grid = $('#fecha-grid');
  const title = $('#fecha-month-label');
  if (!grid || !title) return;

  if (!viewYear || viewMonth < 0 || viewMonth > 11) {
    syncViewToSelection();
  }

  title.textContent = `${MESES[viewMonth]} ${viewYear}`;

  const first = new Date(viewYear, viewMonth, 1);
  const startDow = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const daysPrev = new Date(viewYear, viewMonth, 0).getDate();

  const selected = getFecha();
  const hoy = todayStr();

  let html = '';
  let day = 1;
  let nextDay = 1;

  for (let i = 0; i < 42; i++) {
    let y = viewYear;
    let m = viewMonth;
    let d;
    let outside = false;

    if (i < startDow) {
      d = daysPrev - startDow + i + 1;
      m = viewMonth - 1;
      outside = true;
      if (m < 0) { m = 11; y -= 1; }
    } else if (day <= daysInMonth) {
      d = day++;
    } else {
      d = nextDay++;
      m = viewMonth + 1;
      outside = true;
      if (m > 11) { m = 0; y += 1; }
    }

    const iso = toIso(y, m, d);
    const isSelected = iso === selected;
    const isToday = iso === hoy;
    const cls = [
      'date-cell',
      outside ? 'date-cell--outside' : '',
      isSelected ? 'date-cell--selected' : '',
      isToday && !isSelected ? 'date-cell--today' : ''
    ].filter(Boolean).join(' ');

    html += `<button type="button" class="${cls}" data-iso="${iso}" aria-label="${d} ${MESES[m]} ${y}">${d}</button>`;
  }

  grid.innerHTML = html;

  grid.querySelectorAll('.date-cell').forEach(btn => {
    btn.addEventListener('click', () => {
      setFecha(btn.dataset.iso);
      closeDatePicker();
    });
  });
}

export function openDatePicker() {
  const modal = $('#fecha-modal');
  if (!modal) return;

  syncViewToSelection();
  renderCalendar();
  openModalElement(modal);
}

export function closeDatePicker() {
  closeModalElement($('#fecha-modal'));
}

function bindModalControls() {
  $('#fecha-close')?.addEventListener('click', closeDatePicker);
  $('#fecha-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'fecha-modal') closeDatePicker();
  });

  $('#fecha-prev')?.addEventListener('click', () => {
    viewMonth -= 1;
    if (viewMonth < 0) { viewMonth = 11; viewYear -= 1; }
    renderCalendar();
  });

  $('#fecha-next')?.addEventListener('click', () => {
    viewMonth += 1;
    if (viewMonth > 11) { viewMonth = 0; viewYear += 1; }
    renderCalendar();
  });

  $('#fecha-today')?.addEventListener('click', () => {
    setFecha(todayStr());
    closeDatePicker();
  });

  $('#fecha-clear')?.addEventListener('click', () => {
    setFecha('');
    closeDatePicker();
  });
}

export function initDatePicker(onChange) {
  onChangeCb = onChange;
  if (datePickerInited) return;
  datePickerInited = true;

  bindModalControls();
  syncViewToSelection();

  const btn = $('#btn-pick-fecha');
  if (getFecha()) {
    $('#fecha-label') && ($('#fecha-label').textContent = formatFechaDisplay(getFecha()));
    btn?.classList.add('btn--pick-filled');
  } else {
    setFecha(todayStr(), { silent: true });
  }
}
