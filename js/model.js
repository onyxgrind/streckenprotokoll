import { db, uid, getStamm, DEFAULTS, forgetUrl } from './db.js';
import { todayISO, resizeBlob } from './util.js';

export const neueMasse = () => ({ laenge: '', breite: '', hoehe: '', absenkbar: '', leerZug: '', leerAnh: '', gesamt: '' });

export const teilName = (t) => `${t.nr} – ${t.bezeichnung || 'Lastfahrt'}`;
export function neuerTeil(nr = '1.1', bezeichnung = 'Lastfahrt') {
  return { id: uid(), nr, bezeichnung, name: `${nr} – ${bezeichnung}`, start: '', strecke: '', ziel: '', besonderheiten: '', alt: { aktiv: false, strecke: '', hinweis: '' }, masse: neueMasse(), leer: neueMasse(), leerZeigen: false };
}

export const model = {
  // ---------- Fahrten ----------
  async fahrten() { const f = await db.all('fahrten'); return f.sort((a, b) => (b.datum || '').localeCompare(a.datum || '') || b.createdAt - a.createdAt); },
  async neueFahrt(data = {}) {
    const stamm = await getStamm();
    const f = { id: uid(), titel: '', kunde: { firma: '', strasse: '', plzOrt: '' }, datum: todayISO(), notiz: '', unterlagen: [], checkliste: [], status: 'entwurf', createdAt: Date.now(), ...data };
    await db.put('fahrten', f);
    const p = await this.neuesProtokoll(f.id, { empfaenger: { ...f.kunde } });
    f.checkliste = [{ id: uid(), label: 'Hinweg', protokollId: p.id, teilId: p.teile[0].id, done: false }, { id: uid(), label: 'Rückweg', protokollId: '', teilId: '', done: false, optional: true }];
    await db.put('fahrten', f);
    return f;
  },
  saveFahrt: (f) => db.put('fahrten', f),
  async deleteFahrt(id) {
    const ps = await db.byIndex('punkte', 'fahrtId', id);
    for (const p of ps) { for (const b of p.bilder || []) { await db.del('blobs', b.blobId); if (b.thumbId) await db.del('blobs', b.thumbId); } await db.del('punkte', p.id); }
    const prs = await db.byIndex('protokolle', 'fahrtId', id);
    for (const pr of prs) await db.del('protokolle', pr.id);
    const f = await db.get('fahrten', id);
    if (f?.antragBlobId) await db.del('blobs', f.antragBlobId);
    for (const u of f?.unterlagen || []) await db.del('blobs', u.blobId);
    await db.del('fahrten', id);
  },

  // ---------- Protokolle ----------
  async protokolle(fahrtId) { const p = await db.byIndex('protokolle', 'fahrtId', fahrtId); return p.sort((a, b) => a.createdAt - b.createdAt); },
  async neuesProtokoll(fahrtId, data = {}) {
    const stamm = await getStamm();
    const f = await db.get('fahrten', fahrtId);
    const n = (await db.byIndex('protokolle', 'fahrtId', fahrtId)).length + 1;
    const p = { id: uid(), fahrtId, titel: n === 1 ? 'Protokoll' : `Protokoll ${n}`, datum: f?.datum || todayISO(), empfaenger: { firma: '', strasse: '', plzOrt: '' }, teile: [neuerTeil('1.1')], schlusstext: stamm.schlusstext || DEFAULTS.schlusstext, status: 'entwurf', createdAt: Date.now(), ...data };
    await db.put('protokolle', p);
    return p;
  },
  saveProtokoll: (p) => db.put('protokolle', p),
  async deleteProtokoll(id) {
    const pr = await db.get('protokolle', id);
    const ps = await db.byIndex('punkte', 'protokollId', id);
    for (const p of ps) { for (const b of p.bilder || []) { await db.del('blobs', b.blobId); forgetUrl(b.blobId); if (b.thumbId) await db.del('blobs', b.thumbId); } await db.del('punkte', p.id); }
    await db.del('protokolle', id);
    if (pr) { const f = await db.get('fahrten', pr.fahrtId); if (f) { let ch = false; for (const it of f.checkliste || []) if (it.protokollId === id) { it.protokollId = ''; it.teilId = ''; it.done = false; ch = true; } if (ch) await db.put('fahrten', f); } }
  },
  async kopiereProtokoll(src, mitPunkten = false) {
    const p = JSON.parse(JSON.stringify(src));
    p.id = uid(); p.titel = src.titel + ' (Kopie)'; p.status = 'entwurf'; p.createdAt = Date.now();
    const idMap = {};
    p.teile.forEach(t => { const nid = uid(); idMap[t.id] = nid; t.id = nid; });
    await db.put('protokolle', p);
    if (mitPunkten) {
      const pts = await this.punkte(src.id);
      for (const q of pts) {
        const c = JSON.parse(JSON.stringify(q)); c.id = uid(); c.protokollId = p.id; c.teilId = idMap[q.teilId] || p.teile[0].id;
        // Bilder duplizieren
        c.bilder = []; const z = {};
        for (const b of q.bilder || []) { const blob = await db.getBlob(b.blobId); if (blob) { const nb = await db.putBlob(blob, { punktId: c.id }); let nt = ''; if (b.thumbId) { const tb = await db.getBlob(b.thumbId); if (tb) nt = await db.putBlob(tb, { punktId: c.id, thumb: true }); } const nid = uid(); c.bilder.push({ ...b, id: nid, blobId: nb, thumbId: nt }); if (q.zeichnung?.[b.id]) z[nid] = JSON.parse(JSON.stringify(q.zeichnung[b.id])); } }
        c.zeichnung = z;
        await db.put('punkte', c);
      }
    }
    return p;
  },

  // ---------- Punkte ----------
  async punkte(protokollId, teilId) {
    const ps = await db.byIndex('punkte', 'protokollId', protokollId);
    return ps.filter(p => !teilId || p.teilId === teilId).sort((a, b) => a.reihenfolge - b.reihenfolge || a.zeit - b.zeit);
  },
  async countPunkte(protokollId, teilId) { return (await this.punkte(protokollId, teilId)).length; },
  hatText: (q) => !!((q.text || '').trim() || (q.strasse || '').trim()),
  // Bezeichnung eines Punkts in Listen/Karte (S, Z, ⚑, laufende Nummer)
  label(q, list) { if (q.nachpruefen) return '⚑'; if (q.typ === 'start') return 'S'; if (q.typ === 'ziel') return 'Z'; const l = list.filter(x => !x.nachpruefen && x.typ !== 'start' && x.typ !== 'ziel'); return String(l.indexOf(q) + 1); },
  async movePunkt(q, protokollId, teilId, altRoute = false) {
    q.protokollId = protokollId; q.teilId = teilId; q.altRoute = altRoute;
    q.reihenfolge = await this.nextReihenfolge(protokollId, teilId);
    await db.put('punkte', q);
  },
  async nextReihenfolge(protokollId, teilId) { const pts = await this.punkte(protokollId, teilId); return (pts.length ? Math.max(...pts.map(p => p.reihenfolge || 0)) : 0) + 10; },
  async addPunkt(protokollId, teilId, data = {}) {
    const pr = await db.get('protokolle', protokollId);
    if (!pr) throw new Error('Protokoll nicht gefunden');
    const p = { id: uid(), fahrtId: pr.fahrtId, protokollId, teilId, altRoute: false, typ: 'strasse', reihenfolge: await this.nextReihenfolge(protokollId, teilId), bilder: [], layout: 'auto', zeichnung: {}, strasse: '', strasseVorschlag: '', text: '', mess: { breite: '', hoehe: '', laenge: '', bruecke: '' }, gps: null, zeit: Date.now(), nachpruefen: false, notiz: '', ...data };
    await db.put('punkte', p);
    return p;
  },
  savePunkt: (p) => db.put('punkte', p),
  // Bild (Blob) an Punkt hängen: Original + kleines Vorschaubild
  async addBild(p, blob, meta = {}) {
    const blobId = await db.putBlob(blob, { punktId: p.id, ...meta });
    let thumbId = '';
    try { const th = await resizeBlob(blob, 320, 0.8); thumbId = await db.putBlob(th, { punktId: p.id, thumb: true }); } catch (e) { /* ohne Vorschau */ }
    const b = { id: uid(), blobId, thumbId, gewaehlt: !p.bilder.some(x => x.gewaehlt) };
    p.bilder.push(b);
    return b;
  },
  async delBild(p, b) { await db.del('blobs', b.blobId); forgetUrl(b.blobId); if (b.thumbId) { await db.del('blobs', b.thumbId); forgetUrl(b.thumbId); } p.bilder = p.bilder.filter(x => x.id !== b.id); },
  async deletePunkt(p) { for (const b of p.bilder || []) { await db.del('blobs', b.blobId); forgetUrl(b.blobId); if (b.thumbId) await db.del('blobs', b.thumbId); } await db.del('punkte', p.id); },
  async reorder(list) { for (let i = 0; i < list.length; i++) { if (list[i].reihenfolge !== (i + 1) * 10) { list[i].reihenfolge = (i + 1) * 10; await db.put('punkte', list[i]); } } },

  // Bildunterschrift zusammensetzen
  // Bildunterschrift: nur bestätigte Straße (p.strasse), der GPS-Vorschlag landet nie ungeprüft im Protokoll
  caption(p) {
    const pre = p.typ === 'start' ? 'Start' : p.typ === 'ziel' ? 'Ziel' : p.typ === 'frei' ? '' : 'Straße';
    const s = (p.strasse || '').trim();
    const t = (p.text || '').trim();
    let out;
    if (!pre) out = [s, t].filter(Boolean).join(', ');
    else if (s) out = `${pre}: ${s}${t ? ', ' + t : ''}`;
    else out = t ? `${pre}: ${t}` : `${pre}:`;
    const m = [];
    if (p.mess?.bruecke) m.push(`Brückenhöhe gemessen: ${p.mess.bruecke} m`);
    if (p.mess?.breite) m.push(`Breite: ${p.mess.breite} m`);
    if (p.mess?.hoehe) m.push(`Höhe: ${p.mess.hoehe} m`);
    if (p.mess?.laenge) m.push(`Länge: ${p.mess.laenge} m`);
    return { text: out, mess: m };
  },

  // Vollständigkeitsprüfung
  async pruefen(protokoll) {
    const issues = [];
    const ok = (label, target) => issues.push({ level: 'ok', label, target });
    const warn = (label, target) => issues.push({ level: 'warn', label, target });
    const bad = (label, target) => issues.push({ level: 'bad', label, target });
    const kopf = { view: 'protokoll', params: { id: protokoll.id } };
    if (protokoll.empfaenger?.firma && protokoll.datum) ok('Empfänger und Datum', kopf); else bad('Empfänger oder Datum fehlt', kopf);
    for (const t of protokoll.teile) {
      const pts = await this.punkte(protokoll.id, t.id);
      const liste = { view: 'punkte', params: { protokollId: protokoll.id, teilId: t.id } };
      if (t.start && t.ziel && t.strecke) ok(`${t.nr}: Start, Strecke, Ziel`, kopf); else bad(`${t.nr}: Start, Strecke oder Ziel fehlt`, kopf);
      const m = t.masse || {}; if (m.laenge && m.breite && m.hoehe && m.gesamt) ok(`${t.nr}: Maßtabelle`, kopf); else warn(`${t.nr}: Maßtabelle unvollständig`, kopf);
      if (!pts.length) bad(`${t.nr}: keine Streckenpunkte`, liste);
      else {
        const haupt = pts.filter(p => !p.altRoute);
        const ohneText = pts.filter(p => !this.hatText(p));
        if (ohneText.length) warn(`${t.nr}: ${ohneText.length} Punkt(e) ohne Text (Nr. ${ohneText.map(p => this.label(p, p.altRoute ? pts.filter(x => x.altRoute) : haupt)).join(', ')})`, { view: 'punkt', params: { id: ohneText[0].id } }); else ok(`${t.nr}: alle ${pts.length} Punkte beschrieben`, liste);
        const unbest = pts.filter(p => !(p.strasse || '').trim() && p.strasseVorschlag);
        if (unbest.length) warn(`${t.nr}: ${unbest.length} Punkt(e) mit unbestätigtem Straßenvorschlag`, { view: 'punkt', params: { id: unbest[0].id } });
        const ohneBild = pts.filter(p => !p.bilder?.length); if (ohneBild.length) warn(`${t.nr}: ${ohneBild.length} Punkt(e) ohne Bild`, { view: 'punkt', params: { id: ohneBild[0].id } });
        const flags = pts.filter(p => p.nachpruefen); if (flags.length) warn(`${t.nr}: ${flags.length} Nachprüf-Punkt(e) offen`, { view: 'punkte', params: { ...liste.params, tab: 'flag' } });
        if (!pts.some(p => p.typ === 'start')) warn(`${t.nr}: kein Punkt als „Start" markiert`, liste);
        if (!pts.some(p => p.typ === 'ziel')) warn(`${t.nr}: kein Punkt als „Ziel" markiert`, liste);
        const altN = pts.filter(p => p.altRoute).length; if (altN && !t.alt?.aktiv) warn(`${t.nr}: Alternativroute ist ausgeschaltet, aber ${altN} Punkt(e) zugeordnet`, kopf);
        // Straßen aus Streckentext ohne Punkt
        const tokens = (t.strecke || '').split(/\s[–-]\s|\s-\s/).map(s => s.trim()).filter(s => /^[ABKL]\s?\d+/.test(s));
        const alltext = pts.map(p => (p.strasse + ' ' + p.text).toLowerCase()).join(' ');
        const fehlend = tokens.filter(tk => !alltext.includes(tk.toLowerCase().replace(/\s/g, '')) && !alltext.includes(tk.toLowerCase()));
        if (fehlend.length) warn(`${t.nr}: im Streckentext ohne Punkt: ${[...new Set(fehlend)].join(', ')}`, liste);
      }
    }
    const f = await db.get('fahrten', protokoll.fahrtId);
    for (const c of f?.checkliste || []) if (!c.done && !c.optional) bad(`Fahrt-Check offen: ${c.label}`, { view: 'fahrt', params: { id: protokoll.fahrtId } });
    return issues;
  },
};
