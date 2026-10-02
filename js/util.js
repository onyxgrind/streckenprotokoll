export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const h = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };

export function toast(msg, ms = 2200) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('show'), ms);
}

export const fmtDate = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
};
export const fmtTime = (ts) => { const d = new Date(ts); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
export const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
export const fmtCoord = (g) => g ? `${g.lat.toFixed(5)}, ${g.lon.toFixed(5)}` : '';
export const fmtNum = (v) => (v === '' || v == null) ? '–' : String(v).replace('.', ',');

export function sheet(title, options) {
  // options: [{label, danger, onclick}] ; returns promise resolving when closed
  return new Promise(res => {
    const bg = h(`<div class="sheet-bg"><div class="sheet">${title ? `<h2>${esc(title)}</h2>` : ''}</div></div>`);
    const sh = $('.sheet', bg);
    options.forEach(o => {
      const b = h(`<button class="opt ${o.danger ? 'danger' : ''}">${esc(o.label)}</button>`);
      b.onclick = async () => { close(); await o.onclick?.(); };
      sh.appendChild(b);
    });
    const c = h(`<button class="opt" style="text-align:center;font-weight:700">Abbrechen</button>`);
    c.onclick = close; sh.appendChild(c);
    bg.onclick = (e) => { if (e.target === bg) close(); };
    function close() { bg.remove(); res(); }
    document.body.appendChild(bg);
  });
}

export function confirmSheet(title, okLabel = 'Ja', danger = true) {
  return new Promise(res => {
    const bg = h(`<div class="sheet-bg"><div class="sheet"><h2>${esc(title)}</h2>
      <button class="opt ${danger ? 'danger' : ''}" style="font-weight:700">${esc(okLabel)}</button>
      <button class="opt" style="text-align:center">Abbrechen</button></div></div>`);
    const [ok, no] = $$('.opt', bg);
    ok.onclick = () => { bg.remove(); res(true); };
    no.onclick = () => { bg.remove(); res(false); };
    bg.onclick = (e) => { if (e.target === bg) { bg.remove(); res(false); } };
    document.body.appendChild(bg);
  });
}

export function promptSheet(title, value = '', placeholder = '', multiline = false) {
  return new Promise(res => {
    const bg = h(`<div class="sheet-bg"><div class="sheet"><h2>${esc(title)}</h2>
      <div class="field">${multiline ? `<textarea>${esc(value)}</textarea>` : `<input value="${esc(value)}" placeholder="${esc(placeholder)}">`}</div>
      <div class="btnrow"><button class="btn sec">Abbrechen</button><button class="btn">OK</button></div></div></div>`);
    const inp = $('input,textarea', bg);
    if (!multiline) { inp.setAttribute('enterkeyhint', 'done'); inp.setAttribute('autocapitalize', 'sentences'); }
    const [no, ok] = $$('.btn', bg);
    ok.onclick = () => { const v = inp.value; bg.remove(); res(v); };
    no.onclick = () => { bg.remove(); res(null); };
    inp.onkeydown = (e) => { if (e.key === 'Enter' && !multiline) { e.preventDefault(); ok.click(); } };
    document.body.appendChild(bg);
    setTimeout(() => inp.focus(), 50);
  });
}

// Hinweis-/Fehlerblatt: bleibt stehen, Text kopierbar. actions: [{label, onclick, primary}]
export function infoSheet(title, text, { details = '', actions = [], danger = false } = {}) {
  return new Promise(res => {
    const bg = h(`<div class="sheet-bg"><div class="sheet"><h2 style="${danger ? 'color:var(--red)' : ''}">${esc(title)}</h2>
      <div style="white-space:pre-wrap;font-size:16px;line-height:1.4;margin:6px 0 10px">${esc(text)}</div>
      ${details ? `<details style="margin-bottom:10px"><summary class="muted small">Technische Details</summary><pre style="white-space:pre-wrap;word-break:break-all;font-size:12px;background:#f3f3f3;border-radius:8px;padding:8px;max-height:160px;overflow:auto">${esc(details)}</pre></details>` : ''}
      <div class="btnrow" data-r="acts"></div></div></div>`);
    const acts = $('[data-r=acts]', bg);
    const close = () => { bg.remove(); res(); };
    if (details || text) { const cp = h(`<button class="btn sec">Kopieren</button>`); cp.onclick = () => { navigator.clipboard?.writeText(text + (details ? '\n\n' + details : '')).then(() => toast('Kopiert')).catch(() => toast('Kopieren nicht möglich')); }; acts.appendChild(cp); }
    actions.forEach(a => { const b = h(`<button class="btn ${a.primary ? '' : 'sec'}">${esc(a.label)}</button>`); b.onclick = async () => { close(); await a.onclick?.(); }; acts.appendChild(b); });
    const ok = h(`<button class="btn ${actions.some(a => a.primary) ? 'sec' : ''}">Schließen</button>`); ok.onclick = close; acts.appendChild(ok);
    bg.onclick = (e) => { if (e.target === bg) close(); };
    document.body.appendChild(bg);
  });
}

// Mehrere Felder in einem Sheet. fields: [{key,label,value,placeholder,type}] → Objekt oder null
export function formSheet(title, fields, okLabel = 'Speichern', { intro = '' } = {}) {
  return new Promise(res => {
    const inp = (f) => f.type === 'textarea' ? `<textarea data-k="${esc(f.key)}" placeholder="${esc(f.placeholder || '')}" autocapitalize="sentences" style="min-height:64px">${esc(f.value ?? '')}</textarea>` : `<input type="${f.type || 'text'}" data-k="${esc(f.key)}" value="${esc(f.value ?? '')}" placeholder="${esc(f.placeholder || '')}" ${f.inputmode ? `inputmode="${f.inputmode}"` : ''} autocapitalize="sentences">`;
    const bg = h(`<div class="sheet-bg"><div class="sheet" style="max-height:88vh;overflow:auto"><h2>${esc(title)}</h2>${intro ? `<div class="muted small" style="margin:-4px 0 10px;white-space:pre-wrap">${esc(intro)}</div>` : ''}${fields.map(f => f.section ? `<div style="font-weight:700;font-size:13px;margin:12px 0 6px;color:#555">${esc(f.section)}</div>` : `<div class="field"><label>${esc(f.label)}</label>${inp(f)}</div>`).join('')}
      <div class="btnrow"><button class="btn sec">Abbrechen</button><button class="btn">${esc(okLabel)}</button></div></div></div>`);
    const [no, ok] = $$('.btn', bg);
    ok.onclick = () => { const out = {}; $$('[data-k]', bg).forEach(i => out[i.dataset.k] = i.value); bg.remove(); res(out); };
    no.onclick = () => { bg.remove(); res(null); };
    bg.onclick = (e) => { if (e.target === bg) { bg.remove(); res(null); } };
    document.body.appendChild(bg);
    if (fields.length <= 3) setTimeout(() => $('input', bg)?.focus(), 50);
  });
}

export async function loadImage(src) {
  return new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = src; });
}

export async function blobToDataURL(blob) {
  return new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(blob); });
}

// Bild auf max Kantenlänge verkleinern → JPEG-Blob
export async function resizeBlob(blob, maxSide = 1600, quality = 0.86) {
  const url = URL.createObjectURL(blob);
  try {
    const im = await loadImage(url);
    const s = Math.min(1, maxSide / Math.max(im.naturalWidth, im.naturalHeight));
    const w = Math.round(im.naturalWidth * s), hh = Math.round(im.naturalHeight * s);
    const c = document.createElement('canvas'); c.width = w; c.height = hh;
    c.getContext('2d').drawImage(im, 0, 0, w, hh);
    const b = await new Promise(r => c.toBlob(r, 'image/jpeg', quality));
    if (!b) throw new Error('Bild konnte nicht verkleinert werden');
    return b;
  } finally { URL.revokeObjectURL(url); }
}

export function downloadBlob(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
}

export async function shareFiles(files, title) {
  if (navigator.canShare && navigator.canShare({ files })) {
    try { await navigator.share({ files, title }); return true; } catch (e) { if (e.name === 'AbortError') return true; }
  }
  files.forEach(f => downloadBlob(f, f.name));
  return false;
}

export const safeName = (s) => String(s || '').replace(/[^\wäöüÄÖÜß\- ]+/g, '').trim().replace(/\s+/g, '_').slice(0, 60);

// Bild mit Drehung (0/90/180/270) als Image-Objekt liefern
export async function loadOriented(src, rot = 0) {
  const im = await loadImage(src);
  if (!rot) return im;
  const c = document.createElement('canvas');
  const swap = rot === 90 || rot === 270;
  c.width = swap ? im.naturalHeight : im.naturalWidth; c.height = swap ? im.naturalWidth : im.naturalHeight;
  const ctx = c.getContext('2d');
  ctx.translate(c.width / 2, c.height / 2); ctx.rotate(rot * Math.PI / 180); ctx.drawImage(im, -im.naturalWidth / 2, -im.naturalHeight / 2);
  const out = await loadImage(c.toDataURL('image/jpeg', 0.92));
  return out;
}
// Formen-Koordinaten bei 90°-Drehung im Uhrzeigersinn mitdrehen (w,h = Bildmaße VOR der Drehung)
// Zuschnitt: {x,y,w,h} als Anteile (0..1) des (gedrehten) Bildes. Formen bleiben in Bildpixeln des ganzen Bildes.
export function rotateCrop(c) { return c ? { x: 1 - (c.y + c.h), y: c.x, w: c.h, h: c.w } : c; }
export async function applyCrop(img, crop) {
  if (!crop || (crop.x <= 0.001 && crop.y <= 0.001 && crop.w >= 0.999 && crop.h >= 0.999)) return { img, ox: 0, oy: 0 };
  const W = img.naturalWidth, H = img.naturalHeight;
  const ox = Math.round(crop.x * W), oy = Math.round(crop.y * H), w = Math.max(8, Math.round(crop.w * W)), h = Math.max(8, Math.round(crop.h * H));
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  c.getContext('2d').drawImage(img, ox, oy, w, h, 0, 0, w, h);
  return { img: await loadImage(c.toDataURL('image/jpeg', 0.93)), ox, oy };
}
export const shiftShapes = (shapes, dx, dy) => (shapes || []).map(s => ({ ...s, points: s.points.map(p => ({ x: p.x + dx, y: p.y + dy })) }));

export function rotateShapes(shapes, w, h) {
  return (shapes || []).map(s => ({ ...s, points: s.points.map(p => ({ x: h - p.y, y: p.x })) }));
}

// Foto aus der Fotothek normalisieren: EXIF-Drehung einbacken, als JPEG ohne EXIF speichern (max 4032 px)
export async function normalizePhoto(file, maxSide = 4032) {
  if (!/^image\//.test(file.type)) return file;
  const url = URL.createObjectURL(file);
  try {
    const im = await loadImage(url); // Browser wendet EXIF-Orientierung beim Dekodieren an
    const s = Math.min(1, maxSide / Math.max(im.naturalWidth, im.naturalHeight));
    const c = document.createElement('canvas'); c.width = Math.round(im.naturalWidth * s); c.height = Math.round(im.naturalHeight * s);
    c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.92));
    return blob || file;
  } catch (e) { return file; } // z. B. HEIC ohne Decoder → Original behalten
  finally { URL.revokeObjectURL(url); }
}
