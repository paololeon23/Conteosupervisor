import { SCRIPT } from './api-config.js';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function callScript(action, data, timeoutMs = 45000) {
  const payload = { action, token: SCRIPT.TOKEN };
  if (data) payload.data = data;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(SCRIPT.CONTEO, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
      redirect: 'follow',
      cache: 'no-store',
      signal: ctrl.signal
    });

    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      return { ok: false, code: 'PARSE_ERROR', message: text.slice(0, 200) };
    }
  } catch (err) {
    if (err?.name === 'AbortError') {
      return { ok: false, code: 'TIMEOUT', message: 'La red tardó demasiado' };
    }
    return { ok: false, code: 'NETWORK', message: String(err?.message || err) };
  } finally {
    clearTimeout(timer);
  }
}

function esFalloDeRed(resp) {
  return !resp || resp.code === 'TIMEOUT' || resp.code === 'NETWORK' || resp.code === 'PARSE_ERROR';
}

async function callScriptGet(params, timeoutMs = 22000) {
  const qs = new URLSearchParams({ ...params, token: SCRIPT.TOKEN });
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${SCRIPT.CONTEO}?${qs}`, {
      cache: 'no-store',
      redirect: 'follow',
      signal: ctrl.signal
    });
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      return { ok: false, code: 'PARSE_ERROR', message: text.slice(0, 200) };
    }
  } catch (err) {
    if (err?.name === 'AbortError') {
      return { ok: false, code: 'TIMEOUT', message: 'La red tardó demasiado' };
    }
    return { ok: false, code: 'NETWORK', message: String(err?.message || err) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Envía un conteo al Apps Script.
 * @param {object} data
 * @param {number} [timeoutMs]
 * @param {{ maxAttempts?: number }} [opts] 1 = Guardar (rápido); 2 = flush en fondo
 */
export async function guardarConteo(data, timeoutMs = 18000, opts = {}) {
  const maxAttempts = Math.max(1, opts.maxAttempts ?? 1);
  let last = null;
  for (let intento = 0; intento < maxAttempts; intento++) {
    last = await callScript('guardar', data, timeoutMs);
    if (isConteoSuccess(last) || isAuthError(last)) return last;
    if (!esFalloDeRed(last)) return last;
    if (intento + 1 < maxAttempts) await sleep(800 * (intento + 1));
  }
  return last;
}

export async function consultarConteo(data) {
  return callScript('consultar', data);
}

export async function obtenerDashboard(fecha, licapa) {
  return callScriptGet({
    action: 'dashboard',
    fecha: fecha || '',
    licapa: licapa || '',
    _t: String(Date.now())
  });
}

export async function pingConteo() {
  return callScriptGet({ action: 'ping' });
}

export function isConteoSuccess(resp) {
  if (!resp) return false;
  return resp.ok === true;
}

export function isAuthError(resp) {
  return resp && (resp.code === 'UNAUTHORIZED' || resp.code === 'WRONG_API');
}
