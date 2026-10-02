import { db, uid, blobUrl, forgetUrl, getStamm, saveStamm, DEFAULTS } from './db.js';
import { model, neuerTeil, teilName } from './model.js';
import { $, $$, esc, h, toast, fmtDate, fmtTime, fmtCoord, sheet, confirmSheet, promptSheet, formSheet, infoSheet, loadImage, loadOriented, rotateShapes, rotateCrop, applyCrop, shiftShapes, normalizePhoto, downloadBlob, shareFiles, resizeBlob } from './util.js';
import { openFahrmodus, importFoto } from './camera.js';
import { openEditor, openCrop } from './draw.js';
import { mapsLinks, copyText, miniMap, reverseGeocode } from './geo.js';
import { buildPdf, buildDocx, buildZip, dateiname } from './export.js';
import * as ai from './ai.js';
import { buildFahrtPaket, readFahrtPaket, importFahrtPaket, PAKET_ENDUNG } from './paket.js';
import { HILFE, installieren, istInstalliert } from './hilfe.js';

const app = document.getElementById('app');
const ICON = {
  fahrten: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="16" rx="3"/><path d="M7 9h10M7 13h6"/></svg>',
  stamm: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
};

// ---------- Router ----------
const stack = [];
let renderSeq = 0;
const pendingSaves = new Set(); // Debounce-Timer offener Feld-Speicherungen
function flushSaves() { for (const fn of [...pendingSaves]) { try { fn(); } catch (e) { /* ignorieren */ } } pendingSaves.clear(); }
function go(view, params = {}, replace = false) {
  flushSaves();
  if (replace) { stack.pop(); stack.push({ view, params }); history.replaceState({ depth: stack.length }, ''); }
  else { stack.push({ view, params }); history.pushState({ depth: stack.length }, ''); }
  render();
}
function goRoot(view) { flushSaves(); stack.length = 0; stack.push({ view, params: {} }); history.replaceState({ depth: 1 }, ''); render(); }
function back() { flushSaves(); if (stack.length > 1) history.back(); }
window.addEventListener('popstate', (e) => {
  flushSaves();
  const depth = e.state?.depth || 1;
  if (depth < stack.length) { stack.length = Math.max(1, depth); render(); }
  else if (depth > stack.length) { history.replaceState({ depth: stack.length }, ''); }
});
let lastKey = '';
async function render() {
  const seq = ++renderSeq;
  const cur = stack[stack.length - 1];
  const key = cur.view + JSON.stringify(cur.params);
  const keepScroll = key === lastKey ? ($('.content', app)?.scrollTop || 0) : 0;
  try {
    try { MA = (await getStamm()).einstellungen?.modus === 'mitarbeiter'; } catch (e) { MA = false; }
    const el = await views[cur.view](cur.params);
    if (seq !== renderSeq) return; // eine neuere Ansicht ist schon unterwegs
    disposeMaps(); app.innerHTML = ''; app.appendChild(el); lastKey = key;
    if (keepScroll) { const ct = $('.content', el); if (ct) ct.scrollTop = keepScroll; }
  } catch (e) {
    console.error(e);
    if (seq !== renderSeq) return;
    app.innerHTML = '';
    const err = h(`<div class="screen"><div class="content nofoot"><div class="centerbox"><div class="big">⚠️</div><b>Diese Ansicht konnte nicht geladen werden.</b><div class="muted small" style="margin:8px 0 16px">${esc(e.message || e)}</div><button class="btn sec">Zurück zur Übersicht</button></div></div></div>`);
    $('.btn', err).onclick = () => goRoot('fahrten');
    app.appendChild(err);
  }
}
let MA = false; // Mitarbeiter-Modus: reduzierte Oberfläche
const refresh = () => render();
const liveMaps = [];
function trackMap(map) { if (map) liveMaps.push(map); }
function disposeMaps() { while (liveMaps.length) { try { liveMaps.pop().remove(); } catch (e) { /* schon weg */ } } }
window.addEventListener('unhandledrejection', (e) => { console.error(e.reason); const msg = e.reason?.message || String(e.reason); toast('Fehler: ' + (msg.length > 90 ? msg.slice(0, 88) + '…' : msg), 4000); });
window.addEventListener('error', (e) => { if (e.message) toast('Fehler: ' + e.message.slice(0, 90), 4000); });

function screen({ title, back: hasBack = true, action, actionFn, dark = false, tabbar = null, nofoot = false, help = '' }) {
  const s = h(`<div class="screen ${dark ? 'dark' : ''}">
    <div class="topbar">${hasBack ? '<button class="back">‹ Zurück</button>' : '<span style="width:60px"></span>'}<div class="title">${esc(title)}</div><div class="tbr">${help ? '<button class="help" title="Hilfe">?</button>' : ''}${action ? `<button class="action">${esc(action)}</button>` : ''}</div></div>
    <div class="content ${nofoot ? 'nofoot' : ''}"></div></div>`);
  if (hasBack) $('.back', s).onclick = back;
  if (action) $('.action', s).onclick = actionFn;
  if (help) $('.help', s).onclick = () => hilfe(help);
  if (tabbar) {
    s.appendChild(h(`<div class="tabbar">
      <button data-v="fahrten" class="${tabbar === 'fahrten' ? 'on' : ''}">${ICON.fahrten}Fahrten</button>
      <button data-v="stamm" class="${tabbar === 'stamm' ? 'on' : ''}">${ICON.stamm}Stammdaten</button></div>`));
    $$('.tabbar button', s).forEach(b => b.onclick = () => goRoot(b.dataset.v));
  }
  return s;
}
const content = (s) => $('.content', s);

// Eingabefeld-Helfer: bindet an Objektpfad und speichert
function field(obj, key, label, { type = 'text', placeholder = '', textarea = false, onSave, hint = '', inputmode } = {}) {
  const f = h(`<div class="field"><label>${esc(label)}</label>${textarea ? `<textarea placeholder="${esc(placeholder)}">${esc(obj[key] ?? '')}</textarea>` : `<input type="${type}" ${inputmode ? `inputmode="${inputmode}"` : ''} placeholder="${esc(placeholder)}" value="${esc(obj[key] ?? '')}">`}${hint ? `<div class="hint">${esc(hint)}</div>` : ''}</div>`);
  const inp = $('input,textarea', f);
  let t; const doSave = () => { clearTimeout(t); pendingSaves.delete(doSave); onSave?.(); };
  inp.oninput = () => { obj[key] = inp.value; clearTimeout(t); pendingSaves.add(doSave); t = setTimeout(doSave, 350); };
  inp.onblur = doSave;
  if (textarea) { inp.setAttribute('autocapitalize', 'sentences'); const grow = () => { inp.style.height = 'auto'; inp.style.height = Math.max(88, inp.scrollHeight + 4) + 'px'; }; inp.addEventListener('input', grow); requestAnimationFrame(grow); }
  return f;
}
function toggle(label, val, onChange, sub = '') {
  const t = h(`<button class="toggle tap"><div><div>${esc(label)}</div>${sub ? `<div class="muted small">${esc(sub)}</div>` : ''}</div><div class="sw ${val ? 'on' : ''}"></div></button>`);
  t.onclick = () => { val = !val; $('.sw', t).classList.toggle('on', val); onChange(val); };
  return t;
}
// KI-Fehler verständlich anzeigen (bleibt stehen, kopierbar, Sprung zu den Einstellungen)
function kiFehler(e) {
  const acts = [];
  if (['key', 'credit', 'model', 'workspace'].includes(e.code)) acts.push({ label: 'Stammdaten → KI öffnen', primary: true, onclick: () => go('stamm', { scroll: 'ki' }) });
  const details = [e.status ? `HTTP ${e.status}` : '', e.raw || ''].filter(Boolean).join('\n');
  return infoSheet('KI-Funktion fehlgeschlagen', e.message || String(e), { details, actions: acts, danger: true });
}
function hilfe(key) {
  const t = HILFE[key]; if (!t) return;
  return infoSheet(t.titel, t.text, { actions: [{ label: 'Alle Hilfe-Themen', onclick: () => go('hilfe') }] });
}
// Einspielen: EIN Knopf für alles. Erkennt Sicherung, Fahrt-Paket und Ergebnis-ZIP selbst.
function fahrtEmpfangen() { return dateiEinspielen(); }
function dateiEinspielen() {
  const inp = h(`<input type="file" class="hidden">`); // ohne accept: iOS graut sonst manche ZIPs aus
  document.body.appendChild(inp);
  inp.onchange = async () => {
    const file = inp.files[0]; inp.remove(); if (!file) return;
    const lade = h(`<div class="sheet-bg"><div class="sheet"><h2>Datei wird gelesen …</h2><div class="muted small"><span class="spinner" style="border-color:#ccc;border-top-color:#333"></span>${esc(file.name)} · ${fmtMB(file.size)}</div></div></div>`);
    document.body.appendChild(lade);
    let zip;
    try { zip = await JSZip.loadAsync(file); }
    catch (e) { lade.remove(); return infoSheet('Das ist keine ZIP-Datei', `„${file.name}“ kann nicht eingespielt werden.\n\nEinspielen geht mit:\n• Sicherung: Streckenprotokoll_Sicherung_….zip\n• Fahrt-Paket: Fahrt_….strecke.zip\n\nTipp iPhone: Wenn „Dateien“ die ZIP beim Antippen entpackt hat, die ursprüngliche .zip-Datei wählen (nicht den Ordner).`, { danger: true }); }
    lade.remove();
    const names = Object.keys(zip.files);
    const find = (n) => names.find(p => p === n || p.endsWith('/' + n));
    try {
      if (find('paket.json') && !find('daten.json')) return await paketEinspielen(zip);
      const dj = find('daten.json');
      if (dj) return await sicherungEinspielen(zip, dj.slice(0, dj.length - 'daten.json'.length));
      if (names.some(n => /\.(pdf|docx)$/i.test(n))) return infoSheet('Das ist ein fertiges Protokoll', `„${file.name}“ enthält PDF/Word und Originalfotos – das ist das Ergebnis zum Versenden, keine Sicherung. Die Daten der App stecken darin nicht.\n\nEinspielen geht mit „Sicherung exportieren“ (Stammdaten) oder „Fahrt senden“ (Fahrt → Mehr).`);
      infoSheet('Unbekannte ZIP-Datei', `In „${file.name}“ ist weder eine Sicherung noch ein Fahrt-Paket.`, { danger: true });
    } catch (e) { infoSheet('Einspielen fehlgeschlagen', e.message || String(e), { danger: true }); }
  };
  inp.click();
}
async function paketEinspielen(zip) {
  const r = await readFahrtPaket(zip);
  const f = r.meta.fahrt;
  const info = `${f.titel || 'Fahrt'} · ${f.kunde?.firma || ''} · ${fmtDate(f.datum)}\n${r.punkte} Punkte, ${r.fotos} Fotos${r.meta.von ? `\nvon ${r.meta.von}` : ''}, gepackt ${fmtDate(r.meta.exportiert)}`;
  let modus = 'neu';
  if (r.vorhanden) {
    let pick = null;
    await sheet(`Fahrt-Paket – diese Fahrt gibt es hier schon.\n${info}`, [
      { label: 'Vorhandene ersetzen (Stand aus dem Paket gilt)', danger: true, onclick: () => { pick = 'ersetzen'; } },
      { label: 'Als Kopie danebenlegen', onclick: () => { pick = 'kopie'; } },
    ]);
    if (!pick) return; modus = pick;
  } else if (!(await confirmSheet(`Fahrt-Paket einspielen?\n${info}`, 'Einspielen', false))) return;
  toast('Wird eingespielt …', 3000);
  const res = await importFahrtPaket(r, modus);
  toast(`Eingespielt: ${res.punkte} Punkte, ${res.dateien} Dateien`, 3000);
  goRoot('fahrten'); go('fahrt', { id: res.fahrtId });
}
async function sicherungEinspielen(zip, prefix = '') {
  const data = JSON.parse(await zip.file(prefix + 'daten.json').async('string'));
  if (!Array.isArray(data.fahrten)) throw new Error('Die Sicherung ist unvollständig (keine Fahrten enthalten).');
  const vorhanden = new Set((await db.all('fahrten')).map(f => f.id));
  const neu = data.fahrten.filter(f => !vorhanden.has(f.id)).length;
  const info = `Sicherung vom ${fmtDate(data.exportiert)}: ${data.fahrten.length} Fahrten (${neu} neu, ${data.fahrten.length - neu} schon vorhanden), ${(data.punkte || []).length} Punkte.\n\nNeue Fahrten kommen dazu, vorhandene werden auf den Stand der Sicherung gebracht. Gelöscht wird nichts.`;
  if (!(await confirmSheet(info, 'Einspielen', false))) return;
  const lade = h(`<div class="sheet-bg"><div class="sheet"><h2>Wird eingespielt …</h2><div class="muted small" data-r="s"></div></div></div>`); document.body.appendChild(lade);
  try {
    for (const x of data.fahrten) await db.put('fahrten', x);
    for (const x of data.protokolle || []) await db.put('protokolle', x);
    for (const x of data.punkte || []) await db.put('punkte', x);
    const meta = Object.fromEntries((data.blobs || []).map(b => [b.id, b]));
    const files = Object.entries(zip.files).filter(([path, file]) => !file.dir && path.startsWith(prefix + 'blobs/'));
    let n = 0;
    for (const [path, file] of files) {
      const base = path.slice((prefix + 'blobs/').length); const id = base.split('.')[0]; const ext = base.includes('.') ? base.split('.').pop() : '';
      const mt = meta[id];
      const type = mt?.type || (ext === 'pdf' ? 'application/pdf' : ext === 'png' ? 'image/png' : ext === 'heic' ? 'image/heic' : 'image/jpeg');
      const buf = await file.async('arraybuffer');
      await db.put('blobs', { id, buf, type, size: buf.byteLength, name: mt?.name, punktId: mt?.punktId, createdAt: Date.now() }); n++;
      if (n % 10 === 0) $('[data-r=s]', lade).textContent = `${n} von ${files.length} Dateien`;
    }
    if (data.stamm) {
      const st = await getStamm();
      const ein = { ...(data.stamm.einstellungen || {}), modus: st.einstellungen.modus, pin: st.einstellungen.pin, maIntroDone: st.einstellungen.maIntroDone };
      await saveStamm({ ...st, ...data.stamm, einstellungen: { ...st.einstellungen, ...ein }, apiKey: st.apiKey || '', aiWorkspace: st.aiWorkspace || data.stamm.aiWorkspace || '' });
    }
    lade.remove();
    toast(`Eingespielt: ${data.fahrten.length} Fahrten, ${(data.punkte || []).length} Punkte, ${n} Dateien`, 3500);
    goRoot('fahrten');
  } catch (e) { lade.remove(); throw e; }
}
// Fahrt als Paket teilen
async function fahrtSenden(fahrtId) {
  const st = h(`<div class="sheet-bg"><div class="sheet"><h2>Fahrt-Paket</h2><div class="muted small" data-r="s"><span class="spinner" style="border-color:#ccc;border-top-color:#333"></span>Fotos werden verkleinert und gepackt …</div></div></div>`);
  document.body.appendChild(st);
  try {
    const r = await buildFahrtPaket(fahrtId, { onProgress: () => {} });
    st.remove();
    const file = new File([r.blob], r.name, { type: 'application/zip' });
    await infoSheet('Paket fertig', `${r.punkte} Punkte, ${r.fotos} Fotos · ${fmtMB(r.size)}\n\nPer WhatsApp, AirDrop oder Mail schicken. Der Empfänger öffnet es in der App über Menü ⋯ → „Einspielen“.`, { actions: [{ label: 'Teilen / Speichern', primary: true, onclick: () => shareFiles([file], r.name) }] });
  } catch (e) { st.remove(); infoSheet('Paket konnte nicht erstellt werden', e.message || String(e), { danger: true }); }
}
const fmtMB = (b) => `${(b / 1024 / 1024).toFixed(b > 10 * 1024 * 1024 ? 0 : 1)} MB`;
function bausteinChips(list, onPick, extra = []) {
  const wrap = h(`<div class="chipscroll"></div>`);
  extra.forEach(x => { const c = h(`<button class="chip ${x.cls || ''}">${esc(x.label)}</button>`); c.onclick = x.onclick; wrap.appendChild(c); });
  if (list.length) { const all = h(`<button class="chip" style="background:#111;color:#fff">📋 Bausteine …</button>`); all.onclick = () => bausteinSheet(list, onPick); wrap.appendChild(all); }
  list.slice(0, 8).forEach(b => { const c = h(`<button class="chip">${esc(b.length > 34 ? b.slice(0, 32) + '…' : b)}</button>`); c.onclick = () => onPick(b); wrap.appendChild(c); });
  return wrap;
}
function bausteinSheet(list, onPick) {
  const bg = h(`<div class="sheet-bg"><div class="sheet"><h2>Textbaustein wählen</h2><input class="search" placeholder="Suchen …"><div data-r="l"></div><button class="opt" style="text-align:center;font-weight:700">Abbrechen</button></div></div>`);
  const l = $('[data-r=l]', bg), inp = $('input', bg);
  const draw = (q = '') => { l.innerHTML = ''; list.filter(b => b.toLowerCase().includes(q.toLowerCase())).forEach(b => { const o = h(`<button class="opt" style="font-size:15px;line-height:1.35">${esc(b)}</button>`); o.onclick = () => { bg.remove(); onPick(b); }; l.appendChild(o); }); };
  inp.oninput = () => draw(inp.value); draw();
  $('.opt:last-child', bg).onclick = () => bg.remove();
  bg.onclick = (e) => { if (e.target === bg) bg.remove(); };
  document.body.appendChild(bg);
}
// gemeinsamer Fahrt-Titel für Liste und Detail
function fahrtTitel(f, prs) { return f.titel || [f.kunde?.firma?.split(' ')[0], prs?.[0]?.teile?.[0]?.ziel?.replace(/\{.*\}/, '').split(',').pop()?.trim()].filter(Boolean).join(' · ') || 'Neue Fahrt'; }
const appendText = (obj, key, add) => { const cur = (obj[key] || '').trim(); obj[key] = cur ? (cur.endsWith('.') || cur.endsWith(',') ? cur + ' ' : cur + ', ') + add : add; };

// nächste freie Teil-Nummer (1.1, 1.2 …)
const nextNr = (p) => { const n = Math.max(0, ...p.teile.map(t => parseInt(String(t.nr).split('.')[1]) || 0)); return `1.${n + 1}`; };

// =====================================================================
const views = {};

// ---------- Fahrten ----------
views.fahrten = async () => {
  const s = screen({ title: 'Streckenprotokoll', back: false, tabbar: 'fahrten', nofoot: false, help: 'fahrten', action: '⋯', actionFn: () => sheet('Fahrten', [
    { label: '📥 Einspielen (Sicherung oder Fahrt-Paket)', onclick: dateiEinspielen },
    { label: '❓ Hilfe', onclick: () => go('hilfe') },
  ]) });
  const c = content(s);
  const fahrten = await model.fahrten();
  if (MA) { const stx = await getStamm(); if (!stx.einstellungen.maIntroDone) { stx.einstellungen.maIntroDone = true; await saveStamm(stx); setTimeout(() => infoSheet(HILFE.mitarbeiter.titel, HILFE.mitarbeiter.text, { actions: [{ label: 'Los geht’s', primary: true }] }), 300); } }
  c.appendChild(h(`<div class="row" style="margin-top:6px"><h1>Fahrten</h1><button class="btn small" data-a="neu">＋ Neu</button></div>`));
  $('[data-a=neu]', c).onclick = async () => { const f = await model.neueFahrt(); go('fahrt', { id: f.id }); };
  const search = h(`<input class="search" placeholder="Suchen (Kunde, Ziel, Datum) …">`); c.appendChild(search);
  const list = h(`<div></div>`); c.appendChild(list);
  const protoByFahrt = {};
  for (const f of fahrten) protoByFahrt[f.id] = await model.protokolle(f.id);
  const punkteCount = {};
  for (const f of fahrten) punkteCount[f.id] = (await db.byIndex('punkte', 'fahrtId', f.id)).length;
  const draw = (q = '') => {
    list.innerHTML = '';
    const ql = q.toLowerCase();
    const hay = (f) => [f.titel, f.kunde?.firma, f.kunde?.plzOrt, fmtDate(f.datum), f.notiz, ...protoByFahrt[f.id].flatMap(p => [p.titel, p.empfaenger?.firma, ...p.teile.flatMap(t => [t.start, t.ziel, t.strecke])])].join(' ').toLowerCase();
    const rows = fahrten.filter(f => !q || hay(f).includes(ql));
    if (!rows.length) list.appendChild(h(`<div class="centerbox"><div class="big">🛣</div>${fahrten.length ? 'Nichts gefunden.' : 'Noch keine Fahrt. Oben rechts „Neu“ tippen.'}</div>`));
    for (const f of rows) {
      const prs = protoByFahrt[f.id];
      const offen = (f.checkliste || []).filter(x => !x.done && !x.optional);
      const st = f.status === 'versendet' ? '<span class="pill p-send">Versendet</span>' : f.status === 'erzeugt' ? '<span class="pill p-ok">Erzeugt</span>' : '<span class="pill p-ent">Entwurf</span>';
      const titel = fahrtTitel(f, prs);
      const card = h(`<button class="card tap"><div class="row"><h2 class="grow" style="margin:0">${esc(titel)}</h2>${st}</div>
        <div class="muted" style="margin-top:6px">${fmtDate(f.datum)} · ${prs.length} Protokoll${prs.length === 1 ? '' : 'e'}${prs.length > 1 ? ' (' + prs.map(p => p.teile.map(t => esc(t.nr)).join('/')).join(', ') + ')' : ''} · ${punkteCount[f.id]} Punkte</div>
        ${offen.length ? `<div class="warn">⚠ Offen: ${esc(offen.map(o => o.label).join(', '))}</div>` : ''}</button>`);
      card.onclick = () => go('fahrt', { id: f.id });
      list.appendChild(card);
    }
  };
  search.oninput = () => draw(search.value);
  draw();
  return s;
};

// ---------- Fahrt ----------
views.fahrt = async ({ id }) => {
  const f = await db.get('fahrten', id);
  if (!f) { back(); return h('<div></div>'); }
  const prs = await model.protokolle(id);
  const stamm = await getStamm();
  const save = () => model.saveFahrt(f);
  const titelF = fahrtTitel(f, prs);
  const s = screen({ title: titelF, help: 'fahrt', action: 'Mehr', actionFn: () => sheet('Fahrt', [
    { label: '📤 Fahrt senden (Paket für Kollegen / Zentrale)', onclick: () => fahrtSenden(id) },
    { label: 'Umbenennen', onclick: async () => { const v = await promptSheet('Titel der Fahrt', f.titel, 'z. B. Bender · Bremen'); if (v != null) { f.titel = v; await save(); refresh(); } } },
    { label: f.status === 'versendet' ? 'Als Entwurf markieren' : 'Als versendet markieren', onclick: async () => { f.status = f.status === 'versendet' ? 'entwurf' : 'versendet'; await save(); refresh(); } },
    { label: 'Fahrt löschen', danger: true, onclick: async () => { if (await confirmSheet('Fahrt mit allen Protokollen und Fotos löschen?', 'Löschen')) { await model.deleteFahrt(id); back(); } } },
  ]) });
  const c = content(s);
  const h1 = h(`<button class="tap"><h1>${esc(titelF)} <span class="muted" style="font-size:16px;font-weight:500">✎</span></h1></button>`);
  h1.onclick = async () => { const v = await promptSheet('Titel der Fahrt', f.titel || titelF, 'z. B. Bender · Bremen'); if (v != null) { f.titel = v; await save(); refresh(); } };
  c.appendChild(h1);

  // Kunde
  const kc = h(`<div class="card"><h2>Auftraggeber / Empfänger</h2></div>`);
  const kundenChips = h(`<div class="chipscroll"></div>`);
  stamm.kunden.slice(0, 12).forEach(k => { const ch = h(`<button class="chip">${esc(k.firma)}</button>`); ch.onclick = async () => { f.kunde = { ...k }; for (const p of prs) { p.empfaenger = { ...k }; await model.saveProtokoll(p); } await save(); refresh(); }; kundenChips.appendChild(ch); });
  if (stamm.kunden.length) kc.appendChild(kundenChips);
  const kundeVorher = JSON.stringify(f.kunde);
  const syncEmpf = async () => { await save(); for (const p of prs) { if (!p.empfaenger?.firma || JSON.stringify(p.empfaenger) === kundeVorher || JSON.stringify(p.empfaenger) === JSON.stringify(f.kunde)) { p.empfaenger = { ...f.kunde }; await model.saveProtokoll(p); } } };
  kc.appendChild(field(f.kunde, 'firma', 'Firma', { placeholder: 'Spedition …', onSave: syncEmpf }));
  kc.appendChild(field(f.kunde, 'strasse', 'Straße', { onSave: syncEmpf }));
  kc.appendChild(field(f.kunde, 'plzOrt', 'PLZ Ort', { onSave: syncEmpf }));
  const saveK = h(`<button class="btn sec" style="padding:10px;font-size:14px">Als Kunde speichern</button>`);
  saveK.onclick = async () => { if (!f.kunde.firma) return toast('Firma fehlt'); const st = await getStamm(); st.kunden = st.kunden.filter(k => k.firma !== f.kunde.firma); st.kunden.unshift({ ...f.kunde }); await saveStamm(st); toast('Kunde gespeichert'); };
  kc.appendChild(saveK);
  kc.appendChild(field(f, 'datum', 'Datum', { type: 'date', onSave: async () => { await save(); for (const p of prs) { p.datum = f.datum; await model.saveProtokoll(p); } } }));
  c.appendChild(kc);

  // Unterlagen: Antrag, Ablehnung, Auflagen, früheres Protokoll (Hinweg) …
  f.unterlagen = f.unterlagen || [];
  if (f.antragBlobId) { f.unterlagen.push({ id: uid(), blobId: f.antragBlobId, name: f.antragName || 'Antrag.pdf' }); f.antragBlobId = ''; f.antragName = ''; await save(); }
  const ac = h(`<div class="card"><div class="row"><h2 style="margin:0">Unterlagen</h2><button class="chip" data-a="add" style="background:#111;color:#fff">＋ Datei</button></div><div class="muted small" style="margin:4px 0 8px">Antrag, Ablehnung/Auflagen der Behörde, früheres Protokoll (z. B. Hinweg) – PDF oder Foto. Angehakte Dateien liest die KI aus: Empfänger, Start, Ziel, Strecke, Besonderheiten, Maße.</div><div data-r="list"></div></div>`);
  const uInp = h(`<input type="file" accept="application/pdf,image/*" multiple class="hidden">`); ac.appendChild(uInp);
  $('[data-a=add]', ac).onclick = () => uInp.click();
  uInp.onchange = async () => { for (const file of [...uInp.files]) { const blobId = await db.putBlob(file, { name: file.name }); f.unterlagen.push({ id: uid(), blobId, name: file.name, type: file.type, size: file.size, ki: true }); } uInp.value = ''; await save(); refresh(); };
  const ul = $('[data-r=list]', ac);
  let sizeFix = false;
  for (const u of f.unterlagen) {
    if (u.size == null) { const rec = await db.get('blobs', u.blobId); u.size = rec?.size || rec?.buf?.byteLength || 0; if (!u.type && rec?.type) u.type = rec.type; sizeFix = true; }
    const on = u.ki !== false;
    const row = h(`<div class="check"><button class="chip" data-a="ki" style="min-width:44px;${on ? 'background:#111;color:#fff' : ''}">${on ? '☑' : '☐'}</button><button class="grow small tap" data-a="open" style="text-align:left">${u.type?.startsWith('image') ? '🖼' : '📄'} ${esc(u.name)}<div class="muted small">${fmtMB(u.size || 0)}${on ? ' · KI liest mit' : ' · nicht lesen'}</div></button><button class="chip" data-a="del">✕</button></div>`);
    $('[data-a=ki]', row).onclick = async () => { u.ki = !on; await save(); refresh(); };
    $('[data-a=open]', row).onclick = async () => { const b = await db.getBlob(u.blobId); if (!b) return toast('Datei nicht gefunden'); shareFiles([new File([b], u.name, { type: b.type || 'application/pdf' })], u.name); };
    $('[data-a=del]', row).onclick = async () => { if (!(await confirmSheet(`„${u.name}" entfernen?`, 'Entfernen'))) return; await db.del('blobs', u.blobId); f.unterlagen = f.unterlagen.filter(x => x.id !== u.id); await save(); refresh(); };
    ul.appendChild(row);
  }
  if (sizeFix) await save();
  if (f.unterlagen.length) {
    const sel = f.unterlagen.filter(u => u.ki !== false);
    const bytes = sel.reduce((a, u) => a + ((u.type || '').includes('pdf') || /\.pdf$/i.test(u.name) ? (u.size || 0) : 400 * 1024), 0);
    const zuGross = bytes > ai.MAX_BYTES;
    const kiBtn = h(`<button class="btn ${zuGross || !sel.length ? 'sec' : ''}" style="margin-top:8px">✨ Daten aus ${sel.length} ${sel.length === 1 ? 'Datei' : 'Dateien'} übernehmen · ${fmtMB(bytes)}</button>`);
    if (zuGross) ac.appendChild(h(`<div class="err">Zusammen zu groß für eine KI-Anfrage (max. ca. ${fmtMB(ai.MAX_BYTES)}). Dateien abhaken und nacheinander lesen lassen.</div>`));
    kiBtn.onclick = async () => {
      if (!sel.length) return toast('Keine Datei angehakt');
      if (!stamm.apiKey) { infoSheet('KI-Schlüssel fehlt', 'Für das automatische Auslesen braucht die App einen Anthropic-API-Schlüssel. Ohne Schlüssel: Datei öffnen und Werte abtippen.', { actions: [{ label: 'Stammdaten → KI öffnen', primary: true, onclick: () => go('stamm', { scroll: 'ki' }) }] }); return; }
      if (zuGross) return toast('Zu groß – erst Dateien abhaken', 3500);
      // Ziel wählen, wenn es mehrere Protokolle/Teile gibt
      const targets = prs.flatMap(p => p.teile.map(t => ({ p, t, label: `${p.titel} · ${teilName(t)}` })));
      if (!targets.length) return toast('Kein Protokoll in dieser Fahrt');
      let ziel = targets[0];
      if (targets.length > 1) { let pick = null; await sheet('Wohin übernehmen?', targets.map(x => ({ label: x.label, onclick: () => { pick = x; } }))); if (!pick) return; ziel = pick; }
      kiBtn.disabled = true; kiBtn.innerHTML = '<span class="spinner"></span>Unterlagen werden gelesen … (bis 1 Min.)';
      try {
        const files = [];
        for (const u of sel) { const b = await db.getBlob(u.blobId); if (b) files.push({ blob: b, name: u.name }); }
        if (!files.length) throw new Error('Dateien nicht gefunden');
        const r = await ai.antragLesen(files);
        const { p, t } = ziel;
        const m = r.masse || {}, emp = r.empfaenger || {};
        const gefunden = [emp.firma, r.start, r.ziel, r.strecke, r.besonderheiten, m.laenge, m.gesamt].some(v => (v || '').trim());
        if (!gefunden) { await infoSheet('Nichts gefunden', 'Die KI konnte aus den angehakten Unterlagen keine verwertbaren Daten lesen. Sind die Dateien lesbar (kein reines Deckblatt, nicht zu klein fotografiert)?' + (r.unsicher?.length ? '\n\nUnsicher: ' + r.unsicher.join('; ') : '')); refresh(); return; }
        const docs = (r.dokumente || []).map(d => `${d.datei}: ${{ antrag: 'Antrag', bescheid: 'Bescheid/Ablehnung', protokoll: 'früheres Protokoll', sonstiges: 'Sonstiges' }[d.art] || d.art}${d.kurz ? ' – ' + d.kurz : ''}`).join('\n');
        const intro = (docs ? 'Erkannt:\n' + docs + '\n\n' : '') + (r.unsicher?.length ? '⚠️ Unsicher gelesen: ' + r.unsicher.join('; ') + '\n\n' : '') + `Ziel: ${ziel.label}. Was hier steht, wird übernommen – leere Felder bleiben, wie sie sind.`;
        const v = (neu, alt) => (neu || '').toString().trim() || alt || '';
        const fields = [
          { section: 'Empfänger (Spedition)' },
          { key: 'firma', label: 'Firma', value: v(emp.firma, f.kunde.firma) }, { key: 'strasse', label: 'Straße', value: v(emp.strasse, f.kunde.strasse) }, { key: 'plzOrt', label: 'PLZ Ort', value: v(emp.plzOrt, f.kunde.plzOrt) },
          { section: 'Strecke' },
          { key: 'start', label: 'Start', value: v(r.start, t.start) }, { key: 'ziel', label: 'Ziel', value: v(r.ziel, t.ziel) },
          { key: 'strecke', label: 'Straßenfolge', value: v(r.strecke, t.strecke), type: 'textarea' }, { key: 'besonderheiten', label: 'Besonderheiten', value: v(r.besonderheiten, t.besonderheiten), type: 'textarea' },
          { section: 'Maße Lastfahrt' },
          { key: 'laenge', label: 'Länge (m)', value: v(m.laenge, t.masse.laenge), inputmode: 'decimal' }, { key: 'breite', label: 'Breite (m)', value: v(m.breite, t.masse.breite), inputmode: 'decimal' }, { key: 'hoehe', label: 'Höhe (m)', value: v(m.hoehe, t.masse.hoehe), inputmode: 'decimal' }, { key: 'absenkbar', label: 'absenkbar auf (m)', value: v(m.absenkbar, t.masse.absenkbar), inputmode: 'decimal' }, { key: 'gesamt', label: 'Gesamtgewicht (t)', value: v(m.gesamt, t.masse.gesamt), inputmode: 'decimal' },
          { key: 'leerZug', label: 'Leergewicht Zug (t)', value: v(m.leerZug, t.masse.leerZug), inputmode: 'decimal' }, { key: 'leerAnh', label: 'Leergewicht Anhänger (t)', value: v(m.leerAnh, t.masse.leerAnh), inputmode: 'decimal' },
          { section: 'Hinweis der Behörde (nur Notiz zur Fahrt)' },
          { key: 'hinweise', label: 'Hinweis', value: v(r.hinweise, ''), type: 'textarea' },
        ];
        const res = await formSheet('Gefunden – prüfen, dann übernehmen', fields, 'Übernehmen', { intro });
        if (!res) { refresh(); return; }
        const tr = (k) => (res[k] || '').trim();
        if (tr('firma')) { f.kunde = { firma: tr('firma'), strasse: tr('strasse'), plzOrt: tr('plzOrt') }; p.empfaenger = { ...f.kunde }; }
        for (const k of ['start', 'ziel', 'strecke', 'besonderheiten']) if (tr(k)) t[k] = tr(k);
        for (const k of ['laenge', 'breite', 'hoehe', 'absenkbar', 'gesamt', 'leerZug', 'leerAnh']) if (tr(k)) t.masse[k] = tr(k);
        if (tr('hinweise')) f.notiz = (f.notiz ? f.notiz + '\n' : '') + 'Aus Unterlagen: ' + tr('hinweise');
        await save(); await model.saveProtokoll(p); toast('Übernommen – bitte im Protokoll prüfen'); refresh();
      } catch (e) { await kiFehler(e); refresh(); }
    };
    if (!MA) ac.appendChild(kiBtn);
    if (!stamm.apiKey && !MA) ac.appendChild(h(`<div class="muted small" style="margin-top:6px">Für das automatische Auslesen wird ein KI-Schlüssel benötigt (Stammdaten → KI). Ohne Schlüssel: Datei öffnen und Werte abtippen.</div>`));
  }
  ac.appendChild(field(f, 'notiz', 'Notiz zur Fahrt', { textarea: true, onSave: save, placeholder: 'z. B. Behörde will Rückweg extra, Bundesland Bremen …' }));
  c.appendChild(ac);

  // Checkliste
  const cc = h(`<div class="card"><h2>Was muss dokumentiert werden?</h2><div class="muted small" style="margin-bottom:6px">Vor der Abfahrt festlegen. Die App warnt beim Abschluss, wenn etwas fehlt.</div></div>`);
  const cl = h(`<div></div>`); cc.appendChild(cl);
  const drawCheck = () => {
    cl.innerHTML = '';
    (f.checkliste || []).forEach((it, i) => {
      const pr = prs.find(p => p.id === it.protokollId);
      const teil = pr?.teile.find(t => t.id === it.teilId);
      const sub = pr ? `${pr.titel} · ${teil?.name || ''}` : (it.optional ? 'nur bei Bedarf' : 'noch keinem Protokoll zugeordnet');
      const row = h(`<div class="check"><button class="box ${it.done ? 'done' : ''}"></button><div class="grow"><div>${esc(it.label)}${it.optional ? ' <span class="muted small">(optional)</span>' : ''}</div><div class="muted small">${esc(sub)}</div></div>${pr ? `<button class="chip" data-a="open">Öffnen</button>` : `<button class="chip" data-a="anlegen" style="background:#111;color:#fff">Anlegen</button>`}<button class="chip" data-a="mehr">Mehr</button></div>`);
      $('.box', row).onclick = async () => { it.done = !it.done; if (it.done) it.optional = false; await save(); drawCheck(); };
      if (pr) $('[data-a=open]', row).onclick = () => go('punkte', { protokollId: pr.id, teilId: it.teilId || pr.teile[0].id });
      const anlegen = () => sheet(`„${it.label}" anlegen als …`, [
        { label: 'Fahrtwegteil im 1. Protokoll (z. B. 1.2 Rückweg, gleiches PDF)', onclick: async () => { const p = prs[0]; if (!p) return toast('Erst ein Protokoll anlegen'); const t = neuerTeil(nextNr(p), it.label); p.teile.push(t); await model.saveProtokoll(p); it.protokollId = p.id; it.teilId = t.id; it.optional = false; await save(); refresh(); } },
        { label: 'Eigenes Protokoll (eigenes PDF, z. B. anderes Bundesland)', onclick: async () => { const np = await model.neuesProtokoll(id, { titel: it.label, empfaenger: { ...f.kunde } }); it.protokollId = np.id; it.teilId = np.teile[0].id; it.optional = false; await save(); refresh(); } },
      ]);
      if (!pr) $('[data-a=anlegen]', row).onclick = anlegen;
      $('[data-a=mehr]', row).onclick = () => sheet(it.label, [
        { label: it.optional ? 'Als Pflicht markieren' : 'Als optional markieren', onclick: async () => { it.optional = !it.optional; await save(); drawCheck(); } },
        { label: 'Umbenennen', onclick: async () => { const v = await promptSheet('Bezeichnung', it.label); if (v) { it.label = v; await save(); drawCheck(); } } },
        ...(pr ? [] : [{ label: 'Anlegen …', onclick: anlegen }]),
        { label: 'Entfernen', danger: true, onclick: async () => { if (await confirmSheet(`„${it.label}" aus der Checkliste entfernen?`, 'Entfernen')) { f.checkliste.splice(i, 1); await save(); drawCheck(); } } },
      ]);
      cl.appendChild(row);
    });
  };
  drawCheck();
  const addC = h(`<button class="chip" style="margin-top:8px">＋ Weiterer Abschnitt (z. B. Rückweg, zweites Bundesland)</button>`);
  addC.onclick = async () => { const v = await promptSheet('Was muss dokumentiert werden?', '', 'z. B. Abschnitt Bremen, Rückweg …'); if (v) { f.checkliste.push({ id: uid(), label: v, protokollId: '', teilId: '', done: false }); await save(); drawCheck(); } };
  cc.appendChild(addC);
  c.appendChild(cc);

  // Protokolle
  const pc = h(`<div class="card"><div class="row"><h2>Protokolle</h2><button class="chip" data-a="np">＋ Protokoll</button></div></div>`);
  $('[data-a=np]', pc).onclick = async () => { const np = await model.neuesProtokoll(id, { empfaenger: { ...f.kunde } }); go('protokoll', { id: np.id }); };
  for (const p of prs) {
    const n = (await db.byIndex('punkte', 'protokollId', p.id)).length;
    const row = h(`<button class="list-item"><div class="grow"><b>${esc(p.titel)}</b><div class="muted small">${p.teile.map(t => esc(teilName(t))).join(' · ')} · ${n} Punkte</div></div><span class="pill ${p.status === 'erzeugt' ? 'p-ok' : 'p-ent'}">${p.status === 'erzeugt' ? 'Erzeugt' : 'Entwurf'}</span><span class="arrow">›</span></button>`);
    row.onclick = () => go('protokoll', { id: p.id });
    pc.appendChild(row);
  }
  c.appendChild(pc);

  // Footer: Fahrmodus
  const foot = h(`<div class="footbar"><button class="btn">▶ Fahrmodus starten</button></div>`);
  $('.btn', foot).onclick = () => chooseTeilAndDrive(prs, f);
  s.appendChild(foot);
  return s;
};

async function chooseTeilAndDrive(prs, f) {
  const opts = [];
  for (const p of prs) for (const t of p.teile) {
    opts.push({ label: `${p.titel} · ${teilName(t)}`, onclick: () => startDrive(f, p, t, false) });
    if (t.alt?.aktiv) opts.push({ label: `${p.titel} · ${t.nr} Alternativroute`, onclick: () => startDrive(f, p, t, true) });
  }
  if (opts.length === 1) return opts[0].onclick();
  sheet('Wofür aufnehmen?', opts);
}
function startDrive(f, p, t, altRoute) {
  openFahrmodus({ fahrt: f, protokoll: p, teil: t, altRoute }, async (n) => { if (n) toast(`${n} Punkte aufgenommen`); go('punkte', { protokollId: p.id, teilId: t.id }); });
}

// ---------- Protokoll ----------
views.protokoll = async ({ id }) => {
  const p = await db.get('protokolle', id);
  if (!p) { back(); return h('<div></div>'); }
  const f = await db.get('fahrten', p.fahrtId);
  const stamm = await getStamm();
  const save = () => model.saveProtokoll(p);
  const s = screen({ title: p.titel, help: 'protokoll', action: 'Mehr', actionFn: () => sheet('Protokoll', [
    { label: 'Umbenennen', onclick: async () => { const v = await promptSheet('Titel', p.titel); if (v) { p.titel = v; await save(); refresh(); } } },
    { label: 'Protokoll kopieren (ohne Punkte)', onclick: async () => { const np = await model.kopiereProtokoll(p, false); toast('Kopie angelegt'); go('protokoll', { id: np.id }); } },
    { label: 'Protokoll kopieren (mit Punkten)', onclick: async () => { const np = await model.kopiereProtokoll(p, true); toast('Kopie angelegt'); go('protokoll', { id: np.id }); } },
    { label: 'Protokoll löschen', danger: true, onclick: async () => { if (await confirmSheet('Protokoll mit allen Punkten löschen?', 'Löschen')) { await model.deleteProtokoll(id); back(); } } },
  ]) });
  const c = content(s);
  const h1 = h(`<button class="tap"><h1>${esc(p.titel)} <span class="muted" style="font-size:16px;font-weight:500">✎</span></h1><div class="muted" style="margin-top:-6px;margin-bottom:12px;text-align:left">${esc(f ? fahrtTitel(f, [p]) : '')} · ${fmtDate(p.datum)}</div></button>`);
  h1.onclick = async () => { const v = await promptSheet('Titel des Protokolls', p.titel); if (v) { p.titel = v; await save(); refresh(); } };
  c.appendChild(h1);

  // Empfänger + Datum
  const ec = h(`<div class="card"><h2>Empfänger</h2></div>`);
  ec.appendChild(field(p.empfaenger, 'firma', 'Firma', { onSave: save }));
  ec.appendChild(h(`<div class="inline"></div>`));
  const il = $('.inline', ec); il.appendChild(field(p.empfaenger, 'strasse', 'Straße', { onSave: save })); il.appendChild(field(p.empfaenger, 'plzOrt', 'PLZ Ort', { onSave: save }));
  ec.appendChild(field(p, 'datum', 'Datum des Protokolls', { type: 'date', onSave: save }));
  c.appendChild(ec);

  // Teile
  for (const [ti, t] of p.teile.entries()) {
    const pts = await model.punkte(p.id, t.id);
    if (!t.bezeichnung) { t.bezeichnung = (t.name || '').replace(/^[^–-]*[–-]\s*/, '') || 'Lastfahrt'; }
    t.name = teilName(t);
    const tc = h(`<div class="card"><div class="row"><h2 style="margin:0">${esc(t.name)}</h2><button class="chip">Mehr</button></div>${p.teile.length > 1 ? `<div class="muted small" style="margin:-4px 0 6px">Fahrtwegteil ${ti + 1} von ${p.teile.length} · eigenes Deckblatt im PDF</div>` : ''}</div>`);
    $('.chip', tc).onclick = () => sheet(t.name, [
      { label: 'Nummer / Bezeichnung ändern', onclick: async () => { const r = await formSheet('Fahrtwegteil', [{ key: 'nr', label: 'Nummer', value: t.nr, placeholder: '1.2' }, { key: 'bez', label: 'Bezeichnung', value: t.bezeichnung, placeholder: 'Lastfahrt, Rückweg, Leerfahrt …' }]); if (r && r.nr.trim()) { t.nr = r.nr.trim(); t.bezeichnung = r.bez.trim() || 'Lastfahrt'; t.name = teilName(t); await save(); refresh(); } } },
      ...(ti > 0 ? [{ label: '↑ Nach oben (früher im PDF)', onclick: async () => { p.teile.splice(ti, 1); p.teile.splice(ti - 1, 0, t); await save(); refresh(); } }] : []),
      ...(ti < p.teile.length - 1 ? [{ label: '↓ Nach unten (später im PDF)', onclick: async () => { p.teile.splice(ti, 1); p.teile.splice(ti + 1, 0, t); await save(); refresh(); } }] : []),
      ...(p.teile.length > 1 ? [{ label: 'Als Rückweg vorbelegen (Start/Ziel und Strecke aus vorigem Teil umgekehrt)', onclick: async () => { const src = p.teile[ti - 1] || p.teile[0]; if (!(await confirmSheet('Start, Ziel, Strecke, Besonderheiten und Maße aus „' + src.name + '" umgekehrt übernehmen? Vorhandene Eingaben in diesem Teil werden überschrieben.', 'Übernehmen', false))) return; t.start = src.ziel; t.ziel = src.start; t.strecke = (src.strecke || '').split(/\s[–-]\s/).reverse().join(' - '); t.masse = { ...src.masse }; t.besonderheiten = src.besonderheiten; await save(); refresh(); } }] : []),
      { label: 'Fahrtwegteil löschen', danger: true, onclick: async () => { if (p.teile.length < 2) return toast('Das letzte Fahrtwegteil bleibt.'); if (await confirmSheet(`${t.name} mit ${pts.length} Punkten löschen?`, 'Löschen')) { for (const q of pts) await model.deletePunkt(q); p.teile.splice(ti, 1); await save(); if (f) { let ch = false; for (const it of f.checkliste || []) if (it.teilId === t.id) { it.teilId = ''; it.protokollId = ''; it.done = false; ch = true; } if (ch) await model.saveFahrt(f); } refresh(); } } },
    ]);
    tc.appendChild(field(t, 'start', 'Start', { onSave: save, placeholder: 'AS Bremen-Nord' }));
    const streckeF = field(t, 'strecke', 'Strecke', { textarea: true, onSave: save, placeholder: 'AS Bremen-Nord - B74 - A270 - … ', hint: 'Freitext. Markierter Text erscheint im PDF fett (z. B. Abschnitt der Alternativroute).' });
    const fett = h(`<button class="chip" style="margin:-4px 0 8px">B  Auswahl fett</button>`);
    fett.onclick = () => { const ta = $('textarea', streckeF); const a = ta.selectionStart, b = ta.selectionEnd; if (a === b) return toast('Erst Text im Feld markieren'); const v = ta.value; ta.value = v.slice(0, a) + '**' + v.slice(a, b) + '**' + v.slice(b); t.strecke = ta.value; save(); ta.focus(); };
    tc.appendChild(streckeF); tc.appendChild(fett);
    tc.appendChild(field(t, 'ziel', 'Ziel', { onSave: save, placeholder: '28755 Bremen, Am Werfttor 24 {Fa Muster}', hint: 'Text in {…} erscheint im Protokoll, nicht im Dateinamen.' }));
    tc.appendChild(field(t, 'besonderheiten', 'Besonderheiten', { textarea: true, onSave: save }));
    tc.appendChild(bausteinChips(stamm.bausteine.besonderheiten, (b) => { t.besonderheiten = (t.besonderheiten ? t.besonderheiten.trim() + '\n' : '') + b; save(); $$('textarea', tc)[1].value = t.besonderheiten; }));
    // Alternativroute
    t.alt = t.alt || { aktiv: false, strecke: '', hinweis: '' };
    tc.appendChild(toggle('Alternativroute', t.alt.aktiv, async (v) => { t.alt.aktiv = v; await save(); refresh(); }, 'Erscheint unter der Hauptstrecke, eigene Punkte möglich'));
    if (t.alt.aktiv) {
      tc.appendChild(field(t.alt, 'hinweis', 'Hinweis', { onSave: save, placeholder: 'z. B. ab Kreisverkehr B73 alternativ über …' }));
      tc.appendChild(field(t.alt, 'strecke', 'Strecke der Alternativroute', { textarea: true, onSave: save }));
    }
    // Maßtabelle
    tc.appendChild(h(`<h3>Transportabmessungen Lastfahrt</h3>`));
    const mk = (m) => { const g = h(`<div class="inline3"></div>`); [['laenge', 'Länge [m]'], ['breite', 'Breite [m]'], ['hoehe', 'Höhe [m]'], ['absenkbar', 'absenkbar auf [m]'], ['leerZug', 'Leer Zugfz. [t]'], ['leerAnh', 'Leer Anh. [t]']].forEach(([k, l]) => g.appendChild(field(m, k, l, { onSave: save, inputmode: 'decimal' }))); return g; };
    tc.appendChild(mk(t.masse));
    tc.appendChild(field(t.masse, 'gesamt', 'Gesamtmasse [t]', { onSave: save, inputmode: 'decimal' }));
    tc.appendChild(toggle('Leerfahrt-Zeile zusätzlich ausgeben', !!t.leerZeigen, async (v) => { t.leerZeigen = v; await save(); refresh(); }));
    if (t.leerZeigen) { tc.appendChild(h(`<h3>Leerfahrt</h3>`)); t.leer = t.leer || {}; tc.appendChild(mk(t.leer)); tc.appendChild(field(t.leer, 'gesamt', 'Gesamtmasse [t]', { onSave: save, inputmode: 'decimal' })); }
    // Punkte
    const nAlt = pts.filter(q => q.altRoute).length, nFlag = pts.filter(q => q.nachpruefen).length, nOhne = pts.filter(q => !model.hatText(q)).length;
    const pb = h(`<button class="list-item" style="margin-top:12px;background:#f0f1f4"><div class="grow"><b>Streckenpunkte</b><div class="muted small">${pts.length} Punkte${nAlt ? ` · ${nAlt} Alternativroute` : ''}${nFlag ? ` · ⚑ ${nFlag} nachprüfen` : ''}${nOhne ? ` · ${nOhne} ohne Text` : ''}</div></div><span class="arrow">›</span></button>`);
    pb.onclick = () => go('punkte', { protokollId: p.id, teilId: t.id });
    tc.appendChild(pb);
    const drive = h(`<button class="btn sec" style="margin-top:8px">▶ Fahrmodus für ${esc(t.nr)}</button>`);
    drive.onclick = () => startDrive(f, p, t, false);
    tc.appendChild(drive);
    c.appendChild(tc);
  }

  const addTeil = h(`<button class="btn sec" style="margin:-2px 0 14px">＋ Fahrtwegteil hinzufügen (z. B. ${esc(nextNr(p))} Rückweg)</button>`);
  addTeil.onclick = async () => { const r = await formSheet('Neues Fahrtwegteil', [{ key: 'nr', label: 'Nummer', value: nextNr(p) }, { key: 'bez', label: 'Bezeichnung', value: p.teile.length === 1 ? 'Rückweg' : 'Lastfahrt' }], 'Anlegen'); if (!r) return; const t = neuerTeil(r.nr.trim() || nextNr(p), r.bez.trim() || 'Lastfahrt'); p.teile.push(t); await save(); refresh(); };
  c.appendChild(addTeil);

  // Schlusstext
  const sc = h(`<div class="card"><h2>Schlusstext (letzte Seite)</h2></div>`);
  sc.appendChild(field(p, 'schlusstext', 'Auflagen / Hinweis', { textarea: true, onSave: save }));
  $('textarea', sc).style.minHeight = '150px';
  sc.appendChild(bausteinChips(stamm.bausteine.schluss, (b) => { p.schlusstext = (p.schlusstext.trim() + '\n\n' + b).trim(); save(); $('textarea', sc).value = p.schlusstext; }, [{ label: 'Standard wiederherstellen', onclick: () => { p.schlusstext = stamm.schlusstext; save(); $('textarea', sc).value = p.schlusstext; } }]));
  c.appendChild(sc);

  const foot = h(`<div class="footbar"><button class="btn">${MA ? 'Punkte prüfen' : 'Prüfen &amp; Erzeugen'}</button></div>`);
  $('.btn', foot).onclick = () => MA ? go('punkte', { protokollId: p.id, teilId: p.teile[0].id }) : go('erzeugen', { id: p.id });
  s.appendChild(foot);
  return s;
};

// ---------- Punkte-Liste ----------
views.punkte = async ({ protokollId, teilId, tab = 'haupt' }) => {
  const p = await db.get('protokolle', protokollId);
  if (!p) throw new Error('Protokoll nicht gefunden');
  const t = p.teile.find(x => x.id === teilId) || p.teile[0];
  const f = await db.get('fahrten', p.fahrtId);
  const all = await model.punkte(protokollId, t.id);
  const s = screen({ title: teilName(t), help: 'punkte', action: 'Karte', actionFn: () => go('karte', { protokollId, teilId: t.id }) });
  const c = content(s);
  const nFlag = all.filter(q => q.nachpruefen).length, nAlt = all.filter(q => q.altRoute).length, nOhne = all.filter(q => !model.hatText(q)).length;
  const list = tab === 'haupt' ? all.filter(q => !q.altRoute) : tab === 'alt' ? all.filter(q => q.altRoute) : all.filter(q => q.nachpruefen);
  const head = h(`<div class="row"><h1>Punkte</h1><div class="row" style="gap:6px"><span class="muted small">${all.length} Punkte${nOhne ? ` · ${nOhne} ohne Text` : ''}</span><button class="chip">Mehr</button></div></div>`);
  $('.chip', head).onclick = () => sheet('Punkte', [
    { label: 'Nach Aufnahmezeit sortieren', onclick: async () => { const sorted = [...list].sort((a, b) => (a.zeit || 0) - (b.zeit || 0)); await applyOrder(sorted); toast('Nach Zeit sortiert'); refresh(); } },
    { label: 'Ersten Punkt als Start, letzten als Ziel markieren', onclick: async () => { const l = list.filter(q => !q.nachpruefen); if (l.length < 2) return toast('Zu wenige Punkte'); l.forEach(q => { if (q.typ === 'start' || q.typ === 'ziel') q.typ = 'strasse'; }); l[0].typ = 'start'; l[l.length - 1].typ = 'ziel'; for (const q of l) await model.savePunkt(q); refresh(); } },
    { label: 'Alle Nachprüf-Markierungen aufheben', onclick: async () => { for (const q of all.filter(x => x.nachpruefen)) { q.nachpruefen = false; await model.savePunkt(q); } refresh(); } },
  ]);
  c.appendChild(head);
  const showAlt = t.alt?.aktiv || nAlt > 0;
  const tabs = h(`<div class="tabs"><button class="chip ${tab === 'haupt' ? 'on' : ''}" data-t="haupt">Hauptstrecke</button>${showAlt ? `<button class="chip ${tab === 'alt' ? 'on' : ''}" data-t="alt">Alternativroute${nAlt ? ' ' + nAlt : ''}</button>` : ''}<button class="chip ${tab === 'flag' ? 'on' : ''} ${nFlag ? 'warnc' : ''}" data-t="flag">⚑ Nachprüfen${nFlag ? ' ' + nFlag : ''}</button></div>`);
  $$('.chip', tabs).forEach(b => b.onclick = () => go('punkte', { protokollId, teilId: t.id, tab: b.dataset.t }, true));
  c.appendChild(tabs);
  const lw = h(`<div></div>`); c.appendChild(lw);
  if (!list.length) lw.appendChild(h(`<div class="centerbox"><div class="big">${tab === 'flag' ? '⚑' : '📷'}</div>${tab === 'flag' ? 'Keine offenen Nachprüf-Punkte.' : 'Noch keine Punkte. Fahrmodus starten oder Bilder aus der Fotothek holen.'}</div>`));
  const labelList = tab === 'alt' ? all.filter(q => q.altRoute) : all.filter(q => !q.altRoute);
  for (const [i, q] of list.entries()) {
    const cap = model.caption(q);
    const first = q.bilder?.find(b => b.gewaehlt) || q.bilder?.[0];
    const unbest = !(q.strasse || '').trim() && q.strasseVorschlag;
    const status = model.hatText(q) ? (unbest ? '<span class="pill p-ent" title="Straße prüfen">📍?</span>' : '<span class="pill p-ok">✓</span>') : '<span class="pill p-ent">Text fehlt</span>';
    const zeile2 = [q.bilder?.length > 1 ? `${q.bilder.length} Bilder` : (!q.bilder?.length ? 'kein Bild' : ''), q.zeit ? fmtTime(q.zeit) : '', q.gps ? (q.gps.coarse ? 'Standort grob' : 'Standort ✓') : 'kein Standort', q.quelle === 'fotothek' ? 'Fotothek' : ''].filter(Boolean).join(' · ');
    const row = h(`<div class="pt ${q.nachpruefen ? 'check' : ''}"><div class="num ${q.nachpruefen ? 'flag' : q.typ}">${esc(model.label(q, labelList))}</div><img class="thumb" alt=""><button class="grow tap" style="min-width:0"><b>${esc((cap.text || (unbest ? '📍 ' + q.strasseVorschlag : 'Ohne Text')).slice(0, 58))}${(cap.text || '').length > 58 ? '…' : ''}</b><span class="muted small">${esc(zeile2)}</span></button>${status}<div style="display:flex;flex-direction:column;gap:2px"><button class="handle" data-a="up" style="padding:0 6px;font-size:16px;line-height:1">▲</button><button class="handle" data-a="down" style="padding:0 6px;font-size:16px;line-height:1">▼</button></div><button class="handle" data-a="mehr" style="font-size:18px">⋮</button></div>`);
    if (first) blobUrl(first.thumbId || first.blobId).then(u => { if (u) { const im = $('.thumb', row); im.src = u; if (first.rot) im.style.transform = `rotate(${first.rot}deg)`; } });
    $('.grow', row).onclick = () => go('punkt', { id: q.id });
    const swap = async (j) => { if (j < 0 || j >= list.length) return; const l = [...list]; [l[i], l[j]] = [l[j], l[i]]; await applyOrder(l); refresh(); };
    $('[data-a=up]', row).onclick = (e) => { e.stopPropagation(); swap(i - 1); };
    $('[data-a=down]', row).onclick = (e) => { e.stopPropagation(); swap(i + 1); };
    if (i === 0) $('[data-a=up]', row).style.opacity = .25; if (i === list.length - 1) $('[data-a=down]', row).style.opacity = .25;
    $('[data-a=mehr]', row).onclick = (e) => { e.stopPropagation(); punktMenu(q, p, t, { list, refresh }); };
    lw.appendChild(row);
  }
  async function applyOrder(sub) { // nur die Reihenfolge-Werte der Teilliste neu verteilen, Rest bleibt
    const slots = sub.map(q => q.reihenfolge).sort((a, b) => a - b);
    for (let i = 0; i < sub.length; i++) { if (sub[i].reihenfolge !== slots[i]) { sub[i].reihenfolge = slots[i]; await model.savePunkt(sub[i]); } }
  }
  if (list.length) c.appendChild(h(`<div class="muted small" style="text-align:center;margin:6px 0 12px">Antippen = bearbeiten · ▲▼ = Reihenfolge · ⋮ = löschen, markieren, verschieben</div>`));

  const inp = h(`<input type="file" accept="image/*" multiple class="hidden">`); c.appendChild(inp);
  inp.onchange = async () => { const files = [...inp.files]; let ok = 0; for (const file of files) { try { await importFoto({ protokoll: p, teil: t, altRoute: tab === 'alt' }, file); ok++; } catch (e) { toast('Bild nicht übernommen: ' + e.message, 3000); } } toast(`${ok} Bild(er) übernommen`); refresh(); };
  const foot = h(`<div class="footbar"><div class="btnrow"><button class="btn sec" data-a="imp">🖼 Fotothek</button><button class="btn" data-a="drive">▶ Fahrmodus</button></div></div>`);
  $('[data-a=imp]', foot).onclick = () => inp.click();
  $('[data-a=drive]', foot).onclick = () => startDrive(f, p, t, tab === 'alt');
  s.appendChild(foot);
  return s;
};

// Menü für einen Punkt (Liste und Detail). after(): was danach passieren soll
async function punktMenu(q, p, t, { refresh: after, afterDelete } = {}) {
  const prs = await model.protokolle(p.fahrtId);
  const ziele = [];
  for (const pr of prs) for (const tt of pr.teile) {
    if (pr.id === q.protokollId && tt.id === q.teilId) continue;
    ziele.push({ label: `Verschieben nach: ${pr.titel} · ${teilName(tt)}`, onclick: async () => { await model.movePunkt(q, pr.id, tt.id, false); toast('Verschoben'); (afterDelete || after)?.(); } });
  }
  sheet(model.caption(q).text.slice(0, 60) || 'Punkt', [
    { label: q.typ === 'start' ? 'Start-Markierung entfernen' : 'Als Start markieren', onclick: async () => { q.typ = q.typ === 'start' ? 'strasse' : 'start'; await model.savePunkt(q); after?.(); } },
    { label: q.typ === 'ziel' ? 'Ziel-Markierung entfernen' : 'Als Ziel markieren', onclick: async () => { q.typ = q.typ === 'ziel' ? 'strasse' : 'ziel'; await model.savePunkt(q); after?.(); } },
    { label: q.nachpruefen ? '⚑ Nachprüfen erledigt' : '⚑ Als Nachprüf-Punkt markieren', onclick: async () => { q.nachpruefen = !q.nachpruefen; await model.savePunkt(q); after?.(); } },
    { label: q.altRoute ? 'Zur Hauptstrecke' : 'Zur Alternativroute', onclick: async () => { q.altRoute = !q.altRoute; await model.savePunkt(q); after?.(); } },
    ...ziele,
    { label: 'Punkt löschen', danger: true, onclick: async () => { if (await confirmSheet('Punkt mit allen Bildern löschen?', 'Löschen')) { await model.deletePunkt(q); (afterDelete || after)?.(); } } },
  ]);
}

// ---------- Karte ----------
// Karte: Marker ziehen = Standort korrigieren; „Standort setzen" für Punkte ohne Standort; Vorschau am Marker
views.karte = async ({ protokollId, teilId, focus, setFor }) => {
  const p = await db.get('protokolle', protokollId);
  if (!p) throw new Error('Protokoll nicht gefunden');
  const t = p.teile.find(x => x.id === teilId) || p.teile[0];
  const all = await model.punkte(protokollId, t.id);
  const haupt = all.filter(q => !q.altRoute), alt = all.filter(q => q.altRoute);
  const s = screen({ title: 'Karte · ' + teilName(t), nofoot: true, help: 'karte' });
  const c = content(s); c.style.padding = '0'; c.style.display = 'flex'; c.style.flexDirection = 'column';
  const mapEl = h(`<div style="flex:1;min-height:55vh;position:relative"></div>`); c.appendChild(mapEl);
  const bar = h(`<div style="padding:10px 16px calc(var(--sab) + 12px);background:var(--card);border-top:1px solid var(--line)"></div>`); c.appendChild(bar);
  let setMode = setFor ? all.find(q => q.id === setFor) : null;
  const ohne = all.filter(q => !q.gps);
  const drawBar = () => {
    bar.innerHTML = '';
    if (setMode) {
      bar.appendChild(h(`<div class="warn row"><span class="grow">Karte antippen: Standort für <b>${esc(model.caption(setMode).text.slice(0, 40) || 'Punkt')}</b> setzen</span><button class="chip">Abbrechen</button></div>`));
      $('.chip', bar).onclick = () => { setMode = null; drawBar(); };
      return;
    }
    bar.appendChild(h(`<div class="muted small">${all.length - ohne.length} von ${all.length} Punkten mit Standort · Marker ziehen = korrigieren · Marker antippen = Vorschau · Karte nur in der App, nicht im Protokoll</div>`));
    if (ohne.length) {
      const w = h(`<div class="chipscroll" style="margin-top:8px"><span class="muted small" style="align-self:center;white-space:nowrap">Ohne Standort:</span></div>`);
      ohne.forEach(q => { const ch = h(`<button class="chip warnc">${esc(model.label(q, q.altRoute ? alt : haupt))} ${esc((model.caption(q).text || 'Punkt').slice(0, 22))} · setzen</button>`); ch.onclick = () => { setMode = q; drawBar(); toast('Jetzt die Stelle auf der Karte antippen'); }; w.appendChild(ch); });
      bar.appendChild(w);
    }
  };
  drawBar();
  const saveGps = async (q, ll) => { q.gps = { lat: ll.lat, lon: ll.lon, acc: 0, manuell: true }; q.strasseVorschlag = ''; await model.savePunkt(q); reverseGeocode(ll.lat, ll.lon).then(async r => { if (r?.display) { const fresh = await db.get('punkte', q.id); if (fresh && !fresh.strasse) { fresh.strasseVorschlag = r.display; await db.put('punkte', fresh); } } }); };
  setTimeout(() => {
    if (!mapEl.isConnected) return;
    const pts = all.map(q => ({ ...q, label: model.label(q, q.altRoute ? alt : haupt) }));
    const map = miniMap(mapEl, pts, {
      interactive: true, focusId: focus, maxZoom: 18,
      onMove: async (q, ll) => { const fresh = await db.get('punkte', q.id); if (!fresh) return; await saveGps(fresh, ll); toast('Standort verschoben'); },
      onMapClick: async (ll) => { if (!setMode) return; await saveGps(setMode, ll); toast('Standort gesetzt'); go('karte', { protokollId, teilId: t.id }, true); },
      onClick: async (q, marker) => {
        if (setMode) { const ll = marker.getLatLng(); await saveGps(setMode, { lat: ll.lat, lon: ll.lng }); toast('Standort gesetzt (wie Punkt ' + (q.label || '') + ')'); go('karte', { protokollId, teilId: t.id }, true); return; }
        const first = q.bilder?.find(b => b.gewaehlt) || q.bilder?.[0];
        const cap = model.caption(q);
        const el = h(`<div style="width:200px;font-family:-apple-system,Arial"><div style="width:200px;height:120px;border-radius:8px;background:#cfd3d9;overflow:hidden"><img style="width:100%;height:100%;object-fit:cover;display:none"></div><div style="font-weight:700;font-size:13px;margin-top:6px">${esc(cap.text || (q.strasseVorschlag ? '📍 ' + q.strasseVorschlag : 'Ohne Text'))}</div><div style="color:#666;font-size:11px;margin-top:2px">${q.zeit ? fmtTime(q.zeit) : ''}${q.gps?.manuell ? ' · manuell gesetzt' : q.gps?.coarse ? ' · grober Standort' : q.gps?.acc ? ' · ±' + q.gps.acc + ' m' : ''}</div><button style="margin-top:8px;width:100%;background:#c8102e;color:#fff;border:0;border-radius:10px;padding:9px;font-weight:700;font-size:14px">Bearbeiten ›</button></div>`);
        if (first) blobUrl(first.thumbId || first.blobId).then(u => { const im = $('img', el); if (u) { im.src = u; im.style.display = 'block'; if (first.rot) im.style.transform = `rotate(${first.rot}deg)`; } });
        $('button', el).onclick = () => go('punkt', { id: q.id });
        marker.bindPopup(el, { maxWidth: 240, closeButton: true }).openPopup();
      },
    });
    trackMap(map);
    if (setMode && !ohne.includes(setMode) && setMode.gps) map.setView([setMode.gps.lat, setMode.gps.lon], 17);
  }, 30);
  return s;
};

// ---------- Punkt bearbeiten ----------
views.punkt = async ({ id }) => {
  const q = await db.get('punkte', id);
  if (!q) { back(); return h('<div></div>'); }
  const p = await db.get('protokolle', q.protokollId);
  const t = p.teile.find(x => x.id === q.teilId) || p.teile[0];
  const all = await model.punkte(q.protokollId, t.id);
  const idx = all.findIndex(x => x.id === id);
  const stamm = await getStamm();
  const save = () => model.savePunkt(q);
  const s = screen({ title: `Punkt ${idx + 1} / ${all.length}`, help: 'punkt', action: 'Mehr', actionFn: () => sheet('Punkt', [
    { label: 'Markieren / verschieben / löschen …', onclick: () => punktMenu(q, p, t, { refresh, afterDelete: back }) },
    { label: 'Ab hier neues Fahrtwegteil (alle folgenden Punkte mitnehmen)', onclick: async () => { const r = await formSheet('Neues Fahrtwegteil ab diesem Punkt', [{ key: 'nr', label: 'Nummer', value: nextNr(p) }, { key: 'bez', label: 'Bezeichnung', value: 'Lastfahrt' }], 'Anlegen'); if (!r) return; const nt = neuerTeil(r.nr.trim() || nextNr(p), r.bez.trim() || 'Lastfahrt'); p.teile.push(nt); await model.saveProtokoll(p); for (const x of all.slice(idx)) { x.teilId = nt.id; await model.savePunkt(x); } toast(`${all.length - idx} Punkte nach ${nt.name} verschoben`); go('protokoll', { id: p.id }); } },
  ]) });
  const c = content(s);

  // Bilder
  const ic = h(`<div class="card"></div>`);
  const main = h(`<img class="mainimg" alt="">`);
  const strip = h(`<div class="imgs"></div>`);
  let mainId = (q.bilder.find(b => b.gewaehlt) || q.bilder[0])?.id;
  const drawImgs = async () => {
    strip.innerHTML = '';
    for (const b of q.bilder) {
      const im = h(`<div class="im ${b.gewaehlt ? 'sel' : ''} ${b.id === mainId ? 'main' : ''}"><img><span class="badge">${b.gewaehlt ? '✓ im Protokoll' : 'nicht verwendet'}</span><button class="x">✕</button></div>`);
      blobUrl(b.thumbId || b.blobId).then(u => { const g = $('img', im); g.src = u; if (b.rot) g.style.transform = `rotate(${b.rot}deg)`; });
      $('img', im).onclick = async () => { mainId = b.id; await showMain(); };
      $('.x', im).onclick = async (e) => { e.stopPropagation(); if (!(await confirmSheet(q.bilder.length === 1 ? 'Letztes Bild löschen? Der Punkt bleibt ohne Bild.' : 'Dieses Bild endgültig löschen?', 'Löschen'))) return; await model.delBild(q, b); if (!q.bilder.some(x => x.gewaehlt) && q.bilder[0]) q.bilder[0].gewaehlt = true; mainId = q.bilder[0]?.id; await save(); drawImgs(); showMain(); };
      strip.appendChild(im);
    }
    const add = h(`<button class="im add">＋</button>`); add.onclick = () => addInp.click(); strip.appendChild(add);
    if (q.bilder.length > 1) $$('.im', strip).forEach((el, i) => { el.style.outline = q.bilder[i]?.id === mainId ? '3px solid #c8102e' : ''; if (q.bilder[i]?.gewaehlt) el.style.outlineColor = q.bilder[i].id === mainId ? '#c8102e' : '#0f6b31'; });
  };
  const showMain = async () => {
    const b = q.bilder.find(x => x.id === mainId);
    const hasImg = !!b;
    main.classList.toggle('hidden', !hasImg); useBtn.classList.toggle('hidden', !hasImg); rotBtn.classList.toggle('hidden', !hasImg); drawBtn.classList.toggle('hidden', !hasImg); cropBtn.classList.toggle('hidden', !hasImg);
    if (!b) { drawImgs(); return; }
    const url = await blobUrl(b.blobId);
    const full = await loadOriented(url, b.rot || 0);
    const { img, ox, oy } = await applyCrop(full, b.crop);
    const shapes = shiftShapes(q.zeichnung?.[b.id] || [], -ox, -oy);
    if (main._tmp) { URL.revokeObjectURL(main._tmp); main._tmp = null; }
    cropBtn.textContent = b.crop ? '✂️ Zuschnitt ✓' : '✂️ Zuschneiden'; cropBtn.classList.toggle('sec', !b.crop);
    if (shapes.length || b.rot || b.crop) { const { composite } = await import('./draw.js'); const blob = await composite(img, shapes, 1200); if (!blob) throw new Error('Bild konnte nicht gerendert werden'); main._tmp = URL.createObjectURL(blob); main.src = main._tmp; } else main.src = url;
    main.style.height = '';
    useBtn.textContent = b.gewaehlt ? '✓ Im Protokoll' : 'Im Protokoll verwenden';
    useBtn.classList.toggle('sec', !b.gewaehlt);
    drawBtn.textContent = shapes.length ? `✏️ Einzeichnen (${shapes.length})` : '✏️ Einzeichnen';
    drawImgs();
  };
  const addInp = h(`<input type="file" accept="image/*" multiple class="hidden">`);
  addInp.onchange = async () => { for (const file of [...addInp.files]) await model.addBild(q, await normalizePhoto(file, stamm.einstellungen?.fotoKlein ? 2500 : 4032), { name: file.name }); await save(); mainId = mainId || q.bilder[0]?.id; drawImgs(); showMain(); };
  const useBtn = h(`<button class="btn small sec">Im Protokoll verwenden</button>`);
  const rotBtn = h(`<button class="btn small sec" title="Drehen">↻ Drehen</button>`);
  useBtn.onclick = async () => { const b = q.bilder.find(x => x.id === mainId); if (!b) return; b.gewaehlt = !b.gewaehlt; if (!q.bilder.some(x => x.gewaehlt)) { b.gewaehlt = true; toast('Mindestens ein Bild bleibt im Protokoll'); } await save(); showMain(); };
  const drawBtn = h(`<button class="btn small">✏️ Einzeichnen</button>`);
  rotBtn.onclick = async () => { const b = q.bilder.find(x => x.id === mainId); if (!b) return; const im = await loadOriented(await blobUrl(b.blobId), b.rot || 0); if (q.zeichnung?.[b.id]?.length) q.zeichnung[b.id] = rotateShapes(q.zeichnung[b.id], im.naturalWidth, im.naturalHeight); if (b.crop) b.crop = rotateCrop(b.crop); b.rot = ((b.rot || 0) + 90) % 360; await save(); showMain(); };
  // Einzeichnen im zugeschnittenen Ausschnitt; gespeichert wird in Koordinaten des ganzen Bildes
  drawBtn.onclick = async () => { const b = q.bilder.find(x => x.id === mainId); if (!b) return; const full = await loadOriented(await blobUrl(b.blobId), b.rot || 0); const { img, ox, oy } = await applyCrop(full, b.crop); const res = await openEditor(img, shiftShapes(q.zeichnung?.[b.id] || [], -ox, -oy)); if (res) { q.zeichnung = q.zeichnung || {}; q.zeichnung[b.id] = shiftShapes(res, ox, oy); await save(); showMain(); } };
  const cropBtn = h(`<button class="btn small sec">✂️ Zuschneiden</button>`);
  cropBtn.onclick = async () => { const b = q.bilder.find(x => x.id === mainId); if (!b) return; const full = await loadOriented(await blobUrl(b.blobId), b.rot || 0); const res = await openCrop(full, b.crop); if (!res) return; if (res.voll) delete b.crop; else b.crop = res; await save(); showMain(); toast(res.voll ? 'Ganzes Bild' : 'Zugeschnitten – Original bleibt erhalten'); };
  addInp.setAttribute('capture', 'environment');
  ic.appendChild(main); ic.appendChild(strip); ic.appendChild(addInp);
  ic.appendChild(h(`<div class="row" style="margin-top:6px"></div>`)); $('.row', ic).appendChild(useBtn); $('.row', ic).appendChild(rotBtn); $('.row', ic).appendChild(drawBtn);
  ic.appendChild(h(`<div class="row" data-r="row2" style="margin-top:6px"></div>`)); $('[data-r=row2]', ic).appendChild(cropBtn);
  const gew = q.bilder.filter(b => b.gewaehlt).length;
  if (gew > 1) { const lay = h(`<div class="chips" style="margin-top:8px"><span class="muted small" style="align-self:center">Anordnung:</span><button class="chip ${q.layout === 'auto' ? 'on' : ''}" data-l="auto">automatisch</button><button class="chip ${q.layout === 'nebeneinander' ? 'on' : ''}" data-l="nebeneinander">nebeneinander</button><button class="chip ${q.layout === 'untereinander' ? 'on' : ''}" data-l="untereinander">untereinander</button></div>`); $$('.chip', lay).forEach(b => b.onclick = async () => { q.layout = b.dataset.l; $$('.chip', lay).forEach(x => x.classList.toggle('on', x.dataset.l === q.layout)); await save(); }); ic.appendChild(lay); }
  if (q.bilder.length > 1) ic.appendChild(h(`<div class="muted small" style="margin-top:6px">Serie: Bild antippen, dann „Im Protokoll verwenden“. Nicht verwendete Bilder bleiben gespeichert.</div>`));
  if (!q.bilder.length) { const nb = h(`<div class="warn"><div style="margin-bottom:8px">Dieser Punkt hat kein Bild.</div><div class="btnrow"><button class="btn small">📷 Foto hinzufügen</button><button class="btn small sec">Punkt löschen</button></div></div>`); const [add, del] = $$('.btn', nb); add.onclick = () => addInp.click(); del.onclick = async () => { if (await confirmSheet('Punkt löschen?', 'Löschen')) { await model.deletePunkt(q); back(); } }; ic.prepend(nb); }
  c.appendChild(ic);
  showMain();

  // Typ, Straße, Text
  const tc = h(`<div class="card"></div>`);
  const typ = h(`<div class="chips"><span class="muted small" style="align-self:center">Vorspann:</span><button class="chip ${q.typ === 'start' ? 'on' : ''}" data-t="start">Start:</button><button class="chip ${q.typ === 'strasse' ? 'on' : ''}" data-t="strasse">Straße:</button><button class="chip ${q.typ === 'ziel' ? 'on' : ''}" data-t="ziel">Ziel:</button><button class="chip ${q.typ === 'frei' ? 'on' : ''}" data-t="frei">ohne</button><span style="flex:1"></span><button class="chip ${q.nachpruefen ? 'warnc' : ''}" data-t="flag">⚑ ${q.nachpruefen ? 'Nachprüfen offen' : 'Nachprüfen'}</button></div>`);
  $$('.chip[data-t]', typ).forEach(b => b.onclick = async () => { if (b.dataset.t === 'flag') { q.nachpruefen = !q.nachpruefen; b.classList.toggle('warnc', q.nachpruefen); b.textContent = q.nachpruefen ? '⚑ Nachprüfen offen' : '⚑ Nachprüfen'; } else { q.typ = b.dataset.t; $$('.chip[data-t]', typ).forEach(x => x.classList.toggle('on', x.dataset.t === q.typ)); } await save(); });
  tc.appendChild(typ);
  const stField = field(q, 'strasse', 'Straße / Stelle (erscheint im Protokoll)', { onSave: save, placeholder: 'z. B. AS Bremen-Nord auf B74' });
  tc.appendChild(stField);
  const vorsch = h(`<div class="chipscroll"></div>`);
  const vorschlagBox = h(`<div class="warn row hidden" style="margin:-4px 0 8px"><span class="grow small">GPS-Vorschlag: <b></b><br><span class="muted small">Erst nach Bestätigung im Protokoll.</span></span><button class="chip" style="background:#111;color:#fff">Übernehmen</button></div>`);
  const showVorschlag = (v) => { if (!v || (q.strasse || '').trim()) { vorschlagBox.classList.add('hidden'); return; } $('b', vorschlagBox).textContent = v; vorschlagBox.classList.remove('hidden'); $('.chip', vorschlagBox).onclick = () => { q.strasse = v; $('input', stField).value = v; save(); vorschlagBox.classList.add('hidden'); toast('Straße übernommen'); }; };
  tc.appendChild(vorschlagBox); showVorschlag(q.strasseVorschlag);
  $('input', stField).addEventListener('input', () => { if ($('input', stField).value.trim()) vorschlagBox.classList.add('hidden'); else showVorschlag(q.strasseVorschlag); });
  if (!q.strasseVorschlag && q.gps && navigator.onLine) reverseGeocode(q.gps.lat, q.gps.lon).then(async r => { if (r?.display) { q.strasseVorschlag = r.display; await save(); showVorschlag(r.display); } });
  // zuletzt genutzte Straßen
  const recent = [...new Set(all.map(x => x.strasse).filter(Boolean))].filter(x => x !== q.strasse).slice(-6).reverse();
  recent.forEach(r => { const ch = h(`<button class="chip">${esc(r)}</button>`); ch.onclick = () => { q.strasse = r; $('input', stField).value = r; save(); }; vorsch.appendChild(ch); });
  if (t.start && !recent.includes(t.start)) { const ch = h(`<button class="chip">${esc(t.start)}</button>`); ch.onclick = () => { q.strasse = t.start; $('input', stField).value = t.start; save(); }; vorsch.appendChild(ch); }
  tc.appendChild(vorsch);
  const txt = field(q, 'text', 'Text (Bildunterschrift)', { textarea: true, onSave: save, placeholder: 'z. B. zum Abbiegen beide Spuren verwenden. Brückenhöhe ausreichend.', hint: 'Diktieren: Mikrofon-Taste auf der iPhone-Tastatur.' });
  tc.appendChild(txt);
  const ta = $('textarea', txt);
  tc.appendChild(bausteinChips(stamm.bausteine.punkt, (b) => { appendText(q, 'text', b); ta.value = q.text; save(); }, MA ? [] : [
    { label: '✨ KI-Einschätzung', cls: 'ai', onclick: () => kiEinschaetzung() },
    { label: '✨ Ausformulieren', cls: 'ai', onclick: async () => { if (!q.text.trim()) return toast('Erst Stichworte eintippen'); try { toast('KI formuliert …'); const r = await ai.formulieren(q.text, { strasse: q.strasse }); if (await confirmSheet(`Vorschlag:\n\n${r}\n\nÜbernehmen?`, 'Übernehmen', false)) { q.text = r; ta.value = r; await save(); } } catch (e) { kiFehler(e); } } },
  ]));
  const kiBox = h(`<div></div>`); tc.appendChild(kiBox);
  async function kiEinschaetzung() {
    const b = q.bilder.find(x => x.id === mainId); if (!b) return toast('Kein Bild');
    kiBox.innerHTML = '<div class="muted small" style="margin-top:8px"><span class="spinner" style="border-color:#ccc;border-top-color:#333"></span>KI schaut sich das Bild an …</div>';
    try {
      const blob = await db.getBlob(b.blobId);
      const r = await ai.fotoEinschaetzen(blob, { strasse: q.strasse || q.strasseVorschlag, text: q.text, masse: t.masse });
      kiBox.innerHTML = '';
      const box = h(`<div class="card" style="background:#fff8e6;margin-top:10px"><b style="font-size:14px">✨ Vorschläge der KI</b><div class="muted small">Nur Hinweise. Du entscheidest.</div></div>`);
      (r.hinweise || []).forEach(hh => box.appendChild(h(`<div class="small" style="margin-top:6px">• ${esc(hh)}</div>`)));
      if (r.textvorschlag) { const tv = h(`<div><div style="margin-top:10px;font-size:15px">„${esc(r.textvorschlag)}“</div><div class="btnrow" style="margin-top:8px"><button class="btn small sec">Anhängen</button><button class="btn small">Übernehmen</button></div></div>`); box.appendChild(tv); const [an, ue] = $$('.btn', box); an.onclick = () => { appendText(q, 'text', r.textvorschlag); ta.value = q.text; save(); box.remove(); }; ue.onclick = () => { q.text = r.textvorschlag; ta.value = q.text; save(); box.remove(); }; }
      kiBox.appendChild(box);
    } catch (e) { kiBox.innerHTML = `<div class="err">${esc(e.message)}</div>`; if (e.code) kiFehler(e); }
  }
  c.appendChild(tc);

  // Messwerte
  const mc = h(`<div class="card"><h2>Messwerte (optional)</h2><div class="inline"></div></div>`);
  q.mess = q.mess || {};
  const mi = $('.inline', mc);
  [['bruecke', 'Brückenhöhe gemessen [m]'], ['breite', 'Durchfahrtsbreite [m]'], ['hoehe', 'Höhe [m]'], ['laenge', 'Länge [m]']].forEach(([k, l]) => mi.appendChild(field(q.mess, k, l, { onSave: save, inputmode: 'decimal' })));
  c.appendChild(mc);

  // Standort
  const gc = h(`<div class="card"><h2>Standort</h2></div>`);
  if (q.gps) {
    const L = mapsLinks(q.gps);
    gc.appendChild(h(`<div class="muted small">📍 ${fmtCoord(q.gps)}${q.gps.acc ? ` (±${q.gps.acc} m)` : ''} · ${q.zeit ? fmtDate(new Date(q.zeit).toISOString()) + ' ' + fmtTime(q.zeit) : ''}</div>`));
    const row = h(`<div class="chips"><button class="chip" data-a="copy">📋 Kopieren</button><a class="chip" href="${L.google}" target="_blank" rel="noopener" style="text-decoration:none;color:inherit">Google Maps</a><a class="chip" href="${L.apple}" target="_blank" rel="noopener" style="text-decoration:none;color:inherit">Apple Karten</a></div>`);
    $('[data-a=copy]', row).onclick = async () => { toast((await copyText(`${q.gps.lat.toFixed(6)}, ${q.gps.lon.toFixed(6)}`)) ? 'Koordinaten kopiert' : 'Kopieren nicht möglich'); };
    gc.appendChild(row);
    const mb = h(`<div class="mapbox" style="position:relative"><div style="position:absolute;right:8px;bottom:8px;z-index:500;background:#fff;border-radius:10px;padding:6px 10px;font-size:13px;font-weight:700;box-shadow:0 1px 4px rgba(0,0,0,.3)">Korrigieren ›</div></div>`); gc.appendChild(mb);
    mb.onclick = () => go('karte', { protokollId: q.protokollId, teilId: q.teilId, focus: q.id });
    setTimeout(() => { if (mb.isConnected) trackMap(miniMap(mb, [{ ...q, label: model.label(q, all.filter(x => x.altRoute === q.altRoute)) }], { maxZoom: 17, line: false })); }, 50);
    if (q.gps.coarse || (q.gps.acc > 60 && !q.gps.manuell)) gc.appendChild(h(`<div class="warn small" style="margin-top:8px">Standort ist ungenau (${q.gps.coarse ? 'grober Fix' : '±' + q.gps.acc + ' m'}). Auf der Karte prüfen und ggf. Marker verschieben.</div>`));
  } else {
    gc.appendChild(h(`<div class="muted small">Kein Standort gespeichert (z. B. Bild aus der Fotothek ohne GPS oder GPS war noch nicht bereit).</div>`));
    const row = h(`<div class="chips" style="margin-top:8px"><button class="chip" data-a="now">Aktuellen Standort übernehmen</button><button class="chip" data-a="map">Auf Karte setzen</button>${idx > 0 || idx < all.length - 1 ? '<button class="chip" data-a="mid">Zwischen Nachbarpunkten schätzen</button>' : ''}</div>`);
    $('[data-a=now]', row).onclick = async () => { const { currentPosition } = await import('./geo.js'); const g = await currentPosition(8000); if (g) { q.gps = { lat: g.lat, lon: g.lon, acc: g.acc }; await save(); refresh(); } else toast('Kein GPS'); };
    $('[data-a=map]', row).onclick = () => go('karte', { protokollId: q.protokollId, teilId: q.teilId, setFor: q.id });
    const mid = $('[data-a=mid]', row); if (mid) mid.onclick = async () => { const prev = [...all.slice(0, idx)].reverse().find(x => x.gps), next = all.slice(idx + 1).find(x => x.gps); const g = prev && next ? { lat: (prev.gps.lat + next.gps.lat) / 2, lon: (prev.gps.lon + next.gps.lon) / 2 } : (prev || next)?.gps; if (!g) return toast('Keine Nachbarpunkte mit Standort'); q.gps = { lat: g.lat, lon: g.lon, acc: 0, manuell: true, geschaetzt: true }; await save(); toast('Geschätzt – bitte auf der Karte prüfen'); refresh(); };
    gc.appendChild(row);
  }
  gc.appendChild(field(q, 'notiz', 'Interne Notiz (nicht im Protokoll)', { onSave: save, placeholder: 'z. B. nochmal Radius prüfen' }));
  c.appendChild(gc);

  const delBtn = h(`<button class="btn ghost" style="margin:4px 0 8px">🗑 Punkt löschen</button>`);
  delBtn.onclick = async () => { if (await confirmSheet('Diesen Punkt mit allen Bildern löschen?', 'Löschen')) { await model.deletePunkt(q); back(); } };
  c.appendChild(delBtn);

  // Navigation
  const foot = h(`<div class="footbar"><div class="btnrow"><button class="btn sec" ${idx <= 0 ? 'disabled style="opacity:.4"' : ''}>‹ Vorheriger</button><button class="btn sec" ${idx >= all.length - 1 ? 'disabled style="opacity:.4"' : ''}>Nächster ›</button></div></div>`);
  const [prev, next] = $$('.btn', foot);
  prev.onclick = () => go('punkt', { id: all[idx - 1].id }, true);
  next.onclick = () => go('punkt', { id: all[idx + 1].id }, true);
  s.appendChild(foot);
  return s;
};

// ---------- Prüfen & Erzeugen ----------
views.erzeugen = async ({ id }) => {
  const p = await db.get('protokolle', id);
  if (!p) throw new Error('Protokoll nicht gefunden');
  const f = await db.get('fahrten', p.fahrtId);
  const stamm = await getStamm();
  const s = screen({ title: 'Prüfen & Erzeugen', help: 'erzeugen' });
  const c = content(s);
  c.appendChild(h(`<h1>Prüfen &amp; Erzeugen</h1>`));
  const issues = await model.pruefen(p);
  const vc = h(`<div class="card"><h2>Vollständigkeit</h2></div>`);
  issues.forEach(i => { const row = h(`<button class="check tap"><div class="box ${i.level === 'ok' ? 'done' : i.level}"></div><div class="small grow" style="text-align:left">${esc(i.label)}</div>${i.target && i.level !== 'ok' ? '<span class="arrow" style="color:#c4c8cf">›</span>' : ''}</button>`); if (i.target && i.level !== 'ok') row.onclick = () => go(i.target.view, i.target.params); vc.appendChild(row); });
  if (issues.some(i => i.level === 'bad')) vc.appendChild(h(`<div class="muted small" style="margin-top:8px">Rote Punkte antippen und beheben. Erzeugen geht trotzdem, das Protokoll ist dann unvollständig.</div>`));
  c.appendChild(vc);

  // KI-Textprüfung
  const kc = h(`<div class="card"><div class="row"><h2>✨ KI-Textprüfung</h2><button class="chip ai">Prüfen</button></div><div class="muted small">Rechtschreibung, Grammatik, einheitliche Schreibweise. Du übernimmst jeden Vorschlag einzeln.</div><div data-r="out"></div></div>`);
  $('.chip', kc).onclick = async () => {
    const out = $('[data-r=out]', kc); out.innerHTML = '<div class="muted small" style="margin-top:8px"><span class="spinner" style="border-color:#ccc;border-top-color:#333"></span>Texte werden geprüft …</div>';
    try {
      const items = [];
      for (const t of p.teile) {
        items.push({ id: `T:${t.id}:start`, text: t.start }, { id: `T:${t.id}:strecke`, text: t.strecke }, { id: `T:${t.id}:ziel`, text: t.ziel }, { id: `T:${t.id}:besonderheiten`, text: t.besonderheiten });
        for (const q of await model.punkte(p.id, t.id)) { items.push({ id: `P:${q.id}:strasse`, text: q.strasse }); items.push({ id: `P:${q.id}:text`, text: q.text }); }
      }
      items.push({ id: 'S::schlusstext', text: p.schlusstext });
      const todo = items.filter(i => (i.text || '').trim());
      if (!todo.length) { out.innerHTML = '<div class="muted small">Noch keine Texte vorhanden.</div>'; return; }
      const stat = h(`<div class="muted small" style="margin-top:8px"></div>`); out.innerHTML = ''; out.appendChild(stat);
      const zeige = (res) => { for (const r of res) {
        const orig = items.find(i => i.id === r.id); if (!orig || orig.text === r.neu) continue;
        const d = h(`<div class="diff" style="margin-top:10px;background:#f6f7f9;border-radius:10px;padding:10px"><div class="old">${esc(orig.text)}</div><div class="new">${esc(r.neu)}</div><div class="muted small" style="margin-top:4px">${esc(r.grund || '')}</div><div class="chips"><button class="chip on">Übernehmen</button><button class="chip">Behalten</button></div></div>`);
        const [ue, be] = $$('.chip', d);
        ue.onclick = async () => {
          const [kind, oid, key] = r.id.split(':');
          if (kind === 'T') { const t = p.teile.find(x => x.id === oid); t[key] = r.neu; await model.saveProtokoll(p); }
          else if (kind === 'P') { const q = await db.get('punkte', oid); q[key] = r.neu; await model.savePunkt(q); }
          else { p.schlusstext = r.neu; await model.saveProtokoll(p); }
          d.innerHTML = `<div class="ok">Übernommen: ${esc(r.neu)}</div>`;
        };
        be.onclick = () => d.remove();
        out.appendChild(d);
      } };
      let gesamt = 0;
      const res = await ai.textPruefen(todo, (k, done, total) => { gesamt += k.length; zeige(k); stat.innerHTML = done < total ? `<span class="spinner" style="border-color:#ccc;border-top-color:#333"></span>Block ${done} von ${total} geprüft …` : ''; });
      stat.remove();
      if (!gesamt) out.appendChild(h(`<div class="ok">Keine Korrekturen nötig (${todo.length} Texte geprüft).</div>`));
      else out.prepend(h(`<div class="muted small" style="margin-top:8px">${res.length} Vorschläge aus ${todo.length} Texten. Jeden einzeln übernehmen oder behalten.</div>`));
    } catch (e) { out.innerHTML = `<div class="err">${esc(e.message)}</div>`; if (e.code) kiFehler(e); }
  };
  c.appendChild(kc);

  // Ausgabe
  const oc = h(`<div class="card"><h2>Ausgabe</h2><div class="muted small">${esc(dateiname(p, f, 'pdf'))}</div></div>`);
  oc.appendChild(toggle('Koordinaten unter den Bildern ausgeben', !!stamm.einstellungen.koordinatenImPdf, async (v) => { stamm.einstellungen.koordinatenImPdf = v; await saveStamm(stamm); }, 'Standard aus. Nur einschalten, wenn die Behörde es verlangt.'));
  const prog = h(`<div class="progress hidden"><i style="width:0"></i></div>`); oc.appendChild(prog);
  const status = h(`<div class="muted small"></div>`); oc.appendChild(status);
  c.appendChild(oc);
  const results = h(`<div></div>`); c.appendChild(results);

  async function run(kind) {
    const btns = $$('.footbar .btn', s); btns.forEach(b => b.classList.add('disabled'));
    prog.classList.remove('hidden'); const bar = $('i', prog);
    const set = (pct, msg) => { bar.style.width = pct + '%'; status.textContent = msg; };
    try {
      set(10, 'Bilder werden vorbereitet …');
      let pdf = null, docx = null;
      if (kind !== 'docx') { set(30, 'PDF wird erzeugt …'); pdf = await buildPdf(p, f); }
      if (kind !== 'pdf') { set(60, 'Word wird erzeugt …'); docx = await buildDocx(p, f); }
      set(85, 'Dateien werden zusammengestellt …');
      const files = [];
      if (pdf) files.push(new File([pdf], dateiname(p, f, 'pdf'), { type: 'application/pdf' }));
      if (docx) files.push(new File([docx], dateiname(p, f, 'docx'), { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }));
      if (kind === 'zip') { const z = await buildZip(p, f, pdf, docx); files.length = 0; files.push(new File([z.blob], z.name, { type: 'application/zip' })); status.textContent = `${z.fotos} Originalfotos im ZIP`; }
      set(100, 'Fertig.');
      p.status = 'erzeugt'; p.erzeugtAm = Date.now(); await model.saveProtokoll(p);
      if (f) { let ch = false; for (const it of f.checkliste || []) if (it.protokollId === p.id && !it.done) { it.done = true; ch = true; } if (f.status === 'entwurf') { f.status = 'erzeugt'; ch = true; } if (ch) await model.saveFahrt(f); }
      results.innerHTML = '';
      for (const file of files) {
        const row = h(`<div class="card row"><div class="grow"><b>${esc(file.name)}</b><div class="muted small">${(file.size / 1024 / 1024).toFixed(1)} MB</div></div><button class="chip">Teilen</button><button class="chip">Speichern</button></div>`);
        const [sh, sv] = $$('.chip', row); sh.onclick = () => shareFiles([file], file.name); sv.onclick = () => downloadBlob(file, file.name);
        results.appendChild(row);
      }
      if (files.length > 1) { const shAll = h(`<button class="btn sec" style="margin-bottom:12px">Alle teilen</button>`); shAll.onclick = () => shareFiles(files, 'Streckenprotokoll'); results.prepend(shAll); }
      results.scrollIntoView({ behavior: 'smooth' });
    } catch (e) { console.error(e); status.innerHTML = `<div class="err">Fehler: ${esc(e.message)}</div>`; }
    finally { btns.forEach(b => b.classList.remove('disabled')); setTimeout(() => prog.classList.add('hidden'), 1500); }
  }
  const foot = h(`<div class="footbar"><div class="btnrow"><button class="btn sec" data-k="docx">Word</button><button class="btn" data-k="pdf">PDF</button></div><button class="btn sec" data-k="zip" style="margin-top:8px">ZIP: PDF + Word + Originalfotos</button></div>`);
  $$('.btn', foot).forEach(b => b.onclick = () => run(b.dataset.k));
  s.appendChild(foot);
  c.style.paddingBottom = 'calc(var(--sab) + 170px)';
  return s;
};

// ---------- Stammdaten ----------
views.stamm = async ({ scroll } = {}) => {
  const st = await getStamm();
  const save = () => saveStamm(st);
  if (MA) return stammMA(st, save);
  const s = screen({ title: 'Stammdaten', back: false, tabbar: 'stamm', help: 'stamm' });
  const c = content(s);
  c.appendChild(h(`<h1>Stammdaten</h1>`));

  const sc = h(`<div class="card"><h2>Signatur (letzte Seite / Kopf)</h2></div>`);
  [['name', 'Name'], ['tel', 'Telefon'], ['firma', 'Firma'], ['strasse', 'Straße'], ['ort', 'PLZ Ort']].forEach(([k, l]) => sc.appendChild(field(st.signatur, k, l, { onSave: save })));
  const logoRow = h(`<div class="row" style="margin-top:6px"><div class="grow"><b>Logo</b><div class="muted small">${st.einstellungen.logoBlobId ? 'hinterlegt' : 'keins'} · erscheint auf der letzten Seite</div></div><button class="chip">${st.einstellungen.logoBlobId ? 'Ersetzen' : 'Hochladen'}</button>${st.einstellungen.logoBlobId ? '<button class="chip">✕</button>' : ''}</div>`);
  const li = h(`<input type="file" accept="image/png,image/jpeg" class="hidden">`); sc.appendChild(li);
  $$('.chip', logoRow)[0].onclick = () => li.click();
  if ($$('.chip', logoRow)[1]) $$('.chip', logoRow)[1].onclick = async () => { if (!(await confirmSheet('Logo entfernen?', 'Entfernen'))) return; await db.del('blobs', st.einstellungen.logoBlobId); st.einstellungen.logoBlobId = ''; await save(); refresh(); };
  li.onchange = async () => { const f = li.files[0]; if (!f) return; if (st.einstellungen.logoBlobId) await db.del('blobs', st.einstellungen.logoBlobId); st.einstellungen.logoBlobId = await db.putBlob(f, { name: 'logo' }); await save(); toast('Logo gespeichert'); refresh(); };
  sc.appendChild(logoRow);
  if (st.einstellungen.logoBlobId) {
    const lp = h(`<div class="field"><label>Logo erscheint auf</label><select><option value="beide">Deckblatt und Schlussseite</option><option value="deckblatt">nur Deckblatt</option><option value="schluss">nur Schlussseite</option></select></div>`);
    $('select', lp).value = st.einstellungen.logoPos || 'beide';
    $('select', lp).onchange = async () => { st.einstellungen.logoPos = $('select', lp).value; await save(); };
    sc.appendChild(lp);
  }
  sc.appendChild(field(st, 'schlusstext', 'Standard-Schlusstext für neue Protokolle', { textarea: true, onSave: save }));
  c.appendChild(sc);

  // Kunden
  const kc = h(`<div class="card"><div class="row"><h2>Kunden</h2><button class="chip">＋</button></div></div>`);
  const kundeFields = (k = {}) => [{ key: 'firma', label: 'Firma', value: k.firma, placeholder: 'Spedition …' }, { key: 'strasse', label: 'Straße', value: k.strasse }, { key: 'plzOrt', label: 'PLZ Ort', value: k.plzOrt }];
  $('.chip', kc).onclick = async () => { const r = await formSheet('Neuer Kunde', kundeFields()); if (!r || !r.firma.trim()) return; st.kunden.unshift({ firma: r.firma.trim(), strasse: r.strasse.trim(), plzOrt: r.plzOrt.trim() }); await save(); refresh(); };
  st.kunden.forEach((k, i) => { const row = h(`<div class="check"><button class="grow tap" style="text-align:left"><div>${esc(k.firma)}</div><div class="muted small">${esc([k.strasse, k.plzOrt].filter(Boolean).join(', '))}</div></button><button class="chip">✕</button></div>`); $('.grow', row).onclick = async () => { const r = await formSheet('Kunde bearbeiten', kundeFields(k)); if (r && r.firma.trim()) { st.kunden[i] = { firma: r.firma.trim(), strasse: r.strasse.trim(), plzOrt: r.plzOrt.trim() }; await save(); refresh(); } }; $('.chip', row).onclick = async () => { if (await confirmSheet(`Kunde „${k.firma}" löschen?`, 'Löschen')) { st.kunden.splice(i, 1); await save(); refresh(); } }; kc.appendChild(row); });
  if (!st.kunden.length) kc.appendChild(h(`<div class="muted small">Noch keine. In einer Fahrt „Als Kunde speichern“ tippen.</div>`));
  c.appendChild(kc);

  // Bausteine
  for (const [key, title] of [['punkt', 'Textbausteine: Streckenpunkte'], ['besonderheiten', 'Textbausteine: Besonderheiten'], ['schluss', 'Textbausteine: Schlusstext']]) {
    const bc = h(`<div class="card"><div class="row"><h2>${title}</h2><button class="chip">＋</button></div></div>`);
    $('.chip', bc).onclick = async () => { const v = await promptSheet('Neuer Baustein', '', '', true); if (v) { st.bausteine[key].push(v.trim()); await save(); refresh(); } };
    st.bausteine[key].forEach((b, i) => { const row = h(`<div class="check"><button class="grow tap small" style="text-align:left">${esc(b)}</button><button class="chip">✕</button></div>`); $('.grow', row).onclick = async () => { const v = await promptSheet('Baustein bearbeiten', b, '', true); if (v != null) { st.bausteine[key][i] = v.trim(); await save(); refresh(); } }; $('.chip', row).onclick = async () => { if (await confirmSheet('Baustein löschen?', 'Löschen')) { st.bausteine[key].splice(i, 1); await save(); refresh(); } }; bc.appendChild(row); });
    c.appendChild(bc);
  }

  // KI
  const ac = h(`<div class="card" data-sec="ki"><h2>KI (Anthropic)</h2><div class="muted small" style="margin-bottom:8px">Der Schlüssel bleibt nur auf diesem Gerät (nicht in der Sicherung). Bei KI-Funktionen gehen Unterlagen, Fotos bzw. Texte an Anthropic.</div>
    <div class="hint" style="background:#fff8e6;border-radius:10px;padding:8px 10px;margin-bottom:8px;font-size:13px;color:#5a4a00"><b>Wichtig:</b> Die API wird getrennt vom Claude-Abo (Pro/Max) bezahlt. Der Schlüssel funktioniert erst, wenn im API-Konto Guthaben liegt: <b>console.anthropic.com → Billing → Buy credits</b> (ab 5 $). Schlüssel anlegen unter <b>Settings → API keys</b>.</div></div>`);
  const keyF = field(st, 'apiKey', 'API-Schlüssel', { type: 'password', onSave: async () => { st.apiKey = (st.apiKey || '').trim(); await save(); }, placeholder: 'sk-ant-…' });
  const keyInp = $('input', keyF); keyInp.setAttribute('autocomplete', 'off'); keyInp.setAttribute('autocapitalize', 'off'); keyInp.setAttribute('autocorrect', 'off'); keyInp.setAttribute('spellcheck', 'false');
  const eye = h(`<button class="chip" style="margin-top:4px">${st.apiKey ? 'Schlüssel anzeigen' : ''}</button>`); if (st.apiKey) { eye.onclick = () => { const pw = keyInp.type === 'password'; keyInp.type = pw ? 'text' : 'password'; eye.textContent = pw ? 'Schlüssel verbergen' : 'Schlüssel anzeigen'; }; keyF.appendChild(eye); }
  ac.appendChild(keyF);
  const wsF = field(st, 'aiWorkspace', 'Workspace-ID (nur wenn Anthropic sie verlangt)', { onSave: async () => { st.aiWorkspace = (st.aiWorkspace || '').trim(); await save(); }, placeholder: 'wrkspc_…', hint: 'Meldet der Test „nicht an einen Workspace gebunden“: console.anthropic.com → Settings → Workspaces → Workspace anklicken → ID kopieren. Oder dort im Workspace einen neuen Schlüssel anlegen, dann bleibt das Feld leer.' });
  const wsInp = $('input', wsF); wsInp.setAttribute('autocapitalize', 'off'); wsInp.setAttribute('autocorrect', 'off'); wsInp.setAttribute('spellcheck', 'false');
  ac.appendChild(wsF);
  st.aiModel = (st.aiModel || ai.DEFAULT_MODEL).trim();
  const modellListe = () => { const l = [...(st.aiModelle || []), ...ai.MODELLE.filter(m => !(st.aiModelle || []).some(x => x.id === m.id))]; if (!l.some(m => m.id === st.aiModel)) l.unshift({ id: st.aiModel, label: st.aiModel }); return l; };
  const mf = h(`<div class="field"><label>Modell</label><select></select><div class="hint">Standard: Sonnet 5.5. „Verbindung testen“ holt die Liste deines Kontos und wählt bei Bedarf automatisch ein verfügbares Modell.</div></div>`);
  const selM = $('select', mf);
  const fillSel = () => { selM.innerHTML = modellListe().map(m => `<option value="${esc(m.id)}" ${m.id === st.aiModel ? 'selected' : ''}>${esc(m.label)}${m.label !== m.id ? ` (${esc(m.id)})` : ''}</option>`).join('') + '<option value="__eigen">Anderes Modell eingeben …</option>'; };
  fillSel();
  selM.onchange = async () => { if (selM.value === '__eigen') { const v = await promptSheet('Modell-ID', st.aiModel, 'claude-…'); if (v && v.trim()) st.aiModel = v.trim(); fillSel(); } else st.aiModel = selM.value; await save(); };
  ac.appendChild(mf);
  const testRow = h(`<div><button class="btn sec" style="margin-top:4px">Verbindung testen</button><div data-r="res" style="margin-top:6px"></div></div>`);
  const testBtn = $('.btn', testRow), testRes = $('[data-r=res]', testRow);
  testBtn.onclick = async () => {
    flushSaves(); st.apiKey = (st.apiKey || '').trim(); st.aiWorkspace = (st.aiWorkspace || '').trim(); await save();
    if (!st.apiKey) return toast('Erst Schlüssel eintragen');
    testBtn.disabled = true; testBtn.innerHTML = '<span class="spinner" style="border-color:#ccc;border-top-color:#333"></span>Prüfe Schlüssel, Modell, Guthaben …'; testRes.innerHTML = '';
    try {
      const r = await ai.testen();
      if (r.modelle.length) st.aiModelle = r.modelle.slice(0, 20);
      st.aiModel = r.model; await save(); fillSel();
      testRes.innerHTML = `<div class="ok">✓ Alles in Ordnung: Schlüssel gültig, Guthaben vorhanden, Modell ${esc(r.model)} antwortet.</div>`;
    } catch (e) { testRes.innerHTML = `<div class="err">✕ ${esc(e.message)}</div>`; if (e.raw) testRes.appendChild(h(`<div class="muted small" style="word-break:break-all;margin-top:4px">${esc(String(e.raw).slice(0, 220))}</div>`)); }
    testBtn.disabled = false; testBtn.textContent = 'Verbindung testen';
  };
  ac.appendChild(testRow);
  ac.appendChild(toggle('Unterlagen mit dem stärksten Modell lesen', !!st.einstellungen.lesenOpus, async (v) => { st.einstellungen.lesenOpus = v; await save(); }, 'Opus statt Sonnet fürs Einlesen von Antrag/Bescheid – genauer bei schlechten Scans, etwa 5× teurer (ca. 10–40 Cent je Vorgang).'));
  c.appendChild(ac);

  // Speicher & Fotos
  const spc = h(`<div class="card"><h2>Speicher</h2><div data-r="q" class="muted small">Wird ermittelt …</div><div data-r="p" style="margin-top:6px"></div></div>`);
  spc.appendChild(toggle('Fotos verkleinert speichern', !!st.einstellungen.fotoKlein, async (v) => { st.einstellungen.fotoKlein = v; await save(); }, 'Max. 2500 px statt Original – spart etwa 60 % Speicher, für Protokolle völlig ausreichend. Gilt für neue Fotos.'));
  (async () => {
    const q = $('[data-r=q]', spc), pp = $('[data-r=p]', spc);
    try {
      const e = await navigator.storage?.estimate?.();
      const blobs = await db.all('blobs'); const used = blobs.reduce((a, b) => a + (b.size || b.buf?.byteLength || 0), 0);
      q.innerHTML = e ? `Belegt: <b>${fmtMB(e.usage || used)}</b>${e.quota ? ` von ca. ${(e.quota / 1024 / 1024 / 1024).toFixed(1)} GB verfügbar` : ''} · ${blobs.length} Dateien (Fotos, PDFs)` : `${blobs.length} Dateien · ${fmtMB(used)}`;
      const pers = await navigator.storage?.persisted?.();
      if (pers === true) pp.innerHTML = `<div class="muted small">✓ Speicher ist als dauerhaft markiert – das System räumt ihn nicht von selbst weg.</div>`;
      else if (navigator.storage?.persist) { const b = h(`<button class="chip">Speicher dauerhaft sichern</button>`); b.onclick = async () => { const ok = await navigator.storage.persist(); toast(ok ? 'Dauerhaft gesichert' : 'Vom System nicht bestätigt – App auf dem Home-Bildschirm behalten und regelmäßig Sicherung exportieren', 5000); if (ok) refresh(); }; pp.appendChild(b); pp.appendChild(h(`<div class="muted small" style="margin-top:4px">iPhone: Daten bleiben erhalten, solange die App auf dem Home-Bildschirm liegt. Trotzdem regelmäßig „Sicherung exportieren“.</div>`)); }
    } catch (err) { q.textContent = 'Speicherangabe nicht verfügbar'; }
  })();
  c.appendChild(spc);

  // Daten
  const dc = h(`<div class="card"><h2>Daten</h2><div class="muted small" style="margin-bottom:10px">Komplettsicherung aller Fahrten inkl. Fotos als ZIP. Auf dem PC oder Zweitgerät wieder einspielen.</div><div class="btnrow"><button class="btn sec" data-a="exp">Sicherung exportieren</button><button class="btn" data-a="imp">📥 Einspielen</button></div><div class="muted small" style="margin-top:6px">„Einspielen“ nimmt beides: Sicherung und Fahrt-Paket – die App erkennt die Datei selbst.</div><input type="file" accept=".zip,application/zip" class="hidden"><div data-r="st" class="muted small" style="margin-top:8px"></div></div>`);
  const inp = $('input', dc), stat = $('[data-r=st]', dc);
  $('[data-a=exp]', dc).onclick = async () => {
    stat.textContent = 'Wird gepackt …';
    const zip = new JSZip();
    const { apiKey, ...stammOhneKey } = st;
    const blobs = await db.all('blobs');
    const data = { version: 2, exportiert: new Date().toISOString(), fahrten: await db.all('fahrten'), protokolle: await db.all('protokolle'), punkte: await db.all('punkte'), stamm: stammOhneKey, blobs: blobs.map(b => ({ id: b.id, type: b.type, name: b.name, punktId: b.punktId })) };
    zip.file('daten.json', JSON.stringify(data));
    const fl = zip.folder('blobs');
    for (const b of blobs) fl.file(b.id, b.buf ? new Blob([b.buf], { type: b.type }) : b.blob);
    const out = await zip.generateAsync({ type: 'blob' });
    const name = `Streckenprotokoll_Sicherung_${fmtDate(new Date().toISOString()).replace(/\./g, '-')}.zip`;
    const file = new File([out], name, { type: 'application/zip' });
    stat.innerHTML = '';
    stat.appendChild(h(`<div class="ok">${data.fahrten.length} Fahrten, ${data.punkte.length} Punkte, ${blobs.length} Dateien · ${(out.size / 1024 / 1024).toFixed(1)} MB</div>`));
    const shBtn = h(`<button class="btn" style="margin-top:8px">Sicherung teilen / speichern</button>`);
    shBtn.onclick = () => shareFiles([file], name);
    stat.appendChild(shBtn);
    stat.appendChild(h(`<div class="muted small" style="margin-top:6px">Der API-Schlüssel ist nicht in der Sicherung enthalten.</div>`));
  };
  $('[data-a=imp]', dc).onclick = dateiEinspielen;
  c.appendChild(dc);
  // Hilfe & App
  const hc = h(`<div class="card"><h2>Hilfe &amp; App</h2><div class="btnrow"><button class="btn sec" data-a="hilfe">❓ Hilfe-Themen</button><button class="btn sec" data-a="inst">${istInstalliert() ? '✓ Als App installiert' : '📲 Als App installieren'}</button></div></div>`);
  $('[data-a=hilfe]', hc).onclick = () => go('hilfe');
  $('[data-a=inst]', hc).onclick = appInstallieren;
  c.appendChild(hc);
  // Mitarbeiter-Modus
  const mc = h(`<div class="card"><h2>Mitarbeiter-Modus</h2><div class="muted small" style="margin-bottom:10px">Reduzierte Oberfläche für Kollegen: nur Fahrten, Fahrmodus, Punkte prüfen und „Fahrt senden“. Keine KI, keine Stammdaten, kein Erzeugen. Zurück in den vollen Modus nur mit PIN.</div><button class="btn sec">Mitarbeiter-Modus einschalten …</button></div>`);
  $('.btn', mc).onclick = async () => {
    const pin = await promptSheet('PIN festlegen (4–8 Ziffern) – damit kommst du zurück', st.einstellungen.pin || '', 'z. B. 2468');
    if (pin == null) return; if (!/^\d{4,8}$/.test(pin.trim())) return toast('Bitte 4–8 Ziffern');
    if (!(await confirmSheet(`Mitarbeiter-Modus einschalten? Zurück geht es unter Stammdaten mit der PIN ${pin.trim()}.`, 'Einschalten', false))) return;
    st.einstellungen.pin = pin.trim(); st.einstellungen.modus = 'mitarbeiter'; st.einstellungen.maIntroDone = false; await save(); toast('Mitarbeiter-Modus aktiv'); goRoot('fahrten');
  };
  c.appendChild(mc);
  c.appendChild(h(`<div class="muted small" style="text-align:center;margin:10px 0">Streckenprotokoll-App · Version 1.2.1</div>`));
  if (scroll) setTimeout(() => $(`[data-sec=${scroll}]`, s)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 120);
  return s;
};

// Stammdaten im Mitarbeiter-Modus: nur das Nötige
async function stammMA(st, save) {
  const s = screen({ title: 'Einstellungen', back: false, tabbar: 'stamm', help: 'mitarbeiter' });
  const c = content(s);
  c.appendChild(h(`<h1>Einstellungen</h1>`));
  const hc = h(`<div class="card"><h2>Hilfe &amp; App</h2><div class="btnrow"><button class="btn sec" data-a="hilfe">❓ Kurzanleitung</button><button class="btn sec" data-a="inst">${istInstalliert() ? '✓ Als App installiert' : '📲 Als App installieren'}</button></div><button class="btn sec" data-a="emp" style="margin-top:8px">📥 Einspielen (Fahrt-Paket oder Sicherung)</button></div>`);
  $('[data-a=hilfe]', hc).onclick = () => go('hilfe');
  $('[data-a=inst]', hc).onclick = appInstallieren;
  $('[data-a=emp]', hc).onclick = fahrtEmpfangen;
  c.appendChild(hc);
  const spc = h(`<div class="card"><h2>Speicher</h2><div class="muted small" data-r="q">Wird ermittelt …</div></div>`);
  navigator.storage?.estimate?.().then(e => { $('[data-r=q]', spc).textContent = `Belegt: ${fmtMB(e.usage || 0)}`; }).catch(() => {});
  c.appendChild(spc);
  const mc = h(`<div class="card"><h2>Modus</h2><div class="muted small" style="margin-bottom:10px">Mitarbeiter-Modus ist aktiv. Der volle Modus (Texte, KI, PDF, Stammdaten) ist mit PIN geschützt.</div><button class="btn sec">Vollen Modus aktivieren (PIN)</button></div>`);
  $('.btn', mc).onclick = async () => {
    const pin = await promptSheet('PIN eingeben', '', '••••'); if (pin == null) return;
    if (pin.trim() !== String(st.einstellungen.pin || '')) return toast('PIN falsch', 2500);
    st.einstellungen.modus = 'voll'; await save(); toast('Voller Modus aktiv'); goRoot('stamm');
  };
  c.appendChild(mc);
  c.appendChild(h(`<div class="muted small" style="text-align:center;margin:10px 0">Streckenprotokoll-App · Version 1.2.1</div>`));
  return s;
}
async function appInstallieren() {
  if (istInstalliert()) return toast('Die App ist bereits installiert');
  const r = await installieren();
  if (r.anleitung) infoSheet('Als App installieren', r.anleitung);
}
// Kurzanleitung für Mitarbeiter als einseitiges PDF
async function kurzanleitungPdf() {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const st = await getStamm(); const sig = st.signatur || {};
  doc.setFillColor(200, 16, 46); doc.rect(18, 22, 1.6, 15, 'F');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(22); doc.setTextColor(24, 24, 27); doc.text('Streckenprotokoll-App', 24, 31);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10.5); doc.setTextColor(107, 114, 128); doc.text('Kurzanleitung für Mitarbeiter', 24, 37.5);
  let y = 50;
  const steps = HILFE.mitarbeiter.text.split('\n');
  for (const line of steps) {
    const m = line.match(/^(\d)\.\s(.*)$/);
    if (m) { doc.setFillColor(200, 16, 46); doc.circle(22, y + 1.2, 3.4, 'F'); doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.text(m[1], 22, y + 2.4, { align: 'center' }); doc.setTextColor(24, 24, 27); doc.setFontSize(10.5); doc.setFont('helvetica', 'normal'); const ls = doc.splitTextToSize(m[2].replace(/[→]/g, '->').replace(/[⚑]/g, 'Flagge').replace(/[⋯]/g, '...'), 160); ls.forEach((l, i) => doc.text(l, 29, y + 2.4 + i * 5.2)); y += ls.length * 5.2 + 6; }
    else { doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5); doc.setTextColor(24, 24, 27); const ls = doc.splitTextToSize(line, 170); ls.forEach((l, i) => doc.text(l, 18, y + 2.4 + i * 5.2)); y += ls.length * 5.2 + 6; }
  }
  y += 6; doc.setDrawColor(222, 224, 228); doc.line(18, y, 192, y); y += 8;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5); doc.text('Rückfragen', 18, y); y += 5.5;
  doc.setFont('helvetica', 'normal'); doc.setTextColor(55, 58, 64); [sig.name, sig.firma, sig.tel ? 'Tel. ' + sig.tel : ''].filter(Boolean).forEach(l => { doc.text(String(l), 18, y); y += 5; });
  y += 6; doc.setTextColor(107, 114, 128); doc.setFontSize(9); doc.text(`App-Adresse: ${location.origin}${location.pathname}`, 18, y);
  const blob = doc.output('blob');
  shareFiles([new File([blob], 'Kurzanleitung_Streckenprotokoll.pdf', { type: 'application/pdf' })], 'Kurzanleitung');
}
views.hilfe = async () => {
  const s = screen({ title: 'Hilfe' });
  const c = content(s);
  c.appendChild(h(`<h1>Hilfe</h1>`));
  const top = h(`<div class="card"><div class="btnrow"><button class="btn sec" data-a="inst">${istInstalliert() ? '✓ Als App installiert' : '📲 Als App installieren'}</button><button class="btn sec" data-a="pdf">📄 Kurzanleitung (PDF)</button></div><div class="muted small" style="margin-top:8px">Die Kurzanleitung ist eine Seite für Kollegen – zusammen mit dem Fahrt-Paket verschicken.</div></div>`);
  $('[data-a=inst]', top).onclick = appInstallieren; $('[data-a=pdf]', top).onclick = kurzanleitungPdf;
  c.appendChild(top);
  const order = ['mitarbeiter', 'fahrten', 'fahrt', 'fahrmodus', 'punkte', 'punkt', 'editor', 'karte', 'protokoll', 'erzeugen', 'stamm'];
  for (const k of order) {
    const t = HILFE[k]; if (!t) continue;
    const d = h(`<details class="card" style="padding:0"><summary style="padding:14px 16px;font-weight:700;font-size:16px;cursor:pointer;list-style:none;display:flex;justify-content:space-between"><span>${esc(t.titel)}</span><span class="muted">›</span></summary><div class="small" style="padding:0 16px 14px;white-space:pre-wrap;line-height:1.45">${esc(t.text)}</div></details>`);
    c.appendChild(d);
  }
  c.appendChild(h(`<div class="muted small" style="text-align:center;margin:14px 0">Streckenprotokoll-App · Version 1.2.1 · Daten liegen nur auf diesem Gerät</div>`));
  return s;
};

// ---------- Start ----------
if ('serviceWorker' in navigator && location.search.includes('nosw')) navigator.serviceWorker.getRegistrations().then(rs => rs.forEach(r => r.unregister()));
else if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').then(reg => {
  reg.addEventListener('updatefound', () => { const nw = reg.installing; nw?.addEventListener('statechange', () => { if (nw.state === 'installed' && navigator.serviceWorker.controller) toast('Neue Version geladen …', 3000); }); });
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloaded) return; reloaded = true;
    // Auf der Startseite sofort neu laden, sonst Hinweis (nichts geht verloren, alles ist gespeichert)
    if (stack.length <= 1) location.reload(); else toast('Neue Version bereit – App einmal schließen und neu öffnen', 6000);
  });
}).catch(() => {});
navigator.storage?.persist?.();
goRoot('fahrten');
