// Standort, Straßenvorschlag, Kartenlinks
let watchId = null;
let last = null;
const listeners = new Set();

export function startWatch() {
  if (watchId != null || !navigator.geolocation) return;
  // Schneller grober Fix (zuletzt bekannte Position), damit der erste Punkt nicht minutenlang ohne Standort bleibt
  navigator.geolocation.getCurrentPosition(p => {
    if (last) return;
    last = { lat: p.coords.latitude, lon: p.coords.longitude, acc: Math.round(p.coords.accuracy || 0), ts: p.timestamp, coarse: true };
    listeners.forEach(f => f(last));
  }, () => {}, { enableHighAccuracy: false, maximumAge: 600000, timeout: 4000 });
  watchId = navigator.geolocation.watchPosition(p => {
    last = { lat: p.coords.latitude, lon: p.coords.longitude, acc: Math.round(p.coords.accuracy || 0), ts: p.timestamp, speed: p.coords.speed, heading: p.coords.heading };
    listeners.forEach(f => f(last));
  }, err => { console.warn('GPS', err.message); listeners.forEach(f => f(null, err)); }, { enableHighAccuracy: true, maximumAge: 2000, timeout: 15000 });
}
export function stopWatch() { if (watchId != null) { navigator.geolocation.clearWatch(watchId); watchId = null; } }
export function onPosition(f) { listeners.add(f); return () => listeners.delete(f); }
export function lastPosition() { return last; }
export function currentPosition(timeout = 6000) {
  return new Promise(res => {
    if (last && Date.now() - last.ts < 8000) return res(last);
    if (!navigator.geolocation) return res(null);
    navigator.geolocation.getCurrentPosition(p => res({ lat: p.coords.latitude, lon: p.coords.longitude, acc: Math.round(p.coords.accuracy || 0), ts: p.timestamp }), () => res(last), { enableHighAccuracy: true, timeout, maximumAge: 5000 });
  });
}

// Reverse-Geocoding über Nominatim (OpenStreetMap). Höchstens 1 Anfrage/s.
const geoCache = new Map();
let queue = Promise.resolve();
export function reverseGeocode(lat, lon) {
  const key = `${lat.toFixed(4)},${lon.toFixed(4)}`;
  if (geoCache.has(key)) return geoCache.get(key);
  const p = queue.then(async () => {
    await new Promise(r => setTimeout(r, 1100));
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=17&lat=${lat}&lon=${lon}&accept-language=de`, { headers: { 'Accept': 'application/json' } });
      if (!r.ok) throw new Error(r.status);
      const j = await r.json();
      const a = j.address || {};
      const road = a.road || a.pedestrian || a.footway || a.path || '';
      const ref = j.extratags?.ref || '';
      const place = a.city || a.town || a.village || a.municipality || a.hamlet || '';
      return { road, ref, place, display: [road || ref, place].filter(Boolean).join(', ') };
    } catch (e) { geoCache.delete(key); return null; }
  });
  queue = p.catch(() => {});
  geoCache.set(key, p);
  return p;
}

export const mapsLinks = (g) => g ? ({
  google: `https://www.google.com/maps/search/?api=1&query=${g.lat},${g.lon}`,
  apple: `https://maps.apple.com/?ll=${g.lat},${g.lon}&q=Streckenpunkt`,
  osm: `https://www.openstreetmap.org/?mlat=${g.lat}&mlon=${g.lon}#map=18/${g.lat}/${g.lon}`,
}) : null;

export function copyText(t) {
  if (navigator.clipboard) return navigator.clipboard.writeText(t).then(() => true).catch(() => false);
  return Promise.resolve(false);
}

// kleine Leaflet-Karte
// Karte. points: [{...punkt, label}] ; opts: interactive, line, maxZoom, onClick(p), onMove(p, {lat,lon}) (Marker ziehbar), onMapClick({lat,lon}), focusId
export function miniMap(el, points, opts = {}) {
  if (!window.L) return null;
  const map = L.map(el, { zoomControl: false, attributionControl: true, dragging: !!opts.interactive, scrollWheelZoom: !!opts.interactive, touchZoom: !!opts.interactive, doubleClickZoom: !!opts.interactive, tap: false });
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, maxNativeZoom: 19, detectRetina: true, attribution: '© OpenStreetMap' }).addTo(map);
  const pts = points.filter(p => p.gps);
  const color = (p) => p.nachpruefen ? '#e0a100' : p.typ === 'start' ? '#0f6b31' : p.typ === 'ziel' ? '#c8102e' : p.altRoute ? '#1e4fb8' : '#111';
  const mkIcon = (p, big) => L.divIcon({ className: '', html: `<div style="width:${big ? 34 : 28}px;height:${big ? 34 : 28}px;border-radius:50%;background:${color(p)};color:#fff;font:700 ${big ? 14 : 12}px -apple-system,Arial;display:flex;align-items:center;justify-content:center;border:${big ? 3 : 2}px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.45)${p.gps?.coarse || (p.gps?.acc > 60) ? ';outline:2px dashed ' + color(p) + ';outline-offset:2px' : ''}">${p.label ?? ''}</div>`, iconSize: [big ? 34 : 28, big ? 34 : 28], iconAnchor: [big ? 17 : 14, big ? 17 : 14] });
  const markers = new Map();
  const haupt = [], alt = [];
  pts.forEach((p) => {
    const m = L.marker([p.gps.lat, p.gps.lon], { icon: mkIcon(p, opts.focusId === p.id), draggable: !!opts.onMove, autoPan: true, zIndexOffset: opts.focusId === p.id ? 1000 : 0 }).addTo(map);
    if (opts.onClick) m.on('click', () => opts.onClick(p, m));
    if (opts.onMove) m.on('dragend', () => { const ll = m.getLatLng(); opts.onMove(p, { lat: ll.lat, lon: ll.lng }); });
    markers.set(p.id, m);
    (p.altRoute ? alt : haupt).push([p.gps.lat, p.gps.lon]);
  });
  if (opts.line !== false) {
    if (haupt.length > 1) L.polyline(haupt, { color: '#c8102e', weight: 3, opacity: .85 }).addTo(map);
    if (alt.length > 1) L.polyline(alt, { color: '#1e4fb8', weight: 3, dashArray: '8 6', opacity: .85 }).addTo(map);
  }
  if (opts.onMapClick) map.on('click', (e) => opts.onMapClick({ lat: e.latlng.lat, lon: e.latlng.lng }));
  const all = [...haupt, ...alt];
  if (opts.focusId && markers.get(opts.focusId)) map.setView(markers.get(opts.focusId).getLatLng(), opts.maxZoom || 17);
  else if (all.length) map.fitBounds(all, { padding: [36, 36], maxZoom: opts.maxZoom || 17 });
  else map.setView(opts.center ? [opts.center.lat, opts.center.lon] : [52.9, 8.0], opts.center ? 15 : 8);
  if (opts.interactive) L.control.zoom({ position: 'bottomright' }).addTo(map);
  setTimeout(() => map.invalidateSize(), 50);
  map._markers = markers;
  return map;
}
