import { getGrupos, filtrarGrupos, numeroGrupo } from './licapa-data.js';
import { $, openModalElement, closeModalElement } from './utils.js';

let grupos = [];
let onSelectCb = null;

export async function initGrupoSelect() {
  grupos = await getGrupos();
  $('#grupo-search')?.addEventListener('input', (e) => renderLista(e.target.value));
  $('#grupo-close')?.addEventListener('click', closeGrupoSelect);
  $('#grupo-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'grupo-modal') closeGrupoSelect();
  });
}

export function openGrupoSelect(onSelect) {
  onSelectCb = onSelect;
  const modal = $('#grupo-modal');
  const input = $('#grupo-search');
  if (!modal || !input) return;
  input.value = '';
  openModalElement(modal);
  renderLista('');
  setTimeout(() => input.focus(), 120);
}

export function closeGrupoSelect() {
  closeModalElement($('#grupo-modal'));
  onSelectCb = null;
}

function renderLista(query) {
  const list = $('#grupo-list');
  if (!list) return;

  const resultados = filtrarGrupos(query, grupos);

  if (!resultados.length) {
    list.innerHTML = `<p class="zona-empty">${query ? 'Sin grupos' : 'Sin grupos disponibles'}</p>`;
    return;
  }

  list.innerHTML = resultados.map(g => `
    <button type="button" class="zona-pick" data-grupo="${esc(g)}">
      <span class="zona-pick__name">${esc(g)}</span>
    </button>
  `).join('');

  list.querySelectorAll('.zona-pick').forEach(btn => {
    btn.addEventListener('click', () => {
      const label = btn.dataset.grupo;
      if (label && onSelectCb) {
        onSelectCb(label);
        closeGrupoSelect();
      }
    });
  });
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
}

export function resetGrupo() {
  if ($('#grupo')) $('#grupo').value = '';
  if ($('#grupo-label')) $('#grupo-label').value = '';
  const btnLabel = $('#grupo-btn-label');
  const btn = $('#btn-pick-grupo');
  if (btnLabel) btnLabel.textContent = 'Elegir grupo';
  if (btn) btn.classList.remove('btn--pick-filled');
}

export function aplicarGrupo(label) {
  if ($('#grupo')) $('#grupo').value = numeroGrupo(label);
  if ($('#grupo-label')) $('#grupo-label').value = label;

  const btnLabel = $('#grupo-btn-label');
  const btn = $('#btn-pick-grupo');
  if (btnLabel) btnLabel.textContent = label;
  if (btn) btn.classList.add('btn--pick-filled');
}
