// Fahrmodus: Vollbild-Kamera, Tippen = Foto, Halten = Serie, Nachprüf-Punkt, Fotothek-Import
import { h, $, toast, fmtTime, normalizePhoto, sheet, promptSheet, confirmSheet, infoSheet } from './util.js';
import { HILFE } from './hilfe.js';
import { startWatch, stopWatch, onPosition, currentPosition, lastPosition, reverseGeocode } from './geo.js';
import { db, uid, blobUrl, getStamm } from './db.js';
import { model } from './model.js';

export async function openFahrmodus(ctx, onClose) {
  // ctx: {fahrt, protokoll, teil}
  const root = h(`<div class="cam">
    <video autoplay playsinline muted></video>
    <div class="flash"></div>
    <div class="hud">
      <div class="hudbox" data-r="teil"></div>
      <div class="hudbox" data-r="gps">GPS …</div>
    </div>
    <div class="hud2"><div class="hudbox" data-r="street" style="font-weight:500">📍 Standort wird ermittelt …</div></div>
    <button class="hudbox closebtn" data-a="close" style="font-size:16px">✕ Beenden</button>
    <button class="hudbox helpbtn" data-a="help">?</button>
    <img class="last hidden" data-r="last">
    <div class="counter hidden" data-r="counter"></div>
    <div class="bottom">
      <div class="zoomrow" data-r="zoom"></div>
      <div class="controls">
        <button class="sidebtn import" data-a="import"><i>🖼</i>Fotothek</button>
        <button class="shutter" data-a="shutter"><i></i></button>
        <button class="sidebtn flag" data-a="flag"><i>⚑</i>Nachprüfen</button>
      </div>
      <div style="text-align:center;color:#9aa3ad;font-size:13px;margin-top:14px">Tippen = Foto · Halten = Serie · ⚑ = Nachprüf-Punkt · letztes Bild antippen = Stichwort/Ziel/löschen</div>
    </div>
    <input type="file" accept="image/*" multiple class="hidden" data-r="file">
  </div>`);
  document.body.appendChild(root);
  const video = $('video', root);
  let stream = null, track = null, count = 0, lastStreet = '';
  const teilLabel = $('[data-r=teil]', root);
  const setTeil = async () => { const n = await model.countPunkte(ctx.protokoll.id, ctx.teil.id); teilLabel.textContent = `${ctx.teil.name}${ctx.altRoute ? ' · Alternativroute' : ''} · Punkt ${n + 1} ▾`; };
  setTeil();
  let lastPunktId = null;
  // Teil wechseln ohne den Fahrmodus zu verlassen
  teilLabel.style.cursor = 'pointer';
  teilLabel.onclick = () => {
    const opts = [];
    for (const t of ctx.protokoll.teile) {
      opts.push({ label: `${t.name}`, onclick: () => { ctx.teil = t; ctx.altRoute = false; setTeil(); } });
      if (t.alt?.aktiv) opts.push({ label: `${t.nr} · Alternativroute`, onclick: () => { ctx.teil = t; ctx.altRoute = true; setTeil(); } });
    }
    sheet('Wofür aufnehmen?', opts);
  };

  // ---- Zoom: Hardware-Zoom wenn das Gerät ihn freigibt, sonst Ausschnitt (Vorschau + Aufnahme in voller Auflösung). 0,5× = Ultraweitwinkel-Kamera.
  let zoom = 1, hwZoom = null, digital = 1, lens = 'wide', wideId = '', ultraId = '';
  const zoomRow = $('[data-r=zoom]', root);
  const zoomLabel = () => { const f = lens === 'ultra' ? 0.5 * zoom : zoom; return (Math.round(f * 10) / 10).toLocaleString('de-DE') + '×'; };
  async function applyZoom(z) {
    zoom = Math.max(1, Math.min(z, hwZoom ? Math.min(hwZoom.max, 8) : 5));
    if (hwZoom && track && zoom <= hwZoom.max) {
      try { await track.applyConstraints({ advanced: [{ zoom: Math.max(hwZoom.min, zoom) }] }); digital = 1; video.style.transform = ''; }
      catch (e) { hwZoom = null; digital = zoom; video.style.transform = `scale(${digital})`; }
    } else { digital = zoom; video.style.transform = digital > 1 ? `scale(${digital})` : ''; }
    drawZoom();
  }
  function drawZoom() {
    const stufen = [...(ultraId ? [{ f: 0.5, l: '0,5×' }] : []), { f: 1, l: '1×' }, { f: 2, l: '2×' }, { f: 3, l: '3×' }];
    const cur = lens === 'ultra' ? 0.5 * zoom : zoom;
    zoomRow.innerHTML = stufen.map(st => `<button class="zb ${Math.abs(cur - st.f) < 0.15 ? 'on' : ''}" data-z="${st.f}">${st.l}</button>`).join('') + `<span class="zcur">${zoomLabel()}</span>`;
  }
  zoomRow.addEventListener('click', async e => {
    const b = e.target.closest('[data-z]'); if (!b) return;
    const f = parseFloat(b.dataset.z);
    if (f < 1) { if (lens !== 'ultra') { lens = 'ultra'; await openStream(); } zoom = 1; await applyZoom(1); return; }
    if (lens === 'ultra') { lens = 'wide'; await openStream(); }
    await applyZoom(f);
  });
  // Zwei-Finger-Zoom auf dem Kamerabild
  const pts = new Map(); let pinchStart = 0, pinchZoom = 1;
  const dist = () => { const [a, b] = [...pts.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
  root.addEventListener('pointerdown', e => { if (e.target.closest('button,.bottom,.hud,.hud2,.last,input')) return; pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); if (pts.size === 2) { pinchStart = dist(); pinchZoom = zoom; } });
  root.addEventListener('pointermove', e => { if (!pts.has(e.pointerId)) return; pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); if (pts.size === 2 && pinchStart) { const z = pinchZoom * dist() / pinchStart; if (Math.abs(z - zoom) > 0.03) applyZoom(z); } });
  const pinchEnd = e => { pts.delete(e.pointerId); if (pts.size < 2) pinchStart = 0; };
  root.addEventListener('pointerup', pinchEnd); root.addEventListener('pointercancel', pinchEnd);

  async function openStream() {
    try {
      if (stream) stream.getTracks().forEach(t => t.stop());
      const video_c = { width: { ideal: 4032 }, height: { ideal: 3024 } };
      if (lens === 'ultra' && ultraId) video_c.deviceId = { exact: ultraId };
      else if (wideId) video_c.deviceId = { exact: wideId };
      else video_c.facingMode = { ideal: 'environment' };
      try { stream = await navigator.mediaDevices.getUserMedia({ video: video_c, audio: false }); }
      catch (e1) { lens = 'wide'; stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 4032 }, height: { ideal: 3024 } }, audio: false }); }
      video.srcObject = stream; track = stream.getVideoTracks()[0];
      track.onended = () => { if (document.visibilityState === 'visible') openStream(); };
      try { await video.play(); } catch (e) { /* autoplay */ }
      // Kameras merken (Labels gibt es erst nach der Freigabe)
      try {
        const set = track.getSettings?.() || {};
        if (lens === 'wide' && set.deviceId) wideId = set.deviceId;
        const devs = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput');
        const ultra = devs.find(d => /ultra/i.test(d.label) && !/front|vorder/i.test(d.label));
        if (ultra) ultraId = ultra.deviceId;
      } catch (e) { /* egal */ }
      const cap = track.getCapabilities?.() || {};
      hwZoom = (cap.zoom && cap.zoom.max > cap.zoom.min) ? { min: cap.zoom.min, max: cap.zoom.max } : null;
      digital = 1; video.style.transform = '';
      if (zoom > 1) await applyZoom(zoom); else drawZoom();
    } catch (e) { toast('Kamera nicht verfügbar: ' + e.message, 4000); }
  }
  await openStream();
  const onVis = () => { if (document.visibilityState === 'visible' && (!track || track.readyState !== 'live' || video.paused)) openStream(); };
  document.addEventListener('visibilitychange', onVis);

  startWatch();
  const offPos = onPosition(async (p) => {
    $('[data-r=gps]', root).textContent = p ? (p.coarse ? `GPS grob ±${p.acc} m` : `GPS ±${p.acc} m`) : 'GPS sucht …';
    if (p && !p.coarse && navigator.onLine && (Date.now() - (lastGeo || 0) > 8000)) {
      lastGeo = Date.now();
      const r = await reverseGeocode(p.lat, p.lon);
      if (r?.display) { lastStreet = r.display; $('[data-r=street]', root).textContent = '📍 ' + r.display; }
    }
  });
  let lastGeo = 0;

  async function grabFrame() {
    if (!video.videoWidth) return null;
    const vw = video.videoWidth, vh = video.videoHeight;
    const z = digital > 1 ? digital : 1;
    const sw = Math.round(vw / z), sh = Math.round(vh / z), sx = Math.round((vw - sw) / 2), sy = Math.round((vh - sh) / 2);
    const c = document.createElement('canvas'); c.width = sw; c.height = sh;
    c.getContext('2d').drawImage(video, sx, sy, sw, sh, 0, 0, sw, sh);
    return new Promise(r => c.toBlob(r, 'image/jpeg', 0.92));
  }
  function flash() { const f = $('.flash', root); f.classList.remove('on'); void f.offsetWidth; f.classList.add('on'); }

  async function makePunkt(blobs, opts = {}) {
    // Punkt sofort speichern; Standort wird nachgetragen, sobald ein Fix da ist (blockiert nie den Auslöser)
    const gps = lastPosition();
    const p = await model.addPunkt(ctx.protokoll.id, ctx.teil.id, {
      gps: gps ? { lat: gps.lat, lon: gps.lon, acc: gps.acc } : null,
      zeit: Date.now(),
      strasseVorschlag: lastStreet,
      nachpruefen: !!opts.flag,
      altRoute: !!ctx.altRoute,
      typ: 'strasse',
    });
    const zl = zoomLabel();
    for (const b of blobs) await model.addBild(p, b, zl !== '1×' ? { zoom: zl } : {});
    if (zl !== '1×') p.notiz = `Aufnahme mit ${zl} Zoom`;
    // erster Punkt eines Teils wird automatisch „Start"
    if (!opts.flag && (await model.countPunkte(ctx.protokoll.id, ctx.teil.id)) === 1) p.typ = 'start';
    await model.savePunkt(p);
    count++; lastPunktId = p.id;
    if (!gps || gps.coarse) nachtragenGps(p.id, Date.now());
    if (p.bilder[0]) { const im = $('[data-r=last]', root); im.src = await blobUrl(p.bilder[0].thumbId || p.bilder[0].blobId); im.classList.remove('hidden'); }
    setTeil();
    // Straße nachträglich holen, falls noch nicht da
    if (gps && !lastStreet && navigator.onLine) reverseGeocode(gps.lat, gps.lon).then(async r => { if (r?.display) { const q = await db.get('punkte', p.id); if (q && !q.strasseVorschlag) { q.strasseVorschlag = r.display; await db.put('punkte', q); } } });
    return p;
  }

  // Standort nachtragen: erster genauer Fix innerhalb von 45 s nach der Aufnahme
  function nachtragenGps(punktId, t0) {
    const off = onPosition(async (pos) => {
      if (!pos || Date.now() - t0 > 45000) { if (Date.now() - t0 > 45000) off(); return; }
      if (pos.coarse) return;
      off();
      const q = await db.get('punkte', punktId);
      if (q && (!q.gps || q.gps.acc === 0 || q.gps.acc > pos.acc)) { q.gps = { lat: pos.lat, lon: pos.lon, acc: pos.acc }; if (!q.strasseVorschlag && lastStreet) q.strasseVorschlag = lastStreet; await db.put('punkte', q); }
    });
    setTimeout(off, 46000);
  }

  // Auslöser: Tippen vs. Halten
  const shutter = $('[data-a=shutter]', root);
  let holdTimer = null, serie = null, pressed = false;
  shutter.addEventListener('pointerdown', e => {
    e.preventDefault(); pressed = true; shutter.classList.add('busy');
    holdTimer = setTimeout(async () => {
      if (!pressed) return;
      serie = { blobs: [] };
      const counter = $('[data-r=counter]', root); counter.classList.remove('hidden');
      while (pressed && serie.blobs.length < 12) {
        const b = await grabFrame(); if (b) serie.blobs.push(b);
        counter.textContent = `Serie ${serie.blobs.length}`; flash();
        await new Promise(r => setTimeout(r, 350));
      }
      counter.classList.add('hidden');
      const s = serie; serie = null;
      if (s.blobs.length) { try { await makePunkt(s.blobs); toast(`Serie mit ${s.blobs.length} Bildern gespeichert`); } catch (e) { toast('Speichern fehlgeschlagen: ' + e.message, 4000); } }
    }, 450);
  });
  const release = async () => {
    if (!pressed) return; pressed = false; shutter.classList.remove('busy');
    if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
    if (serie) return; // Serie beendet sich selbst
    try {
      const b = await grabFrame(); if (!b) { toast('Kein Kamerabild – Kamera wird neu gestartet'); openStream(); return; }
      flash(); await makePunkt([b]); toast(`Punkt ${count} gespeichert`, 1200);
    } catch (e) { toast('Speichern fehlgeschlagen: ' + e.message, 4000); }
  };
  shutter.addEventListener('pointerup', release);
  shutter.addEventListener('pointercancel', release);
  shutter.addEventListener('pointerleave', () => { if (pressed && !serie) release(); });

  // letztes Bild antippen → Schnellmenü
  $('[data-r=last]', root).onclick = async () => {
    if (!lastPunktId) return;
    const q = await db.get('punkte', lastPunktId); if (!q) return;
    sheet('Letzter Punkt', [
      { label: 'Stichwort diktieren / eintippen', onclick: async () => { const v = await promptSheet('Stichwort zum letzten Punkt', q.text || '', 'z. B. Brücke 4,35 m, Schild entfernen'); if (v != null) { q.text = v; await db.put('punkte', q); toast('Gespeichert'); } } },
      { label: q.typ === 'ziel' ? 'Ziel-Markierung entfernen' : 'Als Ziel markieren', onclick: async () => { q.typ = q.typ === 'ziel' ? 'strasse' : 'ziel'; await db.put('punkte', q); toast(q.typ === 'ziel' ? 'Als Ziel markiert' : 'Markierung entfernt'); } },
      { label: q.nachpruefen ? '⚑ Nachprüfen entfernen' : '⚑ Nachprüfen', onclick: async () => { q.nachpruefen = !q.nachpruefen; await db.put('punkte', q); } },
      { label: 'Letzten Punkt löschen (Fehlauslösung)', danger: true, onclick: async () => { if (await confirmSheet('Letzten Punkt löschen?', 'Löschen')) { await model.deletePunkt(q); lastPunktId = null; count = Math.max(0, count - 1); $('[data-r=last]', root).classList.add('hidden'); setTeil(); toast('Gelöscht'); } } },
    ]);
  };
  $('[data-a=flag]', root).onclick = async () => {
    try { const b = await grabFrame(); await makePunkt(b ? [b] : [], { flag: true }); toast('⚑ Nachprüf-Punkt gesetzt'); }
    catch (e) { toast('Speichern fehlgeschlagen: ' + e.message, 4000); }
  };
  const fileInp = $('[data-r=file]', root);
  $('[data-a=import]', root).onclick = () => fileInp.click();
  fileInp.onchange = async () => {
    const files = [...fileInp.files]; fileInp.value = '';
    let ok = 0;
    for (const f of files) { try { await importFoto(ctx, f); ok++; } catch (e) { toast('Bild nicht übernommen: ' + e.message, 3000); } }
    toast(`${ok} Bild(er) übernommen`); setTeil(); onVis();
  };
  $('[data-a=close]', root).onclick = close;
  $('[data-a=help]', root).onclick = () => infoSheet(HILFE.fahrmodus.titel, HILFE.fahrmodus.text);

  function close() {
    document.removeEventListener('visibilitychange', onVis);
    offPos(); stopWatch();
    if (stream) stream.getTracks().forEach(t => t.stop());
    root.remove(); onClose?.(count);
  }
}

// Bild aus der Fotothek: eigener Punkt, EXIF-Standort/-Zeit wenn vorhanden
export async function importFoto(ctx, file, extra = {}) {
  let gps = null, zeit = file.lastModified || Date.now();
  try {
    const ex = await window.exifr?.parse(file, { gps: true, pick: ['DateTimeOriginal', 'GPSLatitude', 'GPSLongitude', 'GPSLatitudeRef', 'GPSLongitudeRef'] });
    if (ex?.latitude && ex?.longitude) gps = { lat: ex.latitude, lon: ex.longitude, acc: 0 };
    if (ex?.DateTimeOriginal) zeit = new Date(ex.DateTimeOriginal).getTime();
  } catch (e) { /* kein EXIF */ }
  const p = await model.addPunkt(ctx.protokoll.id, ctx.teil.id, { gps, zeit, typ: 'strasse', altRoute: !!ctx.altRoute, quelle: 'fotothek', ...extra });
  const norm = await normalizePhoto(file, (await getStamm()).einstellungen?.fotoKlein ? 2500 : 4032);
  await model.addBild(p, norm, { name: file.name });
  await model.savePunkt(p);
  if (gps && navigator.onLine) reverseGeocode(gps.lat, gps.lon).then(async r => { if (r?.display) { const q = await db.get('punkte', p.id); if (q) { q.strasseVorschlag = r.display; await db.put('punkte', q); } } });
  return p;
}
