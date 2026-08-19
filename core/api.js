import { SCRIPT } from './api-config.js';

async function callScript(action, data) {
  const payload = { action, token: SCRIPT.TOKEN };
  if (data) payload.data = data;

  const res = await fetch(SCRIPT.CONTEO, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(payload),
    redirect: 'follow'
  });

  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { ok: false, code: 'PARSE_ERROR', message: text.slice(0, 200) };
  }
}

async function callScriptGet(params) {
  const qs = new URLSearchParams({ ...params, token: SCRIPT.TOKEN });
  const res = await fetch(`${SCRIPT.CONTEO}?${qs}`, { cache: 'no-store', redirect: 'follow' });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { ok: false, code: 'PARSE_ERROR', message: text.slice(0, 200) };
  }
}

export async function guardarConteo(data) {
  return callScript('guardar', data);
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
