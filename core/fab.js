/** Menú flotante · Conteo · Ver data · Historial · Actualizar · Instalar — siempre en celular */

import { refreshApp } from './pwa.js';

const MORE_SVG = `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="5" cy="12" r="1"></circle><circle cx="12" cy="12" r="1"></circle><circle cx="19" cy="12" r="1"></circle></svg>`;

const ICONS = {
  conteo: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M8 2h8v4H8z"/><path d="M8 12h8"/><path d="M8 16h5"/></svg>`,
  data: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3v18h18"/><path d="M7 14l4-4 4 4 5-6"/></svg>`,
  historial: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/></svg>`,
  refresh: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 16h5v5"/></svg>`,
  install: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>`
};

let fabBound = false;

/** Celular / táctil: el FAB debe existir siempre (nunca modo escritorio). */
export function isPhoneUi() {
  if (window.matchMedia('(max-width: 1023px)').matches) return true;
  // Vista "sitio de escritorio" en el celular: sigue siendo táctil
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  const noHover = window.matchMedia('(hover: none)').matches;
  return coarse || noHover;
}

function closeFab() {
  const menu = document.getElementById('fab-menu');
  const fab = document.getElementById('fab-options-btn');
  if (menu) menu.hidden = true;
  if (fab) {
    fab.setAttribute('aria-expanded', 'false');
    fab.classList.remove('is-on');
  }
}

function openFab() {
  const menu = document.getElementById('fab-menu');
  const fab = document.getElementById('fab-options-btn');
  if (!menu || !fab) return;
  menu.hidden = false;
  fab.setAttribute('aria-expanded', 'true');
  fab.classList.add('is-on');
}

function toggleFab() {
  const menu = document.getElementById('fab-menu');
  if (!menu) return;
  if (menu.hidden) openFab();
  else closeFab();
}

function runAct(act) {
  closeFab();
  if (act === 'goto-conteo') {
    window.dispatchEvent(new CustomEvent('app:goto-tab', { detail: { tab: 'conteo' } }));
    return;
  }
  if (act === 'goto-data') {
    window.dispatchEvent(new CustomEvent('app:goto-tab', { detail: { tab: 'data' } }));
    return;
  }
  if (act === 'goto-historial') {
    window.dispatchEvent(new CustomEvent('app:goto-tab', { detail: { tab: 'historial' } }));
    return;
  }
  if (act === 'refresh-app') {
    const btn = document.querySelector('#fab-menu [data-act="refresh-app"]');
    if (btn?.disabled) return;
    if (btn) {
      btn.disabled = true;
      btn.setAttribute('aria-busy', 'true');
    }
    refreshApp().catch(() => {
      if (btn) {
        btn.disabled = false;
        btn.removeAttribute('aria-busy');
      }
    });
    return;
  }
  if (act === 'install-app') {
    const btn = document.getElementById('btn-install-historial')
      || document.getElementById('btn-install-banner')
      || document.getElementById('btn-install-app');
    btn?.click();
  }
}

function syncInstallItem() {
  const installBtn = document.querySelector('#fab-menu [data-act="install-app"]');
  if (!installBtn) return;
  const source = document.getElementById('btn-install-historial')
    || document.getElementById('btn-install-banner')
    || document.getElementById('btn-install-app');
  const show = Boolean(source && !source.hidden && source.getAttribute('hidden') == null);
  installBtn.hidden = !show;
}

export function destroyFab() {
  document.getElementById('fab-root')?.remove();
}

/** Monta o re-monta el FAB. Idempotente. */
export function mountFab() {
  if (!isPhoneUi()) {
    destroyFab();
    return null;
  }

  let wrap = document.getElementById('fab-root');
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.id = 'fab-root';
    wrap.className = 'fab-wrap';
    document.body.appendChild(wrap);
  }

  wrap.hidden = false;
  wrap.style.display = '';
  wrap.classList.remove('is-desk-hidden');

  wrap.innerHTML = `
    <div class="fab-menu" id="fab-menu" hidden>
      <p class="fab-menu__title">Opciones</p>
      <button type="button" data-act="goto-conteo">${ICONS.conteo}<span>Conteo</span></button>
      <button type="button" data-act="goto-data">${ICONS.data}<span>Ver data</span></button>
      <button type="button" data-act="goto-historial">${ICONS.historial}<span>Historial</span></button>
      <button type="button" data-act="refresh-app" id="btn-refresh-app">${ICONS.refresh}<span>Actualizar app</span></button>
      <button type="button" data-act="install-app" hidden>${ICONS.install}<span>Instalar app</span></button>
    </div>
    <button class="fab-options" id="fab-options-btn" type="button" data-act="toggle-fab" aria-label="Opciones rápidas" aria-expanded="false">${MORE_SVG}</button>
  `;

  if (!fabBound) {
    fabBound = true;
    document.addEventListener('click', (e) => {
      if (e.target.closest?.('#fab-root')) return;
      closeFab();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeFab();
    });
    window.setInterval(syncInstallItem, 2500);
  }

  wrap.onclick = (e) => {
    e.stopPropagation();
    const btn = e.target.closest?.('[data-act]');
    if (!btn || !wrap.contains(btn)) return;
    const act = btn.dataset.act;
    if (act === 'toggle-fab') {
      toggleFab();
      return;
    }
    runAct(act);
  };

  syncInstallItem();
  return wrap;
}

export function initFab() {
  return mountFab();
}

/** Llama al rotar / cambiar tamaño: asegura FAB en celular. */
export function ensureFabForViewport() {
  if (isPhoneUi()) mountFab();
  else destroyFab();
}
