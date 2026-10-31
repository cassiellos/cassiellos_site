/**
 * Service worker do PWA CRM Cassiellos (servido em /crm-sw.js, escopo /crm).
 *
 * - SEM cache e SEM evento "fetch": nenhuma resposta autenticada, dado pessoal, token ou reunião é
 *   guardado pelo service worker. O navegador continua buscando tudo da rede, com a sessão normal.
 * - push: mostra o aviso genérico recebido (título/texto fixos, sem dados pessoais) e envia o recibo
 *   "exibida". A tag é o ID opaco da notificação: repetição substitui em vez de duplicar.
 * - notificationclick: recibo "tocada" e abre/foca o CRM na tela certa (/crm/notificacoes/abrir/<id>),
 *   que exige a sessão administrativa (sem sessão → login → volta para a ficha).
 * - Sem botões de ação na notificação (nem todo navegador suporta).
 */
export const SERVICE_WORKER_VERSION = 'crm-cassiellos-sw-3'

export const SERVICE_WORKER_SOURCE = `'use strict';
const VERSION = '${SERVICE_WORKER_VERSION}';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

function safeUrl(value) {
  return typeof value === 'string' && /^\\/crm(\\/[A-Za-z0-9/_-]*)?(\\?[A-Za-z0-9=&_-]*)?$/.test(value) && value.indexOf('//') === -1 ? value : '/crm';
}
function text(value, fallback, max) {
  return typeof value === 'string' && value.trim() ? value.slice(0, max) : fallback;
}
function receipt(data, event) {
  if (!data || typeof data.d !== 'string' || typeof data.r !== 'string') return Promise.resolve();
  return fetch('/api/crm/push/receipt', {
    method: 'POST', credentials: 'omit', keepalive: true, cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ d: data.d, r: data.r, e: event }),
  }).catch(() => undefined);
}

self.addEventListener('push', event => {
  let data = null;
  try { data = event.data ? event.data.json() : null; } catch (e) { data = null; }
  const title = text(data && data.t, 'CRM | Cassiellos', 80);
  const options = {
    body: text(data && data.b, 'Você tem um novo aviso. Toque para abrir o CRM.', 200),
    tag: typeof (data && data.g) === 'string' ? data.g.slice(0, 64) : undefined,
    renotify: false,
    icon: '/crm/icon/192.png?v=3',
    badge: '/crm/icon/badge.png?v=3',
    lang: 'pt-BR',
    data: { url: safeUrl(data && data.u), d: data && data.d, r: data && data.r },
  };
  event.waitUntil(Promise.all([self.registration.showNotification(title, options), receipt(data, 'displayed')]));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const data = event.notification.data || {};
  const target = new URL(safeUrl(data.url), self.location.origin).href;
  event.waitUntil((async () => {
    receipt(data, 'clicked');
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      if (new URL(client.url).pathname.indexOf('/crm') === 0 && 'focus' in client) {
        try { await client.focus(); if ('navigate' in client) { await client.navigate(target); return; } } catch (e) { /* abre nova janela */ }
      }
    }
    await self.clients.openWindow(target);
  })());
});
`
