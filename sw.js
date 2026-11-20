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
