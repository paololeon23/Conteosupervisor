import { $, todayStr, openModalElement, closeModalElement } from './utils.js';

const MESES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
];

let viewYear = 0;
let viewMonth = 0;
let onChangeCb = null;

function parseIso(iso) {
  const [y, m, d] = String(iso || '').split('-').map(n => parseInt(n, 10));
  if (!y || !m || !d) return null;
  return { y, m: m - 1, d };
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

  input.value = iso || '';
  const text = iso ? formatFechaDisplay(iso) : 'Elegir fecha';
  if (label) label.textContent = text;
  if (btn) btn.classList.toggle('btn--pick-filled', Boolean(iso));

  if (!silent && onChangeCb) onChangeCb(iso);
}

function syncViewToSelection() {
  const iso = getFecha() || todayStr();
  const p = parseIso(iso) || parseIso(todayStr());
  viewYear = p.y;
  viewMonth = p.m;
}

function renderCalendar() {
  const grid = $('#fecha-grid');
  const title = $('#fecha-month-label');
  if (!grid || !title) return;

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
  syncViewToSelection();
  renderCalendar();
  openModalElement($('#fecha-modal'));
}

export function closeDatePicker() {
  closeModalElement($('#fecha-modal'));
}

export function initDatePicker(onChange) {
  onChangeCb = onChange;

  $('#btn-pick-fecha')?.addEventListener('click', openDatePicker);

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

  const btn = $('#btn-pick-fecha');
  if (getFecha()) {
    $('#fecha-label') && ($('#fecha-label').textContent = formatFechaDisplay(getFecha()));
    btn?.classList.add('btn--pick-filled');
  }
}
