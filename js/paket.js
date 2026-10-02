// Fahrt-Paket: eine Fahrt mit Protokollen, Punkten, Fotos (verkleinert) und Unterlagen als ZIP – zum Verschicken per WhatsApp/AirDrop/Mail.
import { db, uid, getStamm } from './db.js';
import { model } from './model.js';
import { resizeBlob, safeName, fmtDate } from './util.js';

export const PAKET_ENDUNG = '.strecke.zip';

// Paket bauen. fotoMax: längste Bildseite in px (2500 reicht fürs Protokoll, spart Datenvolumen).
export async function buildFahrtPaket(fahrtId, { fotoMax = 2500, onProgress } = {}) {
  const f = await db.get('fahrten', fahrtId);
  if (!f) throw new Error('Fahrt nicht gefunden');
  const prs = await model.protokolle(fahrtId);
  const punkte = [];
  for (const p of prs) punkte.push(...(await db.byIndex('punkte', 'protokollId', p.id)));
  const zip = new JSZip(), folder = zip.folder('blobs'), blobs = [], seen = new Set();
  let fotos = 0;
  // liefert den Verkleinerungsfaktor (1 = unverändert), damit Zeichnungen mitskaliert werden
  const add = async (id, resize) => {
    if (!id || seen.has(id)) return 1; seen.add(id);
    const rec = await db.get('blobs', id); if (!rec) return 1;
    let blob = rec.buf ? new Blob([rec.buf], { type: rec.type }) : rec.blob; if (!blob) return 1;
    let faktor = 1;
    if (resize && !rec.thumb && /^image\//.test(rec.type || '')) {
      try {
        const bm = await createImageBitmap(blob); const m = Math.max(bm.width, bm.height); bm.close?.();
        if (m > fotoMax) { blob = await resizeBlob(blob, fotoMax, 0.88); faktor = fotoMax / m; }
      } catch (e) { /* Original nehmen */ }
    }
    folder.file(id, blob);
    blobs.push({ id, type: blob.type || rec.type, name: rec.name, punktId: rec.punktId, thumb: !!rec.thumb });
    return faktor;
  };
  for (const u of f.unterlagen || []) await add(u.blobId, false);
  for (const q of punkte) {
    for (const b of q.bilder || []) {
      const k = await add(b.blobId, true); fotos++;
      if (k !== 1 && q.zeichnung?.[b.id]?.length) q.zeichnung[b.id] = q.zeichnung[b.id].map(sh => ({ ...sh, points: sh.points.map(pt => ({ x: pt.x * k, y: pt.y * k })) }));
      if (b.thumbId) await add(b.thumbId, false);
    }
    onProgress?.();
  }
  const stamm = await getStamm();
  zip.file('paket.json', JSON.stringify({ version: 1, typ: 'fahrt', exportiert: new Date().toISOString(), von: stamm.signatur?.name || '', app: '1.1', fahrt: f, protokolle: prs, punkte, blobs }));
  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 1 } });
  const kunde = safeName((f.kunde?.firma || f.titel || 'Fahrt').split(/\s+/).slice(0, 2).join('_'));
  const name = `Fahrt_${fmtDate(f.datum).replace(/\./g, '-')}_${kunde}${PAKET_ENDUNG}`;
  return { blob, name, fotos, punkte: punkte.length, size: blob.size };
}

// Paket lesen (noch nichts speichern). Liefert Metadaten + Hinweis, ob die Fahrt schon existiert.
export async function readFahrtPaket(file) {
  const zip = file instanceof JSZip ? file : await JSZip.loadAsync(file);
  const pj = zip.file('paket.json');
  if (!pj) throw new Error('Das ist kein Fahrt-Paket (paket.json fehlt). Eine Komplettsicherung gehört unter Stammdaten → Einspielen.');
  const meta = JSON.parse(await pj.async('string'));
  if (meta.typ !== 'fahrt' || !meta.fahrt?.id) throw new Error('Paket unvollständig oder beschädigt');
  const vorhanden = await db.get('fahrten', meta.fahrt.id);
  return { zip, meta, vorhanden, punkte: (meta.punkte || []).length, fotos: (meta.blobs || []).filter(b => !b.thumb && b.punktId).length };
}

// Paket einspielen. modus: 'ersetzen' (gleiche IDs, vorhandene Fahrt wird ersetzt) | 'kopie' (neue IDs, alles bleibt daneben) | 'neu' (Fahrt gibt es noch nicht)
export async function importFahrtPaket({ zip, meta }, modus) {
  const map = new Map(); // alte ID → neue ID (nur bei Kopie)
  const nid = (old) => { if (modus !== 'kopie') return old; if (!map.has(old)) map.set(old, uid()); return map.get(old); };
  if (modus === 'ersetzen') await model.deleteFahrt(meta.fahrt.id);
  const f = JSON.parse(JSON.stringify(meta.fahrt));
  f.id = nid(f.id);
  f.unterlagen = (f.unterlagen || []).map(u => ({ ...u, id: nid(u.id), blobId: nid(u.blobId) }));
  f.checkliste = (f.checkliste || []).map(it => ({ ...it, id: nid(it.id), protokollId: it.protokollId ? nid(it.protokollId) : '' }));
  if (f.antragBlobId) f.antragBlobId = nid(f.antragBlobId);
  if (modus === 'kopie') f.titel = (f.titel || 'Fahrt') + ' (Kopie)';
  f.empfangen = { von: meta.von || '', am: new Date().toISOString(), exportiert: meta.exportiert };
  for (const p0 of meta.protokolle || []) {
    const p = JSON.parse(JSON.stringify(p0)); p.id = nid(p.id); p.fahrtId = f.id; await db.put('protokolle', p);
  }
  for (const q0 of meta.punkte || []) {
    const q = JSON.parse(JSON.stringify(q0)); q.id = nid(q.id); q.fahrtId = f.id; q.protokollId = nid(q.protokollId);
    q.bilder = (q.bilder || []).map(b => ({ ...b, blobId: nid(b.blobId), thumbId: b.thumbId ? nid(b.thumbId) : '' }));
    await db.put('punkte', q);
  }
  let n = 0;
  for (const b of meta.blobs || []) {
    const file = zip.file('blobs/' + b.id); if (!file) continue;
    const buf = await file.async('arraybuffer');
    await db.put('blobs', { id: nid(b.id), buf, type: b.type || 'application/octet-stream', size: buf.byteLength, name: b.name, punktId: b.punktId ? nid(b.punktId) : undefined, thumb: !!b.thumb, createdAt: Date.now() }); n++;
  }
  await db.put('fahrten', f);
  return { fahrtId: f.id, punkte: (meta.punkte || []).length, dateien: n };
}
