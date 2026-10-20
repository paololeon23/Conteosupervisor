/** Aviso del sistema cuando un pendiente ya quedó en el servidor. */

export function pedirPermisoNotificaciones() {
  if (typeof Notification === 'undefined') return;
  if (Notification.permission !== 'default') return;
  Notification.requestPermission().catch(() => {});
}

function nombreDe(item) {
  const raw = String(item?.supervisor || item?.supervisorNombre || '').trim();
  const limpio = raw.replace(/^\d{8,9}\s*[·\-–]?\s*/, '').trim();
  return limpio || 'Conteo';
}

export async function notificarPendientesSubidos(items) {
  const lista = (items || []).filter(Boolean);
  if (!lista.length) return;

  const title = lista.length === 1 ? 'Pendiente subido' : 'Pendientes subidos';
  const body = lista.length === 1
    ? `${nombreDe(lista[0])} ya está en el servidor`
    : `${lista.length} conteos ya están en el servidor`;

  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;

  try {
    const reg = await navigator.serviceWorker?.ready;
    if (reg?.showNotification) {
      await reg.showNotification(title, {
        body,
        icon: '/assets/icon-192.png',
        badge: '/assets/icon-192.png',
        tag: 'qb-pendiente-subido',
        renotify: true,
        data: { tab: 'historial' }
      });
      return;
    }
  } catch { /* fallback abajo */ }

  try {
    const n = new Notification(title, { body, icon: '/assets/icon-192.png', tag: 'qb-pendiente-subido' });
    n.onclick = () => {
      window.focus();
      n.close();
    };
  } catch { /* sin permiso */ }
}

export async function programarSubidaEnFondo() {
  try {
    const reg = await navigator.serviceWorker?.ready;
    if (reg?.sync) await reg.sync.register('qb-flush-queue');
  } catch { /* el navegador no tiene Background Sync */ }
}
