import { $, formatFechaLima, nowTimeStr, openModalElement, closeModalElement, resetBodyScrollLock } from './utils.js';
import { calcTotalPersonalFromPayload, calcTotalZonasFromList } from './totals.js';

/** @type {object|null} */
let pendingPayload = null;
/** @type {((payload: object) => Promise<{ synced: boolean }>)|null} */
let guardarHandler = null;
let guardando = false;
let comprobanteBound = false;

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/"/g, '&quot;');
}

function qtyCell(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v === 0) return '';
  return String(v);
}

function buildComprobanteHtml(data, mode) {
  const grupoNum = esc(data.grupoCosecha || '—');
  const supervisor = esc((data.supervisor || '—').toUpperCase());
  const fecha = esc(formatFechaLima(data.fecha));
  const modulo = esc(data.modulo || '—');
  const turno = esc(data.turno || '—');
  const hora = esc((data.horaRegistro || nowTimeStr()).slice(0, 5));
  const totalPersonal = String(calcTotalPersonalFromPayload(data));
  const totalZonas = String(calcTotalZonasFromList(data.distribucionZonas));

  const rolesRows = [
    ['COSECHADORES', data.cosechadores],
    ['ESCANER', data.escaner],
    ['CALIDAD', data.calidad],
    ['SUPERVISOR', data.supervisorCount]
  ].map(([label, val]) => `
    <tr>
      <td class="comp-td comp-td--label">${label}</td>
      <td class="comp-td comp-td--num">${qtyCell(val)}</td>
    </tr>
  `).join('');

  const zonas = Array.isArray(data.distribucionZonas) ? data.distribucionZonas : [];
  const zonasRows = zonas.map(z => `
    <tr>
      <td class="comp-td comp-td--label">${esc(z.zona)}</td>
      <td class="comp-td comp-td--num">${qtyCell(z.cantidad)}</td>
    </tr>
  `).join('');

  let statusClass = 'comp-status--preview';
  let statusLabel = 'Resumen — revise antes de guardar';
  if (mode === 'synced') {
    statusClass = 'comp-status--ok';
    statusLabel = 'Enviado';
  } else if (mode === 'pending') {
    statusClass = 'comp-status--pending';
    statusLabel = 'Pendiente de envío';
  }

  return `
    <div class="comp-brand">
      <img src="/assets/logo-qberries.png" alt="Q Berries" class="comp-brand__logo" width="96" height="30">
      <span class="comp-brand__site">Paiján · Conteo supervisor</span>
    </div>

    <div class="comp-status ${statusClass}">
      <span class="comp-status__dot" aria-hidden="true"></span>
      <span class="comp-status__text">${statusLabel}</span>
      <span class="comp-status__time">${fecha} · ${hora}</span>
    </div>

    <div class="comp-banner comp-banner--head">GRUPO ${grupoNum} · ${supervisor}</div>

    <table class="comp-table comp-table--meta" aria-label="Fecha módulo turno">
      <tbody>
        <tr>
          <td class="comp-meta__fecha">
            <span class="comp-meta__lbl">FECHA</span>
            <strong>${fecha}</strong>
          </td>
          <td class="comp-meta__mods">
            <div class="comp-meta__pill"><span>MÓD.</span> <strong>${modulo}</strong></div>
            <div class="comp-meta__pill"><span>TURNO</span> <strong>${turno}</strong></div>
          </td>
        </tr>
      </tbody>
    </table>

    <table class="comp-table comp-table--roles" aria-label="Personal por rol">
      <tbody>
        ${rolesRows}
        <tr class="comp-row--total">
          <td class="comp-td comp-td--label comp-td--bold">TOTAL</td>
          <td class="comp-td comp-td--num comp-td--bold">${totalPersonal}</td>
        </tr>
      </tbody>
    </table>

    <div class="comp-banner comp-banner--section">DISTRIBUCIÓN POR ZONAS</div>

    <table class="comp-table comp-table--zonas" aria-label="Distribución por zonas">
      <thead>
        <tr>
          <th class="comp-th">ZONA</th>
          <th class="comp-th comp-th--num">CANT.</th>
        </tr>
      </thead>
      <tbody>
        ${zonasRows}
        <tr class="comp-row--total">
          <td class="comp-td comp-td--label comp-td--bold">TOTAL</td>
          <td class="comp-td comp-td--num comp-td--bold">${totalZonas}</td>
        </tr>
      </tbody>
    </table>

    <table class="comp-table comp-table--resumen" aria-label="Almuerzos permisos faltas">
      <tbody>
        <tr>
          <td class="comp-res-cell comp-res--alm">
            <span class="comp-res-cell__lbl">ALM.</span>
            <strong>${qtyCell(data.almuerzos) || '—'}</strong>
          </td>
          <td class="comp-res-cell comp-res--perm">
            <span class="comp-res-cell__lbl">PERM.</span>
            <strong>${qtyCell(data.permisos) || '—'}</strong>
          </td>
          <td class="comp-res-cell comp-res--falt">
            <span class="comp-res-cell__lbl">FALT.</span>
            <strong>${qtyCell(data.faltas) || '—'}</strong>
          </td>
        </tr>
      </tbody>
    </table>

    <p class="comp-footer-note">Q Berries · Comprobante</p>
  `;
}

const BTN_GUARDAR_LABEL = 'Guardar conteo';
const BTN_GUARDANDO_LABEL = 'Guardando, espere por favor';

function setGuardarButtonLoading(loading) {
  const btn = $('#comprobante-guardar');
  const back = $('#comprobante-back');
  if (btn) {
    btn.disabled = loading;
    btn.textContent = loading ? BTN_GUARDANDO_LABEL : BTN_GUARDAR_LABEL;
    btn.setAttribute('aria-busy', loading ? 'true' : 'false');
  }
  if (back) back.disabled = loading;
}

function setFootMode(mode) {
  const preview = $('#comprobante-foot-preview');
  const done = $('#comprobante-foot-done');
  const hintPreview = $('#comprobante-hint-preview');
  const hintDone = $('#comprobante-hint-done');

  if (preview) preview.hidden = mode !== 'preview';
  if (done) done.hidden = mode !== 'done';
  if (hintPreview) hintPreview.hidden = mode !== 'preview';
  if (hintDone) hintDone.hidden = mode !== 'done';
}

function renderSheet(data, mode) {
  const root = $('#comprobante-root');
  if (root) root.innerHTML = buildComprobanteHtml(data, mode);
}

function openModal() {
  openModalElement($('#comprobante-modal'));
}

/** Abre resumen para revisar — aún no guarda */
export function openComprobantePreview(data) {
  pendingPayload = { ...data };
  renderSheet(data, 'preview');
  setFootMode('preview');
  setGuardarButtonLoading(false);
  openModal();
}

/** Tras guardar — comprobante final */
export function openComprobante(data, { synced = false } = {}) {
  pendingPayload = null;
  renderSheet(data, synced ? 'synced' : 'pending');
  setFootMode('done');
  openModal();
}

export function closeComprobante() {
  try {
    closeModalElement($('#comprobante-modal'));
  } catch {
    resetBodyScrollLock();
    const modal = $('#comprobante-modal');
    modal?.classList.remove('modal--open');
    modal?.setAttribute('aria-hidden', 'true');
  }
  pendingPayload = null;
}

async function onGuardarClick() {
  if (guardando || !pendingPayload || !guardarHandler) return;

  const payload = pendingPayload;
  pendingPayload = null;
  guardando = true;
  setGuardarButtonLoading(true);

  try {
    const result = await guardarHandler({ ...payload });
    if (result?.saved && result.payload) {
      openComprobante(result.payload, { synced: result.synced });
    } else {
      pendingPayload = payload;
    }
  } catch {
    pendingPayload = payload;
  } finally {
    guardando = false;
    setGuardarButtonLoading(false);
  }
}

export function initComprobante({ onGuardar } = {}) {
  guardarHandler = typeof onGuardar === 'function' ? onGuardar : null;
  if (comprobanteBound) return;
  comprobanteBound = true;
  $('#comprobante-back')?.addEventListener('click', closeComprobante);
  $('#comprobante-guardar')?.addEventListener('click', onGuardarClick);
  $('#comprobante-close')?.addEventListener('click', closeComprobante);
  $('#comprobante-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'comprobante-modal') closeComprobante();
  });

  setFootMode('preview');
}
