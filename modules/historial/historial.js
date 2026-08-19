import { HISTORIAL_TTL_MS } from '../../core/api-config.js';
import { getHistorial, saveHistorial } from '../../core/offline-queue.js';
import { formatFechaLima, formatHora, $ } from '../../core/utils.js';
import { iconLabel } from '../../core/icons.js';

const PAGE_SIZE = 5;
let currentPage = 1;

export function initHistorial() {
  bindPagination();
  render();
  window.addEventListener('historial:update', render);
}

function bindPagination() {
  $('#hist-prev')?.addEventListener('click', () => {
    if (currentPage > 1) {
      currentPage -= 1;
      render();
    }
  });
  $('#hist-next')?.addEventListener('click', () => {
    const totalPages = Math.max(1, Math.ceil(getHistorial().length / PAGE_SIZE));
    if (currentPage < totalPages) {
      currentPage += 1;
      render();
    }
  });
}

export function render() {
  purgeOld();
  const list = getHistorial();
  const container = $('#historial-list');
  const empty = $('#historial-empty');
  const count = $('#historial-count');
  const pager = $('#historial-pager');

  if (!container) return;
  if (count) count.textContent = String(list.length);

  if (!list.length) {
    container.innerHTML = '';
    pager && (pager.hidden = true);
    empty?.classList.add('show');
    return;
  }

  empty?.classList.remove('show');

  const totalPages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
  if (currentPage > totalPages) currentPage = totalPages;
  if (currentPage < 1) currentPage = 1;

  const start = (currentPage - 1) * PAGE_SIZE;
  const pageItems = list.slice(start, start + PAGE_SIZE);

  container.innerHTML = pageItems.map(item => cardHtml(item)).join('');
  updatePager(list.length, totalPages);
}

function updatePager(total, totalPages) {
  const pager = $('#historial-pager');
  if (!pager) return;

  pager.hidden = totalPages <= 1;

  const info = $('#hist-page-info');
  const prev = $('#hist-prev');
  const next = $('#hist-next');

  if (info) {
    info.textContent = totalPages <= 1
      ? `${total} registro${total !== 1 ? 's' : ''}`
      : `Pág. ${currentPage} / ${totalPages}`;
  }
  if (prev) prev.disabled = currentPage <= 1;
  if (next) next.disabled = currentPage >= totalPages;
}

function cardHtml(item) {
  const synced = item.status === 'synced';
  const zonas = item.distribucionZonas || [];
  const zonasTxt = zonas
    .filter(z => z.cantidad > 0)
    .map(z => `${z.zona} (${z.cantidad})`)
    .join(' · ');

  const grupo = item.grupoLabel || `Grupo ${item.grupoCosecha}`;

  return `
    <article class="hist-card ${synced ? 'hist-card--synced' : 'hist-card--pending'}">
      <div class="hist-card__head">
        <span class="hist-card__status">${synced ? 'Enviado' : 'Pendiente'}</span>
        <time class="hist-card__time">${formatFechaLima(item.fecha)} · ${formatHora(item.horaRegistro)}</time>
      </div>
      <h3 class="hist-card__title">${grupo}</h3>
      <div class="hist-card__tags">
        <span class="hist-tag">Lote ${item.lote || '—'}</span>
        <span class="hist-tag">Mód. ${item.modulo}</span>
        <span class="hist-tag">T${item.turno}</span>
      </div>
      <p class="hist-card__supervisor">${item.supervisor}</p>
      <div class="hist-card__stats">
        ${iconLabel('users', String(item.totalPersonal), 'hist-stat')}
        ${iconLabel('utensils', String(item.almuerzos), 'hist-stat hist-stat--alm')}
        ${iconLabel('clipboard-list', String(item.permisos), 'hist-stat hist-stat--perm')}
        ${iconLabel('user-x', String(item.faltas), 'hist-stat hist-stat--falt')}
      </div>
      ${zonasTxt ? `<div class="hist-card__zonas"><span class="hist-card__zonas-label">Zonas</span><p>${zonasTxt}</p></div>` : ''}
    </article>`;
}

function purgeOld() {
  const now = Date.now();
  const list = getHistorial().filter(h => {
    if (h.status === 'pending') return true;
    if (h.syncedAt && now - h.syncedAt > HISTORIAL_TTL_MS) return false;
    return true;
  });
  saveHistorial(list);
}
