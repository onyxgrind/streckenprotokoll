// IndexedDB-Schicht: alles bleibt auf dem Gerät.
const DB_NAME = 'streckenprotokoll';
const DB_VER = 1;
let dbp = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, DB_VER);
    r.onupgradeneeded = (e) => {
      const db = e.target.result;
      const mk = (name, idx = []) => {
        if (db.objectStoreNames.contains(name)) return;
        const s = db.createObjectStore(name, { keyPath: 'id' });
        idx.forEach(i => s.createIndex(i, i));
      };
      mk('fahrten');
      mk('protokolle', ['fahrtId']);
      mk('punkte', ['fahrtId', 'protokollId']);
      mk('blobs');
      mk('kv');
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}

function tx(store, mode, fn) {
  return open().then(db => new Promise((res, rej) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let out;
    try { out = fn(s); } catch (e) { rej(e); return; }
    t.oncomplete = () => res(out && out.result !== undefined ? out.result : out);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
  }));
}

function reqToPromise(store, mode, fn) {
  return open().then(db => new Promise((res, rej) => {
    const t = db.transaction(store, mode);
    const r = fn(t.objectStore(store));
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }));
}

export const uid = () => (Date.now().toString(36) + Math.random().toString(36).slice(2, 8)).toUpperCase();

export const db = {
  get: (store, id) => reqToPromise(store, 'readonly', s => s.get(id)),
  all: (store) => reqToPromise(store, 'readonly', s => s.getAll()),
  byIndex: (store, idx, val) => reqToPromise(store, 'readonly', s => s.index(idx).getAll(val)),
  put: (store, obj) => tx(store, 'readwrite', s => { s.put(obj); return obj; }),
  del: (store, id) => tx(store, 'readwrite', s => s.delete(id)),
  clear: (store) => tx(store, 'readwrite', s => s.clear()),
  async kvGet(key, def) { const r = await this.get('kv', key); return r ? r.value : def; },
  kvSet(key, value) { return this.put('kv', { id: key, value }); },
  // Blobs werden als ArrayBuffer gespeichert (robuster in iOS/WebKit als Blob-Objekte in IndexedDB)
  async putBlob(blob, meta = {}) {
    const id = uid();
    if (!blob) throw new Error('Kein Bild erhalten');
    const buf = await blob.arrayBuffer();
    await this.put('blobs', { id, buf, type: blob.type || 'application/octet-stream', size: buf.byteLength, ...meta, createdAt: Date.now() });
    return id;
  },
  async getBlob(id) {
    const r = await this.get('blobs', id); if (!r) return null;
    if (r.buf) return new Blob([r.buf], { type: r.type });
    return r.blob || null; // ältere Einträge
  },
};

// Objekt-URL-Cache für Bilder
const urlCache = new Map();
export async function blobUrl(id) {
  if (!id) return '';
  if (urlCache.has(id)) return urlCache.get(id);
  const b = await db.getBlob(id);
  if (!b) return '';
  const u = URL.createObjectURL(b);
  urlCache.set(id, u);
  return u;
}
export function forgetUrl(id) {
  const u = urlCache.get(id);
  if (u) { URL.revokeObjectURL(u); urlCache.delete(id); }
}

// Standard-Stammdaten
export const DEFAULTS = {
  signatur: {
    name: 'Marko Reiswich', tel: '04474/6778770', firma: 'AR Logistik GmbH', strasse: 'Dieselstr. 35', ort: 'D-49681 Garrel',
  },
  schlusstext: 'Durch die Behörde sind folgende Auflagen zu prüfen und anzuordnen: gesamter Fahrweg nach hinten privates Begleitfahrzeug (BF3) VZ 276 (absolutes Überholverbot) und Polizeibegleitung (Hilfspolizei).\n\nDiese Streckenprüfung ersetzt nicht die behördlich vorgeschriebene Streckenprüfung unmittelbar vor dem Transport.',
  bausteine: {
    punkt: [
      'zum Abbiegen beide Spuren verwenden',
      'zum Abbiegen Gegenfahrbahn mitverwenden',
      'abbiegen durch den Gegenverkehr',
      'Kreisverkehr durch den Gegenverkehr befahren',
      'Fahrbahnteiler stellt kein Problem dar',
      'Brückenhöhe ausreichend (höher als 4,20 m)',
      'tiefste gemessene Brückenhöhe: __ m',
      'Durchfahrtsbreite ausreichend',
      'markierte Schilder müssen entfernt werden',
      'Schild in der Kreisverkehr-Einfahrt entfernen',
      'Straßenbarken müssen geräumt werden',
      'Schwerlastplatten auslegen',
      'Überfahrkeile an den Bordsteinen auslegen',
      'Auffahrkeile im Überfahrtsbereich auslegen',
      'Kantenschutz am Bordstein',
      'entgegenkommender Verkehr muss gestoppt/umgeleitet werden',
      'Halteverbotszone einrichten',
      'Baustelle: Durchfahrtsbreite aktuell ausreichend, unmittelbar vor Transport erneut prüfen',
      'Passage erfordert Nachlenken und Sichtkontrolle',
      'abbiegen stellt kein Problem dar',
      'ACHTUNG: Ortsschild ist fest verbaut',
    ],
    besonderheiten: [
      'Die Strecke weist keine transportrelevanten Einschränkungen auf.',
      'Der entgegenkommende Verkehr muss mit geeigneten Mitteln gestoppt/umgeleitet werden.',
      'Tiefste gemessene Brückenhöhe: __ m',
      'Schilderdienst wird benötigt.',
      'Aufgrund der Transportlänge wird für die gesamte Strecke der Einsatz eines Schilderdienstwagens empfohlen.',
      'Es wird empfohlen, Schwerlastplatten auszulegen.',
      'Im Einfahrtsbereich sowie in der Zielstraße sind Halteverbotszonen einzurichten.',
      'Die Kurvenradien sind teilweise sehr eng.',
    ],
    schluss: [
      'Zusätzlich ist der Einsatz von Verwaltungshelfern erforderlich.',
      'Ein Schilderdienst für die Demontage/Montage von Verkehrszeichen ist erforderlich.',
      'Begleitung durch BF4 erforderlich.',
      'Das Auslegen von Schwerlastplatten ist erforderlich.',
      'Das Auslegen von Überfahrkeilen (Kantenschutz) ist erforderlich.',
    ],
  },
};

export async function getStamm() {
  const s = await db.kvGet('stamm', null);
  if (s) {
    // fehlende Standardfelder ergänzen
    s.signatur = { ...DEFAULTS.signatur, ...(s.signatur || {}) };
    s.bausteine = { punkt: [], besonderheiten: [], schluss: [], ...(s.bausteine || {}) };
    s.kunden = s.kunden || [];
    s.einstellungen = { koordinatenImPdf: false, leerfahrtZeigen: false, logoBlobId: '', logoPos: 'beide', fotoKlein: false, lesenOpus: false, modus: 'voll', pin: '', maIntroDone: false, ...(s.einstellungen || {}) };
    if (!s.schlusstext) s.schlusstext = DEFAULTS.schlusstext;
    return s;
  }
  const init = { signatur: { ...DEFAULTS.signatur }, schlusstext: DEFAULTS.schlusstext, bausteine: JSON.parse(JSON.stringify(DEFAULTS.bausteine)), kunden: [], apiKey: '', einstellungen: { koordinatenImPdf: false, leerfahrtZeigen: false, logoBlobId: '' } };
  await db.kvSet('stamm', init);
  return init;
}
export const saveStamm = (s) => db.kvSet('stamm', s);
