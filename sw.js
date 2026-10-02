// Service Worker: App-Dateien offline vorhalten. Kartenkacheln und API-Aufrufe gehen immer ins Netz.
const VERSION = 'sp-v16';
const FILES = ['./', './index.html', './manifest.json', './css/app.css?v=8', './js/main.js?v=14', './js/db.js', './js/util.js', './js/geo.js', './js/draw.js', './js/camera.js', './js/model.js', './js/export.js', './js/ai.js', './js/paket.js', './js/hilfe.js',
  './lib/jszip.js', './lib/jspdf.js', './lib/docx.js', './lib/exifr.js', './lib/leaflet.js', './lib/leaflet.css', './lib/images/marker-icon.png', './lib/images/marker-shadow.png', './icons/icon-192.png', './icons/icon-512.png', './icons/icon-180.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES.map(f => new Request(f, { cache: 'reload' })))).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return; // Netz für Karten/API
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request).then(res => { if (res.ok) { const cp = res.clone(); caches.open(VERSION).then(c => c.put(e.request, cp)); } return res; }).catch(async () => (e.request.mode === 'navigate' && await caches.match('./index.html')) || Response.error())));
});
