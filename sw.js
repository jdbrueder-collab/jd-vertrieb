// Netzwerk zuerst, Cache nur als Offline-Notlösung, damit Updates sofort ankommen.
// Nur die eigenen App-Dateien. Die Leads (Google Apps Script) gehen immer direkt ans Netz und werden nie gespeichert.
const CACHE = 'jd-vertrieb-v1';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== self.location.origin) return;
  e.respondWith(
    fetch(e.request, { cache: 'no-cache' })
      .then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return r; })
      .catch(() => caches.match(e.request))
  );
});

// Benachrichtigungen (neuer Lead, morgens fällige). Ein Tipp holt die App nach vorn und öffnet den Lead.
self.addEventListener('push', e => {
  let d = {}; try { d = e.data.json(); } catch { d = { body: e.data?.text() || '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'JD Vertrieb', { body: d.body || '', icon: 'icon-192.png', badge: 'icon-192.png', data: { url: d.url || './' } }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || './', self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    if (list[0]) { list[0].postMessage({ open: url }); return list[0].focus(); }
    return self.clients.openWindow(url);
  }));
});
