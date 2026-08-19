import { getAllZonas, normalizarZona, addCustomZona, validarZona, zonaExiste } from './zonas-catalog.js';
import { $, openModalElement, closeModalElement, toast } from './utils.js';

let onSelectCb = null;
let excluir = new Set();
let queryActual = '';

const SVG_X = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';

export function openZonaSelect(onSelect, yaAgregadas = []) {
  onSelectCb = onSelect;
  excluir = new Set(yaAgregadas.map(normalizarZona));
  queryActual = '';

  const modal = $('#zona-modal');
  const search = $('#zona-search');
  const addInput = $('#zona-add-input');
  if (!modal || !search) return;

  search.value = '';
  if (addInput) addInput.value = '';
  ocultarHintAgregar();
  openModalElement(modal);
  renderLista('');
  setTimeout(() => search.focus(), 120);
}

export function closeZonaSelect() {
  closeModalElement($('#zona-modal'));
  onSelectCb = null;
  queryActual = '';
  ocultarHintAgregar();
}

export function initZonaSelect() {
  $('#zona-search')?.addEventListener('input', (e) => {
    renderLista(e.target.value);
    syncAddInputDesdeBusqueda(e.target.value);
  });
  $('#zona-add-input')?.addEventListener('input', onAddInputChange);
  $('#zona-add-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); onAgregarNueva(); }
  });
  $('#zona-close')?.addEventListener('click', closeZonaSelect);
  $('#zona-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'zona-modal') closeZonaSelect();
  });
  $('#zona-add-btn')?.addEventListener('click', onAgregarNueva);
}

function syncAddInputDesdeBusqueda(query) {
  const addInput = $('#zona-add-input');
  if (!addInput || document.activeElement === addInput) return;
  const q = String(query || '').trim();
  if (q) addInput.value = q.toUpperCase();
  updateAddHint(addInput?.value || q);
}

function onAddInputChange() {
  updateAddHint($('#zona-add-input')?.value || '');
}

function onAgregarNueva() {
  const addInput = $('#zona-add-input');
  const raw = addInput?.value?.trim() || queryActual.trim();
  const val = validarZona(raw);

  if (!val.ok) {
    showAddHint(val.msg, 'error');
    toast(val.msg, 'error');
    return;
  }
  if (excluir.has(val.nombre)) {
    showAddHint('Ya agregada al conteo', 'warn');
    toast('Esa zona ya está agregada', 'warn');
    return;
  }
  if (zonaExiste(val.nombre)) {
    showAddHint('Selecciónela de la lista', 'warn');
    toast('Esa zona ya existe — búsquela arriba', 'info');
    return;
  }

  addCustomZona(val.nombre);
  if (onSelectCb) {
    onSelectCb(val.nombre);
    closeZonaSelect();
  }
}

function renderLista(query) {
  queryActual = query;
  const list = $('#zona-list');
  if (!list) return;

  const q = normalizarZona(query);
  const resultados = getAllZonas()
    .filter(z => !excluir.has(z))
    .filter(z => !q || z.includes(q));

  if (!resultados.length) {
    list.innerHTML = `<p class="zona-empty">${q ? 'Sin resultados — agréguela abajo' : 'Escriba para buscar'}</p>`;
  } else {
    list.innerHTML = resultados.map(zona => `
      <button type="button" class="zona-pick" data-zona="${esc(zona)}">
        <span class="zona-pick__name">${esc(zona)}</span>
        <span class="zona-pick__area">PRODUCCION - COSECHA</span>
      </button>
    `).join('');

    list.querySelectorAll('.zona-pick').forEach(btn => {
      btn.addEventListener('click', () => {
        const zona = btn.dataset.zona;
        if (zona && onSelectCb) {
          onSelectCb(zona);
          closeZonaSelect();
        }
      });
    });
  }

  updateAddHint($('#zona-add-input')?.value || query);
}

function updateAddHint(raw) {
  const q = String(raw || '').trim();
  if (!q) {
    ocultarHintAgregar();
    return;
  }
  const val = validarZona(q);
  if (!val.ok) {
    showAddHint(val.msg, 'error');
    return;
  }
  if (excluir.has(val.nombre)) {
    showAddHint('Ya agregada al conteo', 'warn');
    return;
  }
  if (zonaExiste(val.nombre)) {
    showAddHint('Selecciónela de la lista', 'warn');
    return;
  }
  showAddHint('Enter o Agregar para guardar', 'ok');
}

function showAddHint(text, type) {
  const hint = $('#zona-add-hint');
  if (!hint) return;
  hint.hidden = false;
  hint.textContent = text;
  hint.className = `zona-add-hint zona-add-hint--${type}`;
}

function ocultarHintAgregar() {
  const hint = $('#zona-add-hint');
  if (hint) hint.hidden = true;
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
}

export { SVG_X };
