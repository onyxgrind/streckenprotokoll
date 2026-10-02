// Ausgabe: PDF (jsPDF), Word (docx), ZIP (JSZip)
import { db, blobUrl, getStamm } from './db.js';
import { model } from './model.js';
import { fmtDate, fmtNum, loadImage, loadOriented, safeName, blobToDataURL, applyCrop, shiftShapes } from './util.js';
import { composite } from './draw.js';

// ---------- Bilder vorbereiten ----------
// mode: 'dataUrl' (PDF) oder 'bytes' (Word). Wird je Punkt erst beim Rendern aufgerufen, damit nicht alle Bilder gleichzeitig im Speicher liegen.
async function preparePunktImages(p, mode, maxSide = 1600) {
  const out = [];
  const chosen = (p.bilder || []).filter(b => b.gewaehlt);
  const list = chosen.length ? chosen : (p.bilder || []).slice(0, 1);
  for (const b of list) {
    const url = await blobUrl(b.blobId); if (!url) continue;
    const full = await loadOriented(url, b.rot || 0);
    const { img, ox, oy } = await applyCrop(full, b.crop);
    const shapes = shiftShapes(p.zeichnung?.[b.id] || [], -ox, -oy);
    const blob = await composite(img, shapes, maxSide);
    const tmp = URL.createObjectURL(blob);
    let w, h;
    try { const im2 = await loadImage(tmp); w = im2.naturalWidth; h = im2.naturalHeight; } finally { URL.revokeObjectURL(tmp); }
    const item = { w, h };
    if (mode === 'bytes') item.bytes = new Uint8Array(await blob.arrayBuffer()); else item.dataUrl = await blobToDataURL(blob);
    out.push(item);
  }
  return out;
}
// Zeichen, die die PDF-Standardschrift nicht kennt, ersetzen
const pdfSafe = (s) => String(s ?? '').replace(/[→]/g, '->').replace(/[✓✔]/g, 'x').replace(/[⚑]/g, '').replace(/[\u2010-\u2012]/g, '-').replace(/[^\u0000-\u00FF\u2013\u2014\u2018\u2019\u201A\u201C\u201D\u201E\u2022\u2026\u20AC\u2122]/g, '?');

// **fett** → Runs
function runs(text) {
  const parts = String(text || '').split('**');
  return parts.map((t, i) => ({ text: t, bold: i % 2 === 1 })).filter(r => r.text.length);
}

const leereMasse = () => ({ laenge: '', breite: '', hoehe: '', absenkbar: '', leerZug: '', leerAnh: '', gesamt: '' });
async function collect(protokoll) {
  const stamm = await getStamm();
  const teile = [];
  for (const t of protokoll.teile) {
    t.masse = { ...leereMasse(), ...(t.masse || {}) }; t.leer = { ...leereMasse(), ...(t.leer || {}) };
    const pts = await model.punkte(protokoll.id, t.id);
    const haupt = [], alt = [];
    for (const p of pts) (p.altRoute ? alt : haupt).push({ p, cap: model.caption(p) });
    teile.push({ t, haupt, alt });
  }
  let logo = null;
  if (stamm.einstellungen?.logoBlobId) {
    const b = await db.getBlob(stamm.einstellungen.logoBlobId);
    if (b && /image\/(png|jpeg)/.test(b.type)) { const u = URL.createObjectURL(b); try { const im = await loadImage(u); logo = { dataUrl: await blobToDataURL(b), bytes: new Uint8Array(await b.arrayBuffer()), w: im.naturalWidth, h: im.naturalHeight, type: b.type }; } catch (err) { logo = null; } finally { URL.revokeObjectURL(u); } }
  }
  return { stamm, teile, logo };
}

export function dateiname(protokoll, fahrt, ext) {
  const t = protokoll.teile[0] || {};
  const kunde = safeName((protokoll.empfaenger?.firma || fahrt?.kunde?.firma || 'Kunde').split(/\s+/).slice(0, 2).join(' '));
  const ziel = safeName((t.ziel || '').replace(/\{.*\}/, '').split(',').pop() || '');
  return `Streckenprotokoll_${fmtDate(protokoll.datum)}_${kunde}${ziel ? '_' + ziel : ''}${protokoll.teile.length > 1 || protokoll.titel !== 'Protokoll' ? '_' + safeName(protokoll.titel) : ''}.${ext}`;
}

// =====================================================================
// PDF – ruhiges, modernes Layout: Deckblatt · Punkte · Abschluss
// =====================================================================
export async function buildPdf(protokoll, fahrt, opts = {}) {
  const { stamm, teile, logo } = await collect(protokoll);
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
  const W = 210, H = 297, ML = 18, MR = 18, MT = 25, MB = 20, CW = W - ML - MR;
  const RED = [200, 16, 46], DARK = [24, 24, 27], GREY = [107, 114, 128], LINE = [222, 224, 228], FILL = [246, 247, 249];
  const GREEN = [22, 163, 74], AMBER = [224, 161, 0], SLATE = [55, 58, 64];
  const sig = stamm.signatur;
  const logoPos = stamm.einstellungen?.logoPos || 'beide';
  const logoType = logo ? (logo.type.includes('png') ? 'PNG' : 'JPEG') : '';
  const e = protokoll.empfaenger || {};
  const kurz = pdfSafe(`Streckenprotokoll  ·  ${(e.firma || '').slice(0, 50)}  ·  ${fmtDate(protokoll.datum)}`);
  let y = MT, page = 1;

  const setT = (size, style = 'normal', color = DARK) => { doc.setFont('helvetica', style); doc.setFontSize(size); doc.setTextColor(...color); };
  const hair = (x1, y1, x2, y2, c = LINE, w = 0.25) => { doc.setDrawColor(...c); doc.setLineWidth(w); doc.line(x1, y1, x2, y2); };
  const fitLine = (text, width) => { const ls = doc.splitTextToSize(pdfSafe(text || ''), width); return ls.length > 1 ? ls[0].replace(/\s*\S*$/, '') + ' …' : (ls[0] || ''); };

  const header = () => {
    setT(10.5, 'bold', RED); doc.text(pdfSafe(sig.firma || ''), ML, 13);
    setT(7.5, 'normal', GREY); doc.text(pdfSafe([sig.strasse, sig.ort, sig.name, sig.tel ? 'Tel. ' + sig.tel : ''].filter(Boolean).join('   ·   ')), W - MR, 13, { align: 'right' });
    hair(ML, 17, W - MR, 17);
  };
  const footer = () => { hair(ML, H - 13, W - MR, H - 13); setT(7.5, 'normal', GREY); doc.text(kurz, ML, H - 9); };
  const newPage = () => { footer(); doc.addPage(); page++; header(); y = MT; };
  const need = (hgt) => { if (y + hgt > H - MB) newPage(); };

  // Fließtext mit **fett**
  const richText = (text, x, width, size = 10.5, lineH = 5.2, baseBold = false) => {
    setT(size, 'normal', DARK);
    const paras = []; let cur = [];
    for (const r of runs(pdfSafe(text))) {
      r.text.split('\n').forEach((seg, i) => { if (i > 0) { paras.push(cur); cur = []; } seg.split(/(\s+)/).filter(w => w.length).forEach(w => cur.push({ w, bold: r.bold || baseBold })); });
    }
    paras.push(cur);
    for (const para of paras) {
      let line = [], lw = 0;
      const flush = () => { need(lineH); let cx = x; for (const tk of line) { doc.setFont('helvetica', tk.bold ? 'bold' : 'normal'); doc.text(tk.w, cx, y); cx += doc.getTextWidth(tk.w); } y += lineH; line = []; lw = 0; };
      for (const tk of para) {
        doc.setFont('helvetica', tk.bold ? 'bold' : 'normal');
        const ww = doc.getTextWidth(tk.w);
        if (lw + ww > width && line.length && !/^\s+$/.test(tk.w)) flush();
        if (/^\s+$/.test(tk.w) && !line.length) continue;
        line.push(tk); lw += ww;
      }
      if (line.length) flush(); else y += lineH * .6;
    }
    doc.setFont('helvetica', 'normal');
  };
  const label = (t) => { need(9); setT(6.8, 'bold', RED); doc.setCharSpace(0.45); doc.text(pdfSafe(t).toUpperCase(), ML, y); doc.setCharSpace(0); y += 4.4; };
  const block = (lbl, text, bold = false) => { if (!text) return; need(16); label(lbl); richText(text, ML, CW, 10.5, 5.2, bold); y += 5; };
  // Bild mit runden Ecken und Haarlinie
  const image = (dataUrl, x, yy, w, h) => {
    try { doc.saveGraphicsState(); doc.roundedRect(x, yy, w, h, 2, 2, null); doc.clip(); doc.discardPath(); doc.addImage(dataUrl, 'JPEG', x, yy, w, h); doc.restoreGraphicsState(); }
    catch (err) { try { doc.restoreGraphicsState(); } catch (e2) { /* egal */ } doc.addImage(dataUrl, 'JPEG', x, yy, w, h); }
    doc.setDrawColor(...LINE); doc.setLineWidth(0.3); doc.roundedRect(x, yy, w, h, 2, 2, 'S');
  };

  // ---------- Deckblatt ----------
  header();
  let titleY = 32;
  if (logo && (logoPos === 'deckblatt' || logoPos === 'beide')) {
    const maxW = 44, maxH = 17; let lw = maxW, lh = lw * logo.h / logo.w; if (lh > maxH) { lh = maxH; lw = lh * logo.w / logo.h; }
    doc.addImage(logo.dataUrl, logoType, W - MR - lw, 22, lw, lh);
  }
  y = titleY;
  doc.setFillColor(...RED); doc.rect(ML, y, 1.6, 15, 'F');
  setT(24, 'bold', DARK); doc.text('Streckenprotokoll', ML + 6, y + 9.5);
  setT(10, 'normal', GREY); doc.text(pdfSafe(`außerhalb BAB   ·   vom ${fmtDate(protokoll.datum)}${teile.length > 1 ? `   ·   ${teile.length} Fahrtwegteile` : ''}`), ML + 6, y + 16);
  y += 26;
  // Info-Karte (drei Spalten; erste Zeile darf zweizeilig umbrechen)
  const col = CW / 3;
  const cellsData = [
    ['AN DIE FIRMA', [e.firma || '–', e.strasse, e.plzOrt]],
    ['STRECKENPRÜFUNG', [sig.name, sig.firma, sig.tel ? 'Tel. ' + sig.tel : '']],
    ['DATUM · UMFANG', [fmtDate(protokoll.datum), protokoll.titel && protokoll.titel !== 'Protokoll' ? protokoll.titel : '', teile.length === 1 ? teile[0].t.name : `${teile.length} Fahrtwegteile`]],
  ].map(([lbl, lines]) => {
    const L = lines.filter(Boolean).slice(0, 3);
    setT(10.5, 'bold', DARK); const head = doc.splitTextToSize(pdfSafe(L[0] || ''), col - 9).slice(0, 2);
    const rest = L.slice(1).map(l => fitLine(l, col - 9));
    return { lbl, head, rest, h: 13.5 + head.length * 5.2 + rest.length * 4.6 + 3 };
  });
  const cardH = Math.max(30, ...cellsData.map(c => c.h));
  doc.setFillColor(...FILL); doc.roundedRect(ML, y, CW, cardH, 2.5, 2.5, 'F');
  cellsData.forEach((c, i) => {
    const cx = ML + 5 + i * col;
    setT(6.8, 'bold', GREY); doc.setCharSpace(0.35); doc.text(c.lbl, cx, y + 7.5); doc.setCharSpace(0);
    let yy = y + 13.5;
    setT(10.5, 'bold', DARK); c.head.forEach(l => { doc.text(l, cx, yy); yy += 5.2; });
    setT(9, 'normal', SLATE); c.rest.forEach(l => { doc.text(l, cx, yy); yy += 4.6; });
  });
  y += cardH + 11;

  for (let ti = 0; ti < teile.length; ti++) {
    const { t, haupt, alt } = teile[ti];
    if (ti > 0) newPage();
    if (teile.length > 1 || t.nr !== '1.1') { need(16); setT(14, 'bold', DARK); doc.text(pdfSafe(t.name), ML, y + 4); hair(ML, y + 7.5, ML + 18, y + 7.5, RED, 0.9); y += 15; }
    block('Start', t.start, true); block('Strecke', t.strecke, true); block('Ziel', t.ziel, true);
    if (t.alt?.aktiv && t.alt.strecke) block('Alternativroute', (t.alt.hinweis ? t.alt.hinweis + '\n' : '') + t.alt.strecke, true);
    block('Besonderheiten', t.besonderheiten, false);

    // Maßtabelle
    need(34); label('Transportabmessungen Lastfahrt · Maße und Massen'); y += 1.5;
    const cols = ['', 'Länge [m]', 'Breite [m]', 'Höhe [m]', 'Transporthöhe\nabsenkbar auf [m]', 'Leermasse\nZugfahrzeug [t]', 'Leermasse\nAnhänger [t]', 'Gesamt [t]'];
    const base = [22, 17, 17, 17, 26, 26, 24, 20], sum = base.reduce((a, b) => a + b, 0), cw = base.map(v => v * CW / sum), rowH = 8, headH = 10.5;
    let x = ML; doc.setFillColor(...FILL); doc.rect(ML, y, CW, headH, 'F');
    setT(6.8, 'bold', GREY);
    cols.forEach((c, i) => { const ls = c.split('\n'); ls.forEach((l, k) => doc.text(l, i === 0 ? x + 2.5 : x + cw[i] - 2.5, y + (ls.length === 1 ? 6.5 : 4.4 + k * 3.6), { align: i === 0 ? 'left' : 'right' })); x += cw[i]; });
    y += headH; hair(ML, y, W - MR, y, LINE, 0.4);
    const rows = [['Lastfahrt', t.masse]]; if (t.leerZeigen) rows.unshift(['Leerfahrt', t.leer]);
    rows.forEach(([name, m], ri) => {
      x = ML; if (ri % 2 === 1) { doc.setFillColor(...FILL); doc.rect(ML, y, CW, rowH, 'F'); }
      const vals = [name, m.laenge, m.breite, m.hoehe, m.absenkbar, m.leerZug, m.leerAnh, m.gesamt];
      vals.forEach((v, i) => { setT(9.5, i === 0 ? 'bold' : 'normal', DARK); doc.text(pdfSafe(i === 0 ? v : fmtNum(v)), i === 0 ? x + 2.5 : x + cw[i] - 2.5, y + 5.4, { align: i === 0 ? 'left' : 'right' }); x += cw[i]; });
      y += rowH; hair(ML, y, W - MR, y);
    });
    y += 9;

    // ---------- Punkte ----------
    const drawPunkte = async (list, heading) => {
      if (heading) { need(16); setT(13, 'bold', DARK); doc.text(pdfSafe(heading), ML, y + 4); hair(ML, y + 7.5, ML + 18, y + 7.5, RED, 0.9); y += 15; }
      let n = 0;
      for (const { p, cap } of list) {
        n++;
        const imgs = await preparePunktImages(p, 'dataUrl');
        opts.onProgress?.();
        let twoUp = false, imgH = 0, layout = [];
        if (imgs.length) {
          twoUp = imgs.length >= 2 && (p.layout === 'nebeneinander' || (p.layout === 'auto' && imgs.every(i => i.h > i.w * 0.9)));
          if (twoUp) {
            const gap = 4, w = (CW - gap) / 2;
            layout = imgs.slice(0, 2).map((im, i) => { let hgt = w * im.h / im.w, ww = w; if (hgt > 112) { hgt = 112; ww = hgt * im.w / im.h; } return { im, x: ML + i * (w + gap) + (w - ww) / 2, w: ww, h: hgt }; });
            imgH = Math.max(...layout.map(l => l.h)); layout.forEach(l => { l.yOff = (imgH - l.h) / 2; });
          } else {
            layout = imgs.map(im => { const maxH = im.h > im.w ? 118 : 94; let w = CW, hgt = w * im.h / im.w; if (hgt > maxH) { hgt = maxH; w = hgt * im.w / im.h; } return { im, x: ML + (CW - w) / 2, w, h: hgt }; });
          }
        }
        setT(10.5, 'bold', DARK);
        const capText = pdfSafe(cap.text);
        const capLines = doc.splitTextToSize(capText || ' ', CW - 13);
        const textH = Math.max(8, capLines.length * 5 + 2) + (cap.mess.length ? 5 : 0) + 10;
        const firstImgH = twoUp ? imgH : (layout[0]?.h || 0);
        need(Math.min(firstImgH + textH, H - MT - MB - 2));
        if (twoUp) { layout.forEach(l => image(l.im.dataUrl, l.x, y + l.yOff, l.w, l.h)); y += imgH + 5; }
        else { for (const l of layout) { need(l.h + 6); image(l.im.dataUrl, l.x, y, l.w, l.h); y += l.h + 4; } y += 1; }
        // Nummer + Bildunterschrift
        need(Math.max(8, capLines.length * 5 + 2));
        const col = p.nachpruefen ? AMBER : p.typ === 'start' ? GREEN : p.typ === 'ziel' ? RED : SLATE;
        doc.setFillColor(...col); doc.circle(ML + 4, y + 3.4, 3.6, 'F');
        setT(8.5, 'bold', [255, 255, 255]); doc.text(String(n), ML + 4, y + 4.7, { align: 'center' });
        setT(10.5, 'bold', DARK);
        capLines.forEach((ln, i) => { if (i > 0) need(5); doc.text(ln, ML + 11, y + 4.6 + i * 5); });
        y += Math.max(8, capLines.length * 5 + 2);
        if (cap.mess.length) { setT(8.5, 'normal', GREY); doc.text(pdfSafe(cap.mess.join('   ·   ')), ML + 11, y + 3); y += 5; }
        if (stamm.einstellungen?.koordinatenImPdf && p.gps) { setT(7.5, 'normal', GREY); doc.text(`${p.gps.lat.toFixed(5)}, ${p.gps.lon.toFixed(5)}`, ML + 11, y + 3); y += 4.5; }
        y += 6;
        if (n < list.length) { hair(ML, y, W - MR, y); y += 8; }
      }
    };
    if (haupt.length || alt.length) newPage(); // Deckblatt bleibt für sich
    await drawPunkte(haupt, null);
    if (alt.length) { if (y > MT + 10) newPage(); await drawPunkte(alt, `${t.nr} – Alternativroute`); }
  }

  // ---------- Abschluss auf eigener Seite ----------
  if (y > MT + 10) newPage();
  y += 6;
  label('Ergebnis der Streckenprüfung');
  setT(11, 'normal', DARK);
  for (const para of pdfSafe(protokoll.schlusstext || '').split('\n')) {
    if (!para.trim()) { y += 3; continue; }
    for (const ln of doc.splitTextToSize(para, CW)) { need(5.8); doc.text(ln, ML, y + 4); y += 5.8; }
  }
  y += 14;
  if (logo && (logoPos === 'schluss' || logoPos === 'beide')) { const maxW = 52, maxH = 24; let lw = maxW, lh = lw * logo.h / logo.w; if (lh > maxH) { lh = maxH; lw = lh * logo.w / logo.h; } need(lh + 20); doc.addImage(logo.dataUrl, logoType, ML, y, lw, lh); y += lh + 8; }
  need(24);
  setT(10.5, 'bold', DARK); doc.text(pdfSafe(sig.name || ''), ML, y + 4);
  setT(9.5, 'normal', SLATE);
  [sig.firma, [sig.strasse, sig.ort].filter(Boolean).join(', '), sig.tel ? `Tel. ${sig.tel}` : ''].filter(Boolean).forEach((l, i) => doc.text(pdfSafe(l), ML, y + 9.5 + i * 4.6));
  footer();
  const total = doc.getNumberOfPages();
  for (let i = 1; i <= total; i++) { doc.setPage(i); setT(7.5, 'normal', GREY); doc.text(`Seite ${i} von ${total}`, W - MR, H - 9, { align: 'right' }); }
  doc.setProperties({ title: `Streckenprotokoll ${fmtDate(protokoll.datum)}`, author: sig.name, creator: 'Streckenprotokoll-App' });
  return doc.output('blob');
}

// =====================================================================
// WORD
// =====================================================================
export async function buildDocx(protokoll, fahrt, opts = {}) {
  const { stamm, teile, logo } = await collect(protokoll);
  const D = window.docx;
  const { Document, Packer, Paragraph, TextRun, ImageRun, Table, TableRow, TableCell, WidthType, AlignmentType, BorderStyle, Header, Footer, PageNumber, ShadingType, Tab } = D;
  const sig = stamm.signatur;
  const RED = 'C8102E', GREY = '6B7280', DARK = '18181B', SLATE = '373A40', LINE = 'DEE0E4', FILL = 'F6F7F9';
  const logoPos = stamm.einstellungen?.logoPos || 'beide';
  const cm = (v) => Math.round(v * 567); // twips
  const px = (v) => v; // Pixel für ImageRun
  const children = [];
  const P = (opts, runsArr) => new Paragraph({ ...opts, children: runsArr });
  const R = (text, o = {}) => new TextRun({ text, font: 'Arial', size: o.size || 21, bold: !!o.bold, color: o.color, break: o.break });
  const richRuns = (text, size = 21, baseBold = false) => {
    const out = [];
    runs(text).forEach(r => r.text.split('\n').forEach((seg, i) => { if (i > 0) out.push(new TextRun({ text: '', break: 1 })); if (seg) out.push(R(seg, { size, bold: r.bold || baseBold })); }));
    return out;
  };
  const labelPara = (t) => P({ spacing: { before: 220, after: 40 } }, [new TextRun({ text: t.toUpperCase(), font: 'Arial', size: 14, bold: true, color: RED, characterSpacing: 20 })]);
  const block = (lbl, text, bold = true) => { if (!text) return; children.push(labelPara(lbl)); children.push(P({ spacing: { after: 140 } }, richRuns(text, 21, bold))); };

  const e = protokoll.empfaenger || {};
  if (logo && (logoPos === 'deckblatt' || logoPos === 'beide')) { const lw = 150, lh = Math.round(lw * logo.h / logo.w); children.push(P({ alignment: AlignmentType.RIGHT, spacing: { after: 60 } }, [new ImageRun({ type: logo.type.includes('png') ? 'png' : 'jpg', data: logo.bytes, transformation: { width: lw, height: Math.min(lh, 60) } })])); }
  children.push(P({ spacing: { after: 40 }, border: { left: { style: BorderStyle.SINGLE, size: 24, color: RED, space: 10 } } }, [R('Streckenprotokoll', { size: 48, bold: true, color: DARK })]));
  children.push(P({ spacing: { after: 300 }, border: { left: { style: BorderStyle.SINGLE, size: 24, color: RED, space: 10 } } }, [R(`außerhalb BAB   ·   vom ${fmtDate(protokoll.datum)}${teile.length > 1 ? `   ·   ${teile.length} Fahrtwegteile` : ''}`, { size: 20, color: GREY })]));
  // Info-Karte als 3-spaltige Tabelle ohne Rahmen
  const none = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
  const infoCell = (lbl, lines) => new TableCell({ borders: { top: none, bottom: none, left: none, right: none }, width: { size: 3220, type: WidthType.DXA }, shading: { type: ShadingType.CLEAR, fill: FILL, color: 'auto' }, margins: { top: 140, bottom: 140, left: 160, right: 120 }, children: [P({ spacing: { after: 60 } }, [R(lbl, { size: 13, bold: true, color: GREY })]), ...lines.filter(Boolean).map((l, i) => P({ spacing: { after: 20 } }, [R(l, { size: i === 0 ? 21 : 18, bold: i === 0, color: i === 0 ? DARK : SLATE })]))] });
  children.push(new Table({ width: { size: 9660, type: WidthType.DXA }, rows: [new TableRow({ children: [infoCell('AN DIE FIRMA', [e.firma || '–', e.strasse, e.plzOrt]), infoCell('STRECKENPRÜFUNG', [sig.name, sig.firma, sig.tel ? 'Tel. ' + sig.tel : '']), infoCell('DATUM · UMFANG', [fmtDate(protokoll.datum), protokoll.titel && protokoll.titel !== 'Protokoll' ? protokoll.titel : '', teile.length === 1 ? teile[0].t.name : `${teile.length} Fahrtwegteile`])] })] }));
  children.push(P({ spacing: { after: 200 } }, []));

  const hairB = { style: BorderStyle.SINGLE, size: 4, color: LINE };
  const borders = { top: hairB, bottom: hairB, left: none, right: none };
  const cell = (text, o = {}) => new TableCell({ borders, width: { size: o.w || 1200, type: WidthType.DXA }, shading: o.head ? { type: ShadingType.CLEAR, fill: FILL, color: 'auto' } : undefined, verticalAlign: 'center', margins: { top: 70, bottom: 70, left: 70, right: 70 }, children: [P({ alignment: o.left ? AlignmentType.LEFT : AlignmentType.RIGHT }, [R(text, { size: o.head ? 14 : 18, bold: !!o.head || !!o.bold, color: o.head ? GREY : DARK })])] });

  for (const { t, haupt, alt } of teile) {
    if (protokoll.teile.length > 1 || t.nr !== '1.1') children.push(P({ spacing: { before: 300, after: 160 }, pageBreakBefore: teile.findIndex(x => x.t === t) > 0 }, [R(t.name, { size: 28, bold: true, color: DARK })]));
    block('Start', t.start); block('Strecke', t.strecke); block('Ziel', t.ziel);
    if (t.alt?.aktiv && t.alt.strecke) block('Alternativroute', (t.alt.hinweis ? t.alt.hinweis + '\n' : '') + t.alt.strecke);
    block('Besonderheiten', t.besonderheiten, false);
    children.push(labelPara('Transportabmessungen Lastfahrt · Maße und Massen'));
    const heads = ['', 'Länge [m]', 'Breite [m]', 'Höhe [m]', 'Transporthöhe absenkbar auf [m]', 'Leermasse Zugfahrzeug [t]', 'Leermasse Anhänger [t]', 'Gesamt [t]'];
    const ws = [1150, 1000, 1000, 1000, 1500, 1450, 1400, 1130];
    const rowsData = [['Lastfahrt', t.masse]]; if (t.leerZeigen) rowsData.unshift(['Leerfahrt', t.leer]);
    const rows = [new TableRow({ children: heads.map((hh, i) => cell(hh, { head: true, w: ws[i] })) })];
    for (const [name, m] of rowsData) rows.push(new TableRow({ children: [name, m.laenge, m.breite, m.hoehe, m.absenkbar, m.leerZug, m.leerAnh, m.gesamt].map((v, i) => cell(i === 0 ? v : fmtNum(v), { w: ws[i], left: i === 0, bold: i === 0 })) }));
    children.push(new Table({ rows, width: { size: ws.reduce((a, b) => a + b), type: WidthType.DXA } }));
    children.push(P({ spacing: { after: 240 } }, []));

    const addPunkte = async (list, heading) => {
      let first = true;
      if (heading) { children.push(P({ spacing: { before: 300, after: 120 }, pageBreakBefore: true }, [R(heading, { size: 24, bold: true, color: RED })])); first = false; }
      let n = 0;
      for (const { p, cap } of list) {
        n++;
        const imgs = await preparePunktImages(p, 'bytes');
        opts.onProgress?.();
        if (first) { children.push(P({ pageBreakBefore: true, spacing: { after: 0 } }, [])); first = false; }
        if (imgs.length) {
          const twoUp = imgs.length >= 2 && (p.layout === 'nebeneinander' || (p.layout === 'auto' && imgs.every(i => i.h > i.w * 0.9)));
          const maxW = 640; // px ≈ 16,9 cm
          if (twoUp) {
            const w = (maxW - 12) / 2;
            const imgRuns = imgs.slice(0, 2).map(im => { let ww = w, hh = w * im.h / im.w; if (hh > 420) { hh = 420; ww = hh * im.w / im.h; } return new ImageRun({ type: 'jpg', data: im.bytes, transformation: { width: Math.round(ww), height: Math.round(hh) } }); });
            children.push(P({ alignment: AlignmentType.CENTER, spacing: { before: 200, after: 80 }, keepNext: true }, [imgRuns[0], R('  '), imgRuns[1]]));
          } else {
            for (const im of imgs) { let ww = maxW, hh = maxW * im.h / im.w; const cap2 = im.h > im.w ? 470 : 360; if (hh > cap2) { hh = cap2; ww = hh * im.w / im.h; } children.push(P({ alignment: AlignmentType.CENTER, spacing: { before: 200, after: 80 }, keepNext: true }, [new ImageRun({ type: 'jpg', data: im.bytes, transformation: { width: Math.round(ww), height: Math.round(hh) } })])); }
          }
        }
        const badgeCol = p.nachpruefen ? 'E0A100' : p.typ === 'start' ? '16A34A' : p.typ === 'ziel' ? RED : SLATE;
        children.push(P({ spacing: { after: cap.mess.length ? 40 : 160 } }, [new TextRun({ text: ` ${n} `, font: 'Arial', size: 18, bold: true, color: 'FFFFFF', shading: { type: ShadingType.CLEAR, fill: badgeCol, color: 'auto' } }), R('  ' + cap.text, { bold: true, size: 21, color: DARK })]));
        if (cap.mess.length) children.push(P({ spacing: { after: 160 } }, [R(cap.mess.join('   ·   '), { size: 17, color: GREY })]));
        children.push(P({ spacing: { after: 200 }, border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: LINE, space: 6 } } }, []));
      }
    };
    await addPunkte(haupt, null);
    if (alt.length) await addPunkte(alt, `${t.nr} – Alternativroute`);
  }
  // Abschluss auf eigener Seite
  children.push(P({ pageBreakBefore: true, spacing: { before: 200 } }, []));
  children.push(labelPara('Ergebnis der Streckenprüfung'));
  for (const para of (protokoll.schlusstext || '').split('\n')) children.push(P({ spacing: { after: 120 } }, [R(para, { size: 22, color: DARK })]));
  if (logo && (logoPos === 'schluss' || logoPos === 'beide')) { const lw = 190, lh = Math.round(lw * logo.h / logo.w); children.push(P({ spacing: { before: 500, after: 200 } }, [new ImageRun({ type: logo.type.includes('png') ? 'png' : 'jpg', data: logo.bytes, transformation: { width: lw, height: Math.min(lh, 90) } })])); }
  children.push(P({ spacing: { before: 300, after: 40 } }, [R(sig.name, { bold: true, color: DARK })]));
  [sig.firma, [sig.strasse, sig.ort].filter(Boolean).join(', '), sig.tel ? `Tel. ${sig.tel}` : ''].filter(Boolean).forEach(l => children.push(P({ spacing: { after: 20 } }, [R(l, { size: 19, color: SLATE })])));

  const doc = new Document({
    creator: sig.name, title: `Streckenprotokoll ${fmtDate(protokoll.datum)}`,
    styles: { default: { document: { run: { font: 'Arial', size: 21 } } } },
    sections: [{
      properties: { page: { margin: { top: cm(2.2), bottom: cm(2), left: cm(2), right: cm(2), header: cm(0.8), footer: cm(0.8) } } },
      headers: { default: new Header({ children: [
        P({ border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: LINE, space: 4 } }, tabStops: [{ type: 'right', position: cm(17) }] }, [R(sig.firma, { size: 21, bold: true, color: RED }), new TextRun({ children: [new Tab()], size: 15 }), R([sig.strasse, sig.ort, sig.name, sig.tel ? 'Tel. ' + sig.tel : ''].filter(Boolean).join('   ·   '), { size: 15, color: GREY })]),
      ] }) },
      footers: { default: new Footer({ children: [P({ tabStops: [{ type: 'right', position: cm(17) }], border: { top: { style: BorderStyle.SINGLE, size: 4, color: 'E1E1E1', space: 4 } } }, [R(`Streckenprotokoll · ${e.firma || ''} · ${fmtDate(protokoll.datum)}`, { size: 15, color: GREY }), new TextRun({ children: [new Tab()], size: 15 }), R('Seite ', { size: 15, color: GREY }), new TextRun({ children: [PageNumber.CURRENT], size: 15, color: GREY, font: 'Arial' }), R(' von ', { size: 15, color: GREY }), new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 15, color: GREY, font: 'Arial' })])] }) },
      children,
    }],
  });
  return Packer.toBlob(doc);
}

// =====================================================================
// ZIP mit Originalfotos
// =====================================================================
export async function buildZip(protokoll, fahrt, pdfBlob, docxBlob) {
  const zip = new JSZip();
  const base = dateiname(protokoll, fahrt, '').slice(0, -1);
  if (pdfBlob) zip.file(base + '.pdf', pdfBlob);
  if (docxBlob) zip.file(base + '.docx', docxBlob);
  const folder = zip.folder('Originalfotos');
  let n = 0;
  for (const t of protokoll.teile) {
    const pts = await model.punkte(protokoll.id, t.id);
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      for (let k = 0; k < (p.bilder || []).length; k++) {
        const b = await db.getBlob(p.bilder[k].blobId); if (!b) continue;
        const ext = b.type.includes('png') ? 'png' : b.type.includes('heic') ? 'heic' : 'jpg';
        folder.file(`${t.nr}_P${String(i + 1).padStart(2, '0')}${p.bilder.length > 1 ? '_' + (k + 1) : ''}${p.bilder[k].gewaehlt ? '' : '_nicht-verwendet'}.${ext}`, b); n++;
      }
    }
  }
  return { blob: await zip.generateAsync({ type: 'blob' }), name: base + '.zip', fotos: n };
}
