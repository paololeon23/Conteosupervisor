import { obtenerDashboard } from '../../core/api.js';
import { isOnline } from '../../core/network.js';
import { STORAGE_KEYS } from '../../core/api-config.js';
import { todayStr, toast, $, formatFechaLima, openModalElement, closeModalElement } from '../../core/utils.js';
import { initSupResumen, openSupResumenList } from '../../core/sup-resumen.js';

let bound = false;
let loading = false;
/** @type {'hoy'|'all'} */
let modoFecha = 'hoy';
/** @type {object|null} */
let lastData = null;

const ROLE_COLORS = {
  cosechadores: '#52AD4B',
  escaner: '#3B82F6',
  calidad: '#F7941E',
  supervisorCount: '#D61F26'
};

function dashStorageKey(modo) {
  return `${STORAGE_KEYS.DASHBOARD}_${modo}`;
}

function readLocalDash(modo) {
  try {
    const raw = localStorage.getItem(dashStorageKey(modo));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.data?.ok) return parsed;
  } catch { /* ok */ }
  return null;
}

function writeLocalDash(modo, data) {
  try {
    localStorage.setItem(dashStorageKey(modo), JSON.stringify({
      savedAt: Date.now(),
      data
    }));
  } catch { /* quota */ }
}

function applyData(resp, statusLabel) {
  lastData = resp;
  render(resp);
  bindChartClicks();
  const status = $('#data-status');
  if (status) {
    const fechaTxt = resp.fecha === 'all'
      ? 'Todas las fechas'
      : (formatFechaLima(resp.fecha) || resp.fecha);
    status.textContent = statusLabel ? `${fechaTxt} · ${statusLabel}` : fechaTxt;
  }
}

export function initData() {
  if (bound) {
    cargar(false);
    return;
  }
  bound = true;
  initSupResumen();

  $('#btn-data-hoy')?.addEventListener('click', () => {
    modoFecha = 'hoy';
    syncFiltroUI();
    cargar(false);
  });
  $('#btn-data-all')?.addEventListener('click', () => {
    modoFecha = 'all';
    syncFiltroUI();
    cargar(false);
  });
  // Solo el botón refresh pide al servidor
  $('#btn-data-refresh')?.addEventListener('click', () => cargar(true));

  $('#data-detail-close')?.addEventListener('click', closeDetail);
  $('#data-detail-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'data-detail-modal') closeDetail();
  });
  $('#btn-ver-resumen-data')?.addEventListener('click', () => {
    if (!lastData) {
      toast('Espere a que carguen los datos', 'warn');
      return;
    }
    openResumenGraficos(lastData);
  });

  syncFiltroUI();
  cargar(false);
}

function syncFiltroUI() {
  $('#btn-data-hoy')?.classList.toggle('is-active', modoFecha === 'hoy');
  $('#btn-data-all')?.classList.toggle('is-active', modoFecha === 'all');
}

function closeDetail() {
  closeModalElement($('#data-detail-modal'));
}

function openDetail(title, html) {
  const titleEl = $('#data-detail-title');
  const body = $('#data-detail-body');
  if (titleEl) titleEl.textContent = title;
  if (body) body.innerHTML = html;
  openModalElement($('#data-detail-modal'));
}

/**
 * @param {boolean} force true = pedir al servidor (botón refresh)
 */
async function cargar(force) {
  if (loading) return;
  const root = $('#data-root');
  if (!root) return;

  const cached = readLocalDash(modoFecha);

  // Sin forzar: usar caché local (rápido, para analizar)
  if (!force && cached?.data) {
    applyData(cached.data, 'cache');
    return;
  }

  if (!isOnline()) {
    if (cached?.data) {
      applyData(cached.data, 'offline');
      toast('Sin internet — mostrando última data guardada', 'info');
      return;
    }
    lastData = null;
    root.innerHTML = `
      <div class="data-empty">
        <p class="data-empty__title">Sin internet</p>
        <p class="data-empty__hint">Conéctese y toque actualizar</p>
      </div>`;
    const status = $('#data-status');
    if (status) status.textContent = 'Offline';
    return;
  }

  loading = true;
  const status = $('#data-status');
  if (status) status.textContent = 'Actualizando…';
  if (!cached?.data) {
    root.innerHTML = `<div class="data-loading"><span class="data-spinner"></span>Cargando dashboard…</div>`;
  }

  try {
    const fecha = modoFecha === 'all' ? 'all' : todayStr();
    const resp = await obtenerDashboard(fecha);
    if (!resp?.ok) throw new Error(resp?.message || 'No se pudo cargar');
    writeLocalDash(modoFecha, resp);
    applyData(resp, resp.fromCache ? 'servidor·cache' : 'servidor');
    if (force) toast('Datos actualizados del servidor', 'success');
  } catch (err) {
    if (cached?.data) {
      applyData(cached.data, 'cache');
      toast('No se pudo actualizar — mostrando cache', 'warn');
    } else {
      lastData = null;
      root.innerHTML = `
        <div class="data-empty">
          <p class="data-empty__title">No se pudo cargar</p>
          <p class="data-empty__hint">${esc(err.message || 'Error de red')}</p>
          <button type="button" class="btn btn--zona" id="btn-data-retry">Reintentar</button>
        </div>`;
      $('#btn-data-retry')?.addEventListener('click', () => cargar(true));
      if (status) status.textContent = 'Error';
    }
  } finally {
    loading = false;
  }
}

function render(data) {
  const root = $('#data-root');
  if (!root) return;

  const t = data.totales || {};
  const supervisores = Array.isArray(data.supervisores) ? data.supervisores : [];
  const zonas = Array.isArray(data.zonas) ? data.zonas : [];
  const maxZona = Math.max(1, ...zonas.map(z => z.cantidad || 0));
  const maxCos = Math.max(1, ...supervisores.map(s => s.cosechadores || 0));
  const rolesTotal = (t.cosechadores || 0) + (t.escaner || 0) + (t.calidad || 0) + (t.supervisorCount || 0);

  root.innerHTML = `
    <p class="data-hint-tap">Toque una tarjeta o gráfico para ver el detalle</p>

    <div class="data-kpis">
      <button type="button" class="data-kpi data-kpi--red" data-open="supervisores">
        <span class="data-kpi__label">Supervisores</span>
        <strong class="data-kpi__val">${t.supervisoresUnicos || 0}</strong>
        <span class="data-kpi__sub">${t.conteos || 0} conteos · ver</span>
      </button>
      <button type="button" class="data-kpi data-kpi--green" data-open="cosechadores">
        <span class="data-kpi__label">Cosechadores</span>
        <strong class="data-kpi__val">${t.cosechadores || 0}</strong>
        <span class="data-kpi__sub">columna K · ver</span>
      </button>
      <button type="button" class="data-kpi data-kpi--blue" data-open="roles">
        <span class="data-kpi__label">Escáner</span>
        <strong class="data-kpi__val">${t.escaner || 0}</strong>
        <span class="data-kpi__sub">ver roles</span>
      </button>
      <button type="button" class="data-kpi data-kpi--amber" data-open="roles">
        <span class="data-kpi__label">Calidad</span>
        <strong class="data-kpi__val">${t.calidad || 0}</strong>
        <span class="data-kpi__sub">ver roles</span>
      </button>
    </div>

    <button type="button" class="data-total-banner" data-open="totales">
      <div>
        <p class="data-total-banner__label">Total personal</p>
        <p class="data-total-banner__hint">Toque para ver resumen completo</p>
      </div>
      <strong class="data-total-banner__val">${t.total || rolesTotal}</strong>
    </button>

    <section class="data-card data-card--tap" data-open="roles">
      <div class="data-card__head">
        <h3 class="data-card__title">Distribución por rol</h3>
        <span class="data-card__action">Ampliar</span>
      </div>
      <div class="data-chart-row">
        <div class="data-columns" aria-hidden="true">
          ${columnChart(t, rolesTotal)}
        </div>
        <div class="data-donut-wrap">
          ${donutSvg(t, 140)}
        </div>
      </div>
    </section>

    <section class="data-card data-card--tap" data-open="supervisores">
      <div class="data-card__head">
        <h3 class="data-card__title">Ranking supervisores</h3>
        <span class="data-card__action">Ver todos</span>
      </div>
      ${supervisores.length ? `
        <div class="data-rank-chart" aria-hidden="true">
          ${supervisores.slice(0, 6).map((s, i) => `
            <div class="data-rank-row">
              <span class="data-rank-row__n">${i + 1}</span>
              <div class="data-rank-row__body">
                <div class="data-rank-row__top">
                  <span>${esc(shortName(s.supervisor))}</span>
                  <strong>${s.cosechadores}</strong>
                </div>
                <div class="data-bar data-bar--lg">
                  <div class="data-bar__fill data-bar__fill--green" style="width:${pct(s.cosechadores, maxCos)}%"></div>
                </div>
              </div>
            </div>
          `).join('')}
        </div>
      ` : `<p class="data-empty__hint">Sin datos de supervisores</p>`}
    </section>

    <section class="data-card data-card--tap" data-open="zonas">
      <div class="data-card__head">
        <h3 class="data-card__title">Personas por zona</h3>
        <span class="data-card__action">Ampliar</span>
      </div>
      ${zonas.length ? `
        <div class="data-zona-bars" aria-hidden="true">
          ${zonas.slice(0, 8).map(z => `
            <div class="data-zona-col">
              <div class="data-zona-col__bar-wrap">
                <div class="data-zona-col__bar" style="height:${pct(z.cantidad, maxZona)}%">
                  <span>${z.cantidad}</span>
                </div>
              </div>
              <span class="data-zona-col__label">${esc(shortZona(z.zona))}</span>
            </div>
          `).join('')}
        </div>
      ` : `<p class="data-empty__hint">Sin datos de zonas</p>`}
    </section>

    <div class="data-foot-totals">
      <button type="button" data-open="totales"><span>Supervisores</span><strong>${t.supervisoresUnicos || 0}</strong></button>
      <button type="button" data-open="cosechadores"><span>Cosechadores</span><strong>${t.cosechadores || 0}</strong></button>
      <button type="button" data-open="roles"><span>Escáner</span><strong>${t.escaner || 0}</strong></button>
      <button type="button" data-open="roles"><span>Calidad</span><strong>${t.calidad || 0}</strong></button>
      <button type="button" class="data-foot-totals__grand" data-open="totales"><span>Total junto</span><strong>${t.total || rolesTotal}</strong></button>
    </div>
  `;
}

function bindChartClicks() {
  document.querySelectorAll('#data-root [data-open]').forEach((el) => {
    el.addEventListener('click', () => {
      const kind = el.getAttribute('data-open');
      if (!lastData || !kind) return;
      showModalFor(kind);
    });
  });
}

/** Modal principal: gráficos del resumen + opción de compartir imagen */
function openResumenGraficos(data) {
  const t = data.totales || {};
  const supervisores = data.supervisores || [];
  const zonas = data.zonas || [];
  const rolesTotal = (t.cosechadores || 0) + (t.escaner || 0) + (t.calidad || 0) + (t.supervisorCount || 0);
  const maxCos = Math.max(1, ...supervisores.map(s => s.cosechadores || 0));
  const maxZona = Math.max(1, ...zonas.map(z => z.cantidad || 0));
  const fechaLabel = data.fecha === 'all'
    ? 'Todas las fechas'
    : (formatFechaLima(data.fecha) || data.fecha || todayStr());

  openDetail('Ver resumen', `
    <p class="dd-fecha-chip">${esc(fechaLabel)}</p>

    <div class="dd-stat-grid" style="margin-bottom:12px">
      <div class="dd-stat dd-stat--red"><span>Supervisores</span><strong>${t.supervisoresUnicos || 0}</strong></div>
      <div class="dd-stat dd-stat--green"><span>Cosechadores</span><strong>${t.cosechadores || 0}</strong></div>
      <div class="dd-stat dd-stat--blue"><span>Escáner</span><strong>${t.escaner || 0}</strong></div>
      <div class="dd-stat dd-stat--amber"><span>Calidad</span><strong>${t.calidad || 0}</strong></div>
      <div class="dd-stat dd-stat--grand"><span>Total junto</span><strong>${t.total || rolesTotal}</strong></div>
    </div>

    <h4 class="dd-section-title">Por rol</h4>
    <div class="dd-hero">${donutSvg(t, 150)}</div>
    <div class="dd-columns">${columnChart(t, rolesTotal, true)}</div>

    <h4 class="dd-section-title">Ranking supervisores</h4>
    ${supervisores.length ? `
      <div class="data-rank-chart" style="margin-bottom:12px">
        ${supervisores.slice(0, 8).map((s, i) => `
          <div class="data-rank-row">
            <span class="data-rank-row__n">${i + 1}</span>
            <div class="data-rank-row__body">
              <div class="data-rank-row__top">
                <span>${esc(shortName(s.supervisor))}</span>
                <strong>${s.cosechadores}</strong>
              </div>
              <div class="data-bar data-bar--lg">
                <div class="data-bar__fill data-bar__fill--green" style="width:${pct(s.cosechadores, maxCos)}%"></div>
              </div>
            </div>
          </div>
        `).join('')}
      </div>
    ` : `<p class="data-empty__hint">Sin supervisores</p>`}

    <h4 class="dd-section-title">Por zona</h4>
    ${zonas.length ? `
      <div class="dd-zona-chart" style="margin-bottom:14px">
        ${zonas.slice(0, 10).map(z => `
          <div class="dd-zona-row">
            <span class="dd-zona-row__name">${esc(z.zona)}</span>
            <div class="data-bar data-bar--lg">
              <div class="data-bar__fill data-bar__fill--berry" style="width:${pct(z.cantidad, maxZona)}%"></div>
            </div>
            <strong>${z.cantidad}</strong>
          </div>
        `).join('')}
      </div>
    ` : `<p class="data-empty__hint">Sin zonas</p>`}

    <button type="button" id="btn-compartir-imgs-sup" class="btn btn--zona-nueva" style="width:100%">
      Compartir imagen por supervisor
    </button>
  `);

  setTimeout(() => {
    $('#btn-compartir-imgs-sup')?.addEventListener('click', () => {
      closeDetail();
      openSupResumenList(data);
    });
  }, 0);
}

function showModalFor(kind) {
  const t = lastData.totales || {};
  const supervisores = lastData.supervisores || [];
  const zonas = lastData.zonas || [];
  const rolesTotal = (t.cosechadores || 0) + (t.escaner || 0) + (t.calidad || 0) + (t.supervisorCount || 0);
  const maxCos = Math.max(1, ...supervisores.map(s => s.cosechadores || 0));
  const maxZona = Math.max(1, ...zonas.map(z => z.cantidad || 0));

  if (kind === 'roles') {
    openDetail('Distribución por rol', `
      <div class="dd-hero">
        ${donutSvg(t, 160)}
      </div>
      <div class="dd-columns">${columnChart(t, rolesTotal, true)}</div>
      <div class="dd-list">
        ${roleDetail('Cosechadores', t.cosechadores || 0, rolesTotal, ROLE_COLORS.cosechadores)}
        ${roleDetail('Escáner', t.escaner || 0, rolesTotal, ROLE_COLORS.escaner)}
        ${roleDetail('Calidad', t.calidad || 0, rolesTotal, ROLE_COLORS.calidad)}
        ${roleDetail('Supervisor', t.supervisorCount || 0, rolesTotal, ROLE_COLORS.supervisorCount)}
      </div>
      <div class="dd-total">Total personal <strong>${t.total || rolesTotal}</strong></div>
    `);
    return;
  }

  if (kind === 'supervisores' || kind === 'cosechadores') {
    openDetail(kind === 'cosechadores' ? 'Cosechadores por supervisor' : 'Ranking de supervisores', `
      <div class="dd-stat-row">
        <div><span>Supervisores</span><strong>${t.supervisoresUnicos || 0}</strong></div>
        <div><span>Cosechadores</span><strong>${t.cosechadores || 0}</strong></div>
        <div><span>Conteos</span><strong>${t.conteos || 0}</strong></div>
      </div>
      ${supervisores.length ? `
        <div class="dd-sup-list">
          ${supervisores.map((s, i) => `
            <article class="dd-sup">
              <div class="dd-sup__top">
                <span class="dd-sup__rank">#${i + 1}</span>
                <div class="dd-sup__who">
                  <strong>${esc(s.supervisor)}</strong>
                  <span>${s.conteos} conteo${s.conteos === 1 ? '' : 's'} · ${s.grupos || 0} grupo${(s.grupos || 0) === 1 ? '' : 's'}</span>
                </div>
                <div class="dd-sup__cos">
                  <strong>${s.cosechadores}</strong>
                  <span>cosech.</span>
                </div>
              </div>
              <div class="data-bar data-bar--lg">
                <div class="data-bar__fill data-bar__fill--green" style="width:${pct(s.cosechadores, maxCos)}%"></div>
              </div>
              <div class="dd-sup__meta">
                <span>Escáner ${s.escaner}</span>
                <span>Calidad ${s.calidad}</span>
                <span>Sup ${s.supervisorCount}</span>
                <span class="dd-sup__total">Total ${s.total}</span>
              </div>
            </article>
          `).join('')}
        </div>
      ` : `<p class="data-empty__hint">Sin supervisores en este rango</p>`}
    `);
    return;
  }

  if (kind === 'zonas') {
    openDetail('Personas por zona', `
      <div class="dd-zona-chart">
        ${zonas.length ? zonas.map(z => `
          <div class="dd-zona-row">
            <span class="dd-zona-row__name">${esc(z.zona)}</span>
            <div class="data-bar data-bar--lg">
              <div class="data-bar__fill data-bar__fill--berry" style="width:${pct(z.cantidad, maxZona)}%"></div>
            </div>
            <strong>${z.cantidad}</strong>
          </div>
        `).join('') : `<p class="data-empty__hint">Sin zonas</p>`}
      </div>
      <div class="dd-total">Total en zonas <strong>${zonas.reduce((a, z) => a + (z.cantidad || 0), 0)}</strong></div>
    `);
    return;
  }

  openDetail('Resumen total', `
    <div class="dd-hero">${donutSvg(t, 150)}</div>
    <div class="dd-stat-grid">
      <div class="dd-stat dd-stat--red"><span>Supervisores</span><strong>${t.supervisoresUnicos || 0}</strong></div>
      <div class="dd-stat dd-stat--green"><span>Cosechadores</span><strong>${t.cosechadores || 0}</strong></div>
      <div class="dd-stat dd-stat--blue"><span>Escáner</span><strong>${t.escaner || 0}</strong></div>
      <div class="dd-stat dd-stat--amber"><span>Calidad</span><strong>${t.calidad || 0}</strong></div>
      <div class="dd-stat dd-stat--ink"><span>Rol supervisor</span><strong>${t.supervisorCount || 0}</strong></div>
      <div class="dd-stat dd-stat--grand"><span>Total junto</span><strong>${t.total || rolesTotal}</strong></div>
    </div>
    <div class="dd-mini">
      <span>Almuerzos ${t.almuerzos || 0}</span>
      <span>Permisos ${t.permisos || 0}</span>
      <span>Faltas ${t.faltas || 0}</span>
      <span>Conteos ${t.conteos || 0}</span>
    </div>
  `);
}

function roleDetail(label, value, total, color) {
  const p = total ? Math.round((value / total) * 100) : 0;
  return `
    <div class="dd-role">
      <div class="dd-role__top">
        <span><i style="background:${color}"></i>${label}</span>
        <strong>${value} <em>${p}%</em></strong>
      </div>
      <div class="data-bar data-bar--lg">
        <div class="data-bar__fill" style="width:${pct(value, total)}%;background:${color}"></div>
      </div>
    </div>`;
}

function columnChart(t, rolesTotal, tall) {
  const cols = [
    { label: 'Cos', v: t.cosechadores || 0, c: ROLE_COLORS.cosechadores },
    { label: 'Esc', v: t.escaner || 0, c: ROLE_COLORS.escaner },
    { label: 'Cal', v: t.calidad || 0, c: ROLE_COLORS.calidad },
    { label: 'Sup', v: t.supervisorCount || 0, c: ROLE_COLORS.supervisorCount }
  ];
  const max = Math.max(1, ...cols.map(c => c.v), rolesTotal ? 0 : 1);
  const h = tall ? 120 : 88;
  return `
    <div class="data-col-chart" style="--col-h:${h}px">
      ${cols.map(c => `
        <div class="data-col">
          <span class="data-col__val">${c.v}</span>
          <div class="data-col__track">
            <div class="data-col__fill" style="height:${pct(c.v, max)}%;background:linear-gradient(180deg,${c.c},${c.c}cc)"></div>
          </div>
          <span class="data-col__lab">${c.label}</span>
        </div>
      `).join('')}
    </div>`;
}

function donutSvg(t, size = 120) {
  const parts = [
    { v: t.cosechadores || 0, c: ROLE_COLORS.cosechadores },
    { v: t.escaner || 0, c: ROLE_COLORS.escaner },
    { v: t.calidad || 0, c: ROLE_COLORS.calidad },
    { v: t.supervisorCount || 0, c: ROLE_COLORS.supervisorCount }
  ];
  const sum = parts.reduce((a, p) => a + p.v, 0) || 1;
  const r = 34;
  const circ = 2 * Math.PI * r;
  let offset = 0;
  const circles = parts.map(p => {
    const len = (p.v / sum) * circ;
    const el = `<circle cx="50" cy="50" r="${r}" fill="none" stroke="${p.c}" stroke-width="16"
      stroke-linecap="butt"
      stroke-dasharray="${len} ${circ - len}" stroke-dashoffset="${-offset}"
      transform="rotate(-90 50 50)"/>`;
    offset += len;
    return el;
  }).join('');
  return `
    <div class="data-donut-block">
      <svg class="data-donut" viewBox="0 0 100 100" width="${size}" height="${size}">
        <circle cx="50" cy="50" r="${r}" fill="none" stroke="#eef1f5" stroke-width="16"/>
        ${circles}
        <circle cx="50" cy="50" r="22" fill="#fff"/>
        <text x="50" y="48" text-anchor="middle" font-size="13" font-weight="800" fill="#1a2330">${sum}</text>
        <text x="50" y="60" text-anchor="middle" font-size="6.5" font-weight="700" fill="#6B7280">TOTAL</text>
      </svg>
      <ul class="data-donut-legend">
        <li><i style="background:${ROLE_COLORS.cosechadores}"></i>Cosech. ${t.cosechadores || 0}</li>
        <li><i style="background:${ROLE_COLORS.escaner}"></i>Escáner ${t.escaner || 0}</li>
        <li><i style="background:${ROLE_COLORS.calidad}"></i>Calidad ${t.calidad || 0}</li>
        <li><i style="background:${ROLE_COLORS.supervisorCount}"></i>Sup. ${t.supervisorCount || 0}</li>
      </ul>
    </div>`;
}

function shortName(s) {
  const t = String(s || '');
  return t.length > 18 ? `${t.slice(0, 16)}…` : t;
}

function shortZona(s) {
  const t = String(s || '');
  return t.length > 8 ? `${t.slice(0, 7)}…` : t;
}

function pct(n, max) {
  if (!max) return 0;
  return Math.max(3, Math.min(100, Math.round((Number(n) / max) * 100)));
}

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/"/g, '&quot;');
}
