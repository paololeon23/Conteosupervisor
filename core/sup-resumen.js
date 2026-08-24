import { toast, $, formatFechaLima, todayStr, openModalElement, closeModalElement } from './utils.js';

/**
 * Resumen visual por supervisor → PNG compartible
 */

let bound = false;
/** @type {object|null} */
let dashData = null;

export function initSupResumen() {
  if (bound) return;
  bound = true;

  $('#sup-resumen-close')?.addEventListener('click', closeResumen);
  $('#sup-resumen-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'sup-resumen-modal') closeResumen();
  });
  $('#sup-preview-close')?.addEventListener('click', closePreview);
  $('#sup-preview-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'sup-preview-modal') closePreview();
  });
  $('#sup-preview-share')?.addEventListener('click', () => shareCurrentPreview());
  $('#sup-preview-download')?.addEventListener('click', () => downloadCurrentPreview());
}

export function openSupResumenList(data) {
  dashData = data;
  const list = $('#sup-resumen-list');
  const meta = $('#sup-resumen-meta');
  const supervisores = Array.isArray(data?.supervisores) ? data.supervisores : [];

  if (meta) {
    const fechaLabel = data?.fecha === 'all'
      ? 'Todas las fechas'
      : (formatFechaLima(data?.fecha) || data?.fecha || todayStr());
    meta.textContent = `${supervisores.length} supervisor${supervisores.length === 1 ? '' : 'es'} · ${fechaLabel}`;
  }

  if (!list) return;

  if (!supervisores.length) {
    list.innerHTML = `<p class="data-empty__hint">No hay supervisores para este rango</p>`;
    openModalElement($('#sup-resumen-modal'));
    return;
  }

  list.innerHTML = supervisores.map((s, i) => `
    <article class="sup-resumen-item">
      <div class="sup-resumen-item__info">
        <span class="sup-resumen-item__rank">#${i + 1}</span>
        <div>
          <strong>${esc(s.supervisor)}</strong>
          <span>${s.cosechadores} cosech. · Total ${s.total}</span>
        </div>
      </div>
      <button type="button" class="btn btn--zona-nueva sup-resumen-item__btn" data-sup-idx="${i}">
        Ver resumen
      </button>
    </article>
  `).join('');

  list.querySelectorAll('[data-sup-idx]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const idx = parseInt(btn.getAttribute('data-sup-idx'), 10);
      const sup = supervisores[idx];
      if (!sup) return;
      btn.disabled = true;
      try {
        await showSupervisorPreview(sup, data);
      } finally {
        btn.disabled = false;
      }
    });
  });

  openModalElement($('#sup-resumen-modal'));
}

function closeResumen() {
  closeModalElement($('#sup-resumen-modal'));
}

function closePreview() {
  closeModalElement($('#sup-preview-modal'));
  const img = $('#sup-preview-img');
  if (img?.src?.startsWith('blob:')) URL.revokeObjectURL(img.src);
  if (img) {
    img.removeAttribute('src');
    delete img.dataset.blobUrl;
  }
}

/** @type {Blob|null} */
let currentBlob = null;
/** @type {string} */
let currentFileName = 'resumen-supervisor.png';

async function showSupervisorPreview(sup, data) {
  toast('Generando imagen…', 'info');
  const blob = await renderSupervisorPng(sup, data);
  currentBlob = blob;
  currentFileName = fileNameFor(sup);

  const img = $('#sup-preview-img');
  const title = $('#sup-preview-title');
  if (title) title.textContent = String(sup.supervisor || 'Supervisor');

  if (img) {
    if (img.dataset.blobUrl) URL.revokeObjectURL(img.dataset.blobUrl);
    const url = URL.createObjectURL(blob);
    img.dataset.blobUrl = url;
    img.src = url;
  }

  openModalElement($('#sup-preview-modal'));
}

async function shareCurrentPreview() {
  if (!currentBlob) {
    toast('No hay imagen para compartir', 'warn');
    return;
  }

  const file = new File([currentBlob], currentFileName, { type: 'image/png' });

  try {
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({
        files: [file],
        title: 'Resumen supervisor · Q Berries',
        text: 'Resumen de conteo por supervisor'
      });
      toast('Compartido', 'success');
      return;
    }
    if (navigator.share) {
      const url = URL.createObjectURL(currentBlob);
      await navigator.share({
        title: 'Resumen supervisor · Q Berries',
        text: 'Resumen de conteo',
        url
      });
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      toast('Compartido', 'success');
      return;
    }
  } catch (err) {
    if (err?.name === 'AbortError') return;
  }

  downloadCurrentPreview();
}

function downloadCurrentPreview() {
  if (!currentBlob) return;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(currentBlob);
  a.download = currentFileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  toast('Imagen guardada — puede enviarla por WhatsApp', 'success');
}

function fileNameFor(sup) {
  const name = String(sup.supervisor || 'supervisor')
    .toLowerCase()
    .replace(/[^a-z0-9áéíóúñ]+/gi, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
  return `resumen-${name || 'supervisor'}.png`;
}

async function renderSupervisorPng(sup, data) {
  const W = 720;
  const H = 920;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  // fondo
  ctx.fillStyle = '#F4F6F8';
  ctx.fillRect(0, 0, W, H);

  // card blanca
  roundRect(ctx, 36, 36, W - 72, H - 72, 28);
  ctx.fillStyle = '#FFFFFF';
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.06)';
  ctx.lineWidth = 2;
  ctx.stroke();

  // barra marca
  ctx.fillStyle = '#D61F26';
  roundRect(ctx, 36, 36, W - 72, 10, { tl: 28, tr: 28, br: 0, bl: 0 });
  ctx.fill();

  // logo text
  ctx.fillStyle = '#c8102e';
  ctx.font = '800 22px system-ui, -apple-system, sans-serif';
  ctx.fillText('Q BERRIES', 64, 90);
  ctx.fillStyle = '#6B7280';
  ctx.font = '600 16px system-ui, -apple-system, sans-serif';
  ctx.fillText('Paiján · Resumen supervisor', 64, 116);

  const fechaLabel = data?.fecha === 'all'
    ? 'Todas las fechas'
    : (formatFechaLima(data?.fecha) || data?.fecha || todayStr());

  // chip fecha
  roundRect(ctx, 64, 140, 280, 40, 12);
  ctx.fillStyle = 'rgba(82,173,75,0.12)';
  ctx.fill();
  ctx.fillStyle = '#3D8A37';
  ctx.font = '700 18px system-ui, -apple-system, sans-serif';
  ctx.fillText(fechaLabel, 80, 167);

  // nombre supervisor
  ctx.fillStyle = '#1a2330';
  ctx.font = '800 34px system-ui, -apple-system, sans-serif';
  const name = String(sup.supervisor || 'SIN NOMBRE').toUpperCase();
  wrapText(ctx, name, 64, 230, W - 128, 40);

  ctx.fillStyle = '#6B7280';
  ctx.font = '600 18px system-ui, -apple-system, sans-serif';
  ctx.fillText(`${sup.conteos || 0} conteo(s) · ${sup.grupos || 0} grupo(s)`, 64, 300);

  // KPIs
  const kpis = [
    { label: 'COSECHADORES', value: sup.cosechadores || 0, color: '#52AD4B', bg: 'rgba(82,173,75,0.12)' },
    { label: 'ESCÁNER', value: sup.escaner || 0, color: '#1d4ed8', bg: 'rgba(59,130,246,0.12)' },
    { label: 'CALIDAD', value: sup.calidad || 0, color: '#b54708', bg: 'rgba(247,148,30,0.14)' },
    { label: 'SUPERVISOR', value: sup.supervisorCount || 0, color: '#D61F26', bg: 'rgba(214,31,38,0.1)' }
  ];

  const gap = 16;
  const boxW = (W - 128 - gap) / 2;
  const boxH = 110;
  let x0 = 64;
  let y0 = 340;

  kpis.forEach((k, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = x0 + col * (boxW + gap);
    const y = y0 + row * (boxH + gap);
    roundRect(ctx, x, y, boxW, boxH, 18);
    ctx.fillStyle = k.bg;
    ctx.fill();
    ctx.fillStyle = '#6B7280';
    ctx.font = '700 14px system-ui, -apple-system, sans-serif';
    ctx.fillText(k.label, x + 18, y + 34);
    ctx.fillStyle = k.color;
    ctx.font = '800 42px system-ui, -apple-system, sans-serif';
    ctx.fillText(String(k.value), x + 18, y + 84);
  });

  // total banner
  const ty = 600;
  roundRect(ctx, 64, ty, W - 128, 100, 20);
  const grad = ctx.createLinearGradient(64, ty, W - 64, ty + 100);
  grad.addColorStop(0, '#1a2330');
  grad.addColorStop(1, '#2d3a4d');
  ctx.fillStyle = grad;
  ctx.fill();

  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.font = '700 16px system-ui, -apple-system, sans-serif';
  ctx.fillText('TOTAL PERSONAL', 88, ty + 38);
  ctx.fillStyle = '#FFFFFF';
  ctx.font = '800 48px system-ui, -apple-system, sans-serif';
  ctx.fillText(String(sup.total || 0), 88, ty + 82);

  // footer
  ctx.fillStyle = '#9CA3AF';
  ctx.font = '600 14px system-ui, -apple-system, sans-serif';
  ctx.fillText('Conteo Grupo de Cosecha · Q Berries', 64, H - 70);
  ctx.fillText('Capture / comparta como respaldo', 64, H - 48);

  return await new Promise((resolve) => {
    canvas.toBlob((b) => resolve(b || new Blob()), 'image/png', 0.95);
  });
}

function roundRect(ctx, x, y, w, h, r) {
  const radius = typeof r === 'number'
    ? { tl: r, tr: r, br: r, bl: r }
    : { tl: 0, tr: 0, br: 0, bl: 0, ...r };
  ctx.beginPath();
  ctx.moveTo(x + radius.tl, y);
  ctx.lineTo(x + w - radius.tr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius.tr);
  ctx.lineTo(x + w, y + h - radius.br);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius.br, y + h);
  ctx.lineTo(x + radius.bl, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius.bl);
  ctx.lineTo(x, y + radius.tl);
  ctx.quadraticCurveTo(x, y, x + radius.tl, y);
  ctx.closePath();
}

function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
  const words = text.split(' ');
  let line = '';
  let yy = y;
  for (let n = 0; n < words.length; n++) {
    const test = line + words[n] + ' ';
    if (ctx.measureText(test).width > maxWidth && n > 0) {
      ctx.fillText(line.trim(), x, yy);
      line = words[n] + ' ';
      yy += lineHeight;
    } else {
      line = test;
    }
  }
  ctx.fillText(line.trim(), x, yy);
}

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/"/g, '&quot;');
}
