import { getLotes, filtrarLotes, numeroModulo } from './licapa-data.js';
import { $, openModalElement, closeModalElement } from './utils.js';

let lotes = [];
let onSelectCb = null;

export async function initLoteSelect() {
  lotes = await getLotes();
  $('#lote-search')?.addEventListener('input', (e) => renderLista(e.target.value));
  $('#lote-close')?.addEventListener('click', closeLoteSelect);
  $('#lote-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'lote-modal') closeLoteSelect();
  });
}

export function openLoteSelect(onSelect) {
  onSelectCb = onSelect;
  const modal = $('#lote-modal');
  const input = $('#lote-search');
  if (!modal || !input) return;
  input.value = '';
  openModalElement(modal);
  renderLista('');
  setTimeout(() => input.focus(), 120);
}

export function closeLoteSelect() {
  closeModalElement($('#lote-modal'));
  onSelectCb = null;
}

function renderLista(query) {
  const list = $('#lote-list');
  if (!list) return;

  const resultados = filtrarLotes(query, lotes);

  if (!resultados.length) {
    list.innerHTML = `<p class="zona-empty">${query ? 'Sin lotes' : 'Escriba para buscar'}</p>`;
    return;
  }

  list.innerHTML = resultados.map(item => `
    <button type="button" class="zona-pick" data-lote="${esc(item.lote)}">
      <span class="zona-pick__name">Lote ${esc(item.lote)}</span>
      <span class="zona-pick__area">${esc(item.modulo)} · T${esc(item.turno)} · ${esc(item.variedad)}</span>
    </button>
  `).join('');

  list.querySelectorAll('.zona-pick').forEach(btn => {
    btn.addEventListener('click', () => {
      const lote = lotes.find(x => x.lote === btn.dataset.lote);
      if (lote && onSelectCb) {
        onSelectCb(lote);
        closeLoteSelect();
      }
    });
  });
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
}

export function resetLote() {
  ['lote', 'codLote', 'variedad', 'modulo', 'turno'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  const prev = $('#lote-preview');
  if (prev) {
    prev.hidden = true;
    prev.textContent = '';
  }
}

export function aplicarLote(item) {
  if ($('#lote')) $('#lote').value = item.lote;
  if ($('#codLote')) $('#codLote').value = item.codLote || '';
  if ($('#variedad')) $('#variedad').value = item.variedad || '';
  if ($('#modulo')) $('#modulo').value = numeroModulo(item.modulo);
  if ($('#turno')) $('#turno').value = item.turno;

  const prev = $('#lote-preview');
  if (prev) {
    prev.hidden = false;
    prev.textContent = `Lote ${item.lote} · ${item.modulo} · Turno ${item.turno} · ${item.variedad}`;
  }
}
