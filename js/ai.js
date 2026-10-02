// KI-Funktionen über die Anthropic-API. Schlüssel liegt nur auf dem Gerät. Alles sind Vorschläge.
import { getStamm, saveStamm } from './db.js';
import { blobToDataURL, resizeBlob } from './util.js';

const API = 'https://api.anthropic.com/v1';
export const DEFAULT_MODEL = 'claude-sonnet-5-5';
// Vorschlagsliste – wird bei „Verbindung testen“ durch die echte Liste des Kontos ergänzt
export const MODELLE = [
  { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5 – Standard (gut & bezahlbar)' },
  { id: 'claude-haiku-4-5', label: 'Haiku 4.5 – günstig, schnell' },
  { id: 'claude-opus-5-5', label: 'Opus 5.5 – stärkstes, teuer' },
  { id: 'claude-sonnet-4-5', label: 'Sonnet 4.5 – älter' },
];
// Grenzen der API: 32 MB je Anfrage (Base64 bläht um ⅓ auf), 100 PDF-Seiten
export const MAX_BYTES = 22 * 1024 * 1024;

export class KiFehler extends Error {
  constructor(msg, { status = 0, raw = '', code = '' } = {}) { super(msg); this.status = status; this.raw = raw; this.code = code; }
}

function headers(key, ws = '') {
  const hd = { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' };
  if (ws) hd['anthropic-workspace-id'] = ws;
  return hd;
}

// HTTP-Status + Antworttext → verständlicher deutscher Text
function deuten(status, raw, model) {
  const t = (raw || '').toLowerCase();
  if (t.includes('workspace')) return { code: 'workspace', msg: 'Der Schlüssel ist nicht an einen Workspace gebunden – Anthropic verlangt dann die Workspace-ID. Lösung A: In Stammdaten → KI die Workspace-ID eintragen (console.anthropic.com → Settings → Workspaces → Workspace anklicken → ID „wrkspc_…“ kopieren). Lösung B: Dort im Workspace einen neuen Schlüssel anlegen und den verwenden.' };
  if (status === 401 || t.includes('authentication_error') || t.includes('invalid x-api-key')) return { code: 'key', msg: 'Der API-Schlüssel wird nicht akzeptiert. In Stammdaten → KI den Schlüssel neu einfügen (komplett, ohne Leerzeichen) und „Verbindung testen“ tippen.' };
  if (status === 403 || t.includes('permission_error')) return { code: 'key', msg: 'Zugriff verweigert. Der Schlüssel hat keine Berechtigung für die API – im Anthropic-Konto (console.anthropic.com) prüfen.' };
  if (t.includes('credit balance') || t.includes('billing') || t.includes('purchase credits')) return { code: 'credit', msg: 'Kein Guthaben im Anthropic-API-Konto. Das Claude-Abo (Pro/Max) zählt hier NICHT – die API wird separat bezahlt. Aufladen: console.anthropic.com → Billing → „Buy credits“ (ab 5 $), dann erneut versuchen.' };
  if (status === 404 || t.includes('not_found_error')) return { code: 'model', msg: `Das Modell „${model}“ ist nicht (mehr) verfügbar. In Stammdaten → KI „Verbindung testen“ tippen – die App wählt dann ein verfügbares Modell.` };
  if (status === 413 || t.includes('too large') || t.includes('exceeds') || t.includes('request_too_large') || t.includes('too many pages') || t.includes('page limit')) return { code: 'size', msg: 'Die Unterlagen sind zusammen zu groß für eine Anfrage (Grenze ca. 30 MB und 100 PDF-Seiten). Weniger Dateien anhaken oder das dicke PDF einzeln lesen lassen.' };
  if (status === 429 || t.includes('rate_limit')) return { code: 'rate', msg: 'Zu viele Anfragen in kurzer Zeit oder Tageslimit erreicht. Eine Minute warten und erneut versuchen.' };
  if (status === 529 || status >= 500 || t.includes('overloaded')) return { code: 'server', msg: 'Anthropic ist gerade überlastet oder gestört. In ein bis zwei Minuten erneut versuchen.' };
  if (status === 400) return { code: 'request', msg: 'Die Anfrage wurde abgelehnt (400). Details unten – meist hilft: andere Datei, anderes Modell.' };
  return { code: 'unknown', msg: `Unerwarteter Fehler (${status || 'keine Antwort'}).` };
}

async function apiFetch(path, key, init = {}, ws = '') {
  let r;
  try { r = await fetch(API + path, { ...init, headers: headers(key, ws) }); }
  catch (e) { throw new KiFehler('Keine Verbindung zu api.anthropic.com. Internet prüfen (Mobilfunk/WLAN) und erneut versuchen. Bleibt es dabei: Firmen-WLAN kann den Zugriff sperren.', { code: 'network', raw: String(e?.message || e) }); }
  return r;
}

// Verfügbare Modelle des Kontos (prüft nebenbei den Schlüssel)
export async function listModels(key, ws = '') {
  const r = await apiFetch('/models?limit=100', key, {}, ws);
  const raw = await r.text();
  if (!r.ok) { const d = deuten(r.status, raw, ''); throw new KiFehler(d.msg, { status: r.status, raw: raw.slice(0, 500), code: d.code }); }
  let j; try { j = JSON.parse(raw); } catch (e) { throw new KiFehler('Modellliste nicht lesbar', { raw: raw.slice(0, 300) }); }
  return (j.data || []).map(m => ({ id: m.id, label: m.display_name || m.id })).filter(m => m.id.startsWith('claude'));
}

// Bestes Modell aus einer Liste wählen: neuestes Sonnet, sonst Haiku, sonst irgendeins
export function pickModel(list) {
  const ids = list.map(m => m.id);
  const num = (id) => { const m = id.match(/(\d+)-(\d+)/); return m ? parseInt(m[1]) * 100 + parseInt(m[2]) : 0; };
  const best = (fam) => ids.filter(i => i.includes(fam)).sort((a, b) => num(b) - num(a))[0];
  return best('sonnet') || best('haiku') || best('opus') || ids[0] || DEFAULT_MODEL;
}

// Stärkstes Modell des Kontos (für das Einlesen schlechter Scans)
function opusModel(stamm) {
  const opus = (stamm.aiModelle || []).filter(m => m.id.includes('opus'));
  return opus.length ? pickModel(opus) : 'claude-opus-5-5';
}

// schema: JSON-Schema → Antwort wird als Tool-Aufruf erzwungen (immer gültiges JSON, keine Prosa)
// Modelle, die kein erzwungenes Werkzeug erlauben (merkt sich die App pro Gerät)
const ohneZwang = new Set();
async function call(messages, { system, maxTokens = 1500, json = false, schema = null, zweck = '', _retry = true, _modus = '' } = {}) {
  const stamm = await getStamm();
  const key = (stamm.apiKey || '').trim();
  if (!key) throw new KiFehler('Kein API-Schlüssel hinterlegt (Stammdaten → KI).', { code: 'key' });
  if (key !== stamm.apiKey) { stamm.apiKey = key; await saveStamm(stamm); }
  let model = (stamm.aiModel || DEFAULT_MODEL).trim();
  if (zweck === 'lesen' && stamm.einstellungen?.lesenOpus) model = opusModel(stamm);
  const ws = (stamm.aiWorkspace || '').trim();
  // Formular-Modus: 'zwang' (tool_choice tool) → 'auto' (Werkzeug angeboten) → 'text' (JSON im Text)
  const modus = schema ? (_modus || ((ohneZwang.has(model) || (stamm.aiOhneZwang || []).includes(model)) ? 'auto' : 'zwang')) : '';
  const sys = schema && modus !== 'zwang'
    ? `${system ? system + '\n\n' : ''}${modus === 'auto' ? 'Gib dein Ergebnis ausschließlich über das Werkzeug "ergebnis" zurück.' : 'Antworte ausschließlich mit einem einzigen JSON-Objekt (ohne Erklärtext, ohne Markdown) nach diesem Schema:\n' + JSON.stringify(schema)}`
    : system;
  const body = { model, max_tokens: maxTokens, messages };
  if (sys) body.system = sys;
  if (schema && modus !== 'text') { body.tools = [{ name: 'ergebnis', description: 'Liefert das Ergebnis in genau dieser Struktur.', input_schema: schema }]; body.tool_choice = modus === 'zwang' ? { type: 'tool', name: 'ergebnis' } : { type: 'auto' }; }
  const r = await apiFetch('/messages', key, { method: 'POST', body: JSON.stringify(body) }, ws);
  const opts = { system, maxTokens, json, schema, zweck };
  if (!r.ok) {
    const raw = await r.text();
    // Modell erlaubt kein erzwungenes Werkzeug → merken und ohne Zwang wiederholen
    if (schema && r.status === 400 && /tool_choice|tool use|tools? (are|is) not supported/i.test(raw)) {
      if (modus === 'zwang') { ohneZwang.add(model); const st = await getStamm(); st.aiOhneZwang = [...new Set([...(st.aiOhneZwang || []), model])]; await saveStamm(st); return call(messages, { ...opts, _retry, _modus: 'auto' }); }
      if (modus === 'auto') return call(messages, { ...opts, _retry, _modus: 'text' });
    }
    const d = deuten(r.status, raw, model);
    // Modell weg? Einmal automatisch auf ein verfügbares Modell wechseln und wiederholen
    if (d.code === 'model' && _retry) {
      try {
        const list = await listModels(key, ws);
        const neu = pickModel(list);
        if (neu && neu !== model) { stamm.aiModel = neu; await saveStamm(stamm); return call(messages, { ...opts, _retry: false }); }
      } catch (e) { /* unten melden */ }
    }
    let api = ''; try { api = JSON.parse(raw)?.error?.message || ''; } catch (e) { /* roh */ }
    throw new KiFehler(d.code === 'request' && api ? `Die KI hat die Anfrage abgelehnt: ${api}` : d.msg, { status: r.status, raw: raw.slice(0, 600), code: d.code });
  }
  const j = await r.json();
  if (schema) {
    const tu = (j.content || []).find(c => c.type === 'tool_use');
    if (tu?.input) return tu.input;
    if (j.stop_reason === 'max_tokens') throw new KiFehler('Die Antwort wurde abgeschnitten – weniger Dateien bzw. Texte auf einmal.', { code: 'size', raw: JSON.stringify(j).slice(0, 300) });
  }
  const text = (j.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n').trim();
  if (!json && !schema) return text;
  const m = text.replace(/```(?:json)?/g, '').match(/\{[\s\S]*\}|\[[\s\S]*\]/);
  try { return JSON.parse(m ? m[0] : text); }
  catch (e) {
    if (schema && modus === 'auto') return call(messages, { ...opts, _retry, _modus: 'text' });
    throw new KiFehler('Die KI-Antwort war kein lesbares Ergebnis. Bitte erneut versuchen.', { raw: text.slice(0, 400), code: 'parse' });
  }
}

// Verbindung testen: Schlüssel, Modelle, Guthaben. Liefert {modelle, model, antwort}
export async function testen() {
  const stamm = await getStamm();
  const key = (stamm.apiKey || '').trim();
  if (!key) throw new KiFehler('Kein API-Schlüssel eingetragen.', { code: 'key' });
  if (key !== stamm.apiKey) { stamm.apiKey = key; await saveStamm(stamm); }
  const ws = (stamm.aiWorkspace || '').trim();
  if (ws !== (stamm.aiWorkspace || '')) { stamm.aiWorkspace = ws; await saveStamm(stamm); }
  let modelle = [];
  try { modelle = await listModels(key, ws); } catch (e) { if (['key', 'network', 'workspace'].includes(e.code)) throw e; /* Liste optional */ }
  let model = (stamm.aiModel || DEFAULT_MODEL).trim();
  if (modelle.length && !modelle.some(m => m.id === model)) { model = pickModel(modelle); stamm.aiModel = model; await saveStamm(stamm); }
  const antwort = await call([{ role: 'user', content: 'Antworte nur mit dem Wort OK.' }], { maxTokens: 5 });
  return { modelle, model: (await getStamm()).aiModel || model, antwort };
}

const STIL = `Du unterstützt einen Streckenprüfer für Schwertransporte (Begleitfahrzeuge, BF3/BF4) beim Schreiben von Streckenprotokollen für die Genehmigungsbehörde. Sprache: Deutsch, knapp, sachlich, im Stil dieser Beispiele:
- "Straße: B70, tiefste gemessene Brückenhöhe: 4,35 m"
- "Straße: K58 auf L143, zum Abbiegen beide Spuren verwenden."
- "Straße: B209, Schilder im Kreisverkehr müssen entfernt werden (Ein- und Ausfahrt). Kreisverkehr durch den Gegenverkehr befahren."
- "Straße: B215 Kreisverkehr stellt kein Problem dar. Aufgrund vorhandener Reifenspuren wird das Auslegen von Schwerlastplatten empfohlen."
Typische Maßnahmen: Schilderdienst (Demontage von Verkehrszeichen), Schwerlastplatten (unbefestigter Untergrund), Überfahrkeile/Kantenschutz (Bordsteine), Halteverbotszone, Gegenverkehr stoppen/umleiten, Gegenfahrbahn mitbenutzen, Verwaltungshelfer, Polizeibegleitung. Erfinde keine Messwerte. Du gibst nur Vorschläge; der Prüfer entscheidet.`;

// Größe der Unterlagen vorab prüfen (PDF geht roh raus, Fotos werden verkleinert)
export function pruefeGroesse(files) {
  let bytes = 0;
  for (const { blob } of files) bytes += (blob.type || '').includes('pdf') ? blob.size : 400 * 1024;
  if (bytes > MAX_BYTES) throw new KiFehler(`Die angehakten Unterlagen sind zusammen ${(bytes / 1024 / 1024).toFixed(1)} MB – zu viel für eine Anfrage (max. ca. ${(MAX_BYTES / 1024 / 1024).toFixed(0)} MB). Weniger Dateien anhaken oder nacheinander lesen lassen.`, { code: 'size' });
  return bytes;
}

// Unterlagen lesen: Antrag, Ablehnung, Auflagen, frühere Streckenprotokolle – beliebig viele Dateien (PDF oder Foto) zusammen
const LESEN_SCHEMA = {
  type: 'object',
  properties: {
    dokumente: { type: 'array', description: 'Zuerst: jede Datei einordnen.', items: { type: 'object', properties: { datei: { type: 'string' }, art: { type: 'string', enum: ['antrag', 'bescheid', 'protokoll', 'sonstiges'], description: 'antrag = Antrag/Auftrag der Spedition; bescheid = Ablehnung/Auflagen/Anhörung der Behörde; protokoll = früheres Streckenprotokoll' }, kurz: { type: 'string', description: 'Ein Satz: was steht drin' } }, required: ['datei', 'art'] } },
    empfaenger: { type: 'object', description: 'Antragsteller/Spedition, an die das Protokoll geht. NIE die Behörde, NIE AR Logistik.', properties: { firma: { type: 'string' }, strasse: { type: 'string' }, plzOrt: { type: 'string' } }, required: ['firma', 'strasse', 'plzOrt'] },
    start: { type: 'string', description: 'Startort/Ladestelle der Lastfahrt, wie im Antrag (Ort, Straße)' },
    ziel: { type: 'string', description: 'Zielort/Entladestelle' },
    strecke: { type: 'string', description: 'Vollständige Straßenfolge, mit " - " getrennt, nichts kürzen oder zusammenfassen. Bei einem früheren Protokoll dessen Strecke.' },
    besonderheiten: { type: 'string', description: 'Besonderheiten/Auflagen aus Antrag oder Protokoll, wörtlich' },
    masse: { type: 'object', description: 'Maße der LASTFAHRT (beladen), Meter/Tonnen, Komma als Dezimaltrenner, z. B. "4,35". Leerfahrt-Werte nur in leerZug/leerAnh.', properties: { laenge: { type: 'string' }, breite: { type: 'string' }, hoehe: { type: 'string' }, absenkbar: { type: 'string', description: 'z. B. "3,90" wenn absenkbar auf Höhe, sonst leer' }, leerZug: { type: 'string' }, leerAnh: { type: 'string' }, gesamt: { type: 'string', description: 'Gesamtgewicht in t' } }, required: ['laenge', 'breite', 'hoehe', 'gesamt'] },
    hinweise: { type: 'string', description: 'Was die Behörde verlangt oder beanstandet (Abschnitt, Rückweg, Bundesland, Auflagen) – kurz, nur wenn erkennbar' },
    unsicher: { type: 'array', items: { type: 'string' }, description: 'Felder, die du nicht sicher lesen konntest (z. B. "hoehe: 4,35 oder 4,85 unleserlich")' },
  },
  required: ['dokumente', 'empfaenger', 'start', 'ziel', 'strecke', 'besonderheiten', 'masse', 'hinweise', 'unsicher'],
};
export async function antragLesen(files) {
  const list = (Array.isArray(files) ? files : [files]).map(x => x.blob ? x : { blob: x, name: '' });
  pruefeGroesse(list);
  const blocks = [];
  for (const { blob, name } of list) {
    const isPdf = (blob.type || '').includes('pdf') || /\.pdf$/i.test(name || '');
    const src = isPdf ? blob : await resizeBlob(blob, 1800, 0.85);
    const data = (await blobToDataURL(src)).split(',')[1];
    if (name) blocks.push({ type: 'text', text: `Datei: ${name}` });
    blocks.push(isPdf ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } } : { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data } });
  }
  blocks.push({ type: 'text', text: `Das sind Unterlagen zu einem Großraum- und Schwertransport. Ordne zuerst jede Datei ein (Antrag der Spedition / Bescheid der Behörde / früheres Streckenprotokoll). Lies dann die Daten für ein neues Streckenprotokoll heraus.
Regeln: Nur übernehmen, was wirklich in den Unterlagen steht – nichts raten, nichts ergänzen; unsichere Stellen leer lassen und unter "unsicher" nennen. Zahlen exakt so lesen, wie sie dastehen (Komma als Dezimaltrenner). Die Strecke vollständig und in der Reihenfolge der Fahrt. Steht in einem Bescheid eine geänderte oder beanstandete Strecke, gehört das in "hinweise", nicht in "strecke". Bei mehreren Dokumenten hat der Antrag Vorrang für Empfänger und Maße, das frühere Protokoll für Start/Strecke/Ziel/Besonderheiten.` });
  return call([{ role: 'user', content: blocks }], { schema: LESEN_SCHEMA, maxTokens: 2500, zweck: 'lesen' });
}

// Foto einschätzen
export async function fotoEinschaetzen(blob, ctx) {
  const small = await resizeBlob(blob, 1200, 0.8);
  const data = (await blobToDataURL(small)).split(',')[1];
  const m = ctx.masse || {};
  return call([{ role: 'user', content: [
    { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data } },
    { type: 'text', text: `Streckenpunkt: ${ctx.strasse || 'unbekannt'}. Transport Lastfahrt: Länge ${m.laenge || '?'} m, Breite ${m.breite || '?'} m, Höhe ${m.hoehe || '?'} m, ${m.gesamt || '?'} t.${ctx.text ? ' Bisheriger Text: "' + ctx.text + '"' : ''}
Was ist auf dem Foto für diesen Transport relevant (Engstellen, Kurvenradius, Schilder/Masten im Schwenkbereich, Bordsteine, Inseln, Brücken, unbefestigte Flächen, Parkverkehr)? Höchstens 4 Hinweise. Wenn nichts auffällt: keine Hinweise, Textvorschlag z. B. "Durchfahrt stellt kein Problem dar."` },
  ] }], { system: STIL, schema: { type: 'object', properties: { hinweise: { type: 'array', items: { type: 'string' }, description: 'Höchstens 4 kurze Hinweise; leer wenn nichts auffällt' }, textvorschlag: { type: 'string', description: 'Fertiger Bildunterschrift-Text ohne Präfix "Straße:"' } }, required: ['hinweise', 'textvorschlag'] }, maxTokens: 700 });
}

// Stichworte ausformulieren
export async function formulieren(stichworte, ctx = {}) {
  return call([{ role: 'user', content: `Formuliere aus diesen Stichworten einen Bildunterschrift-Text (1–2 Sätze, ohne Präfix "Straße:"): "${stichworte}"${ctx.strasse ? ` — Ort: ${ctx.strasse}` : ''}. Antworte nur mit dem Text.` }], { system: STIL, maxTokens: 300 });
}

// Textprüfung über das ganze Protokoll – in Blöcken, damit nichts abgeschnitten wird. onChunk(neueKorrekturen, fertig, gesamt)
export async function textPruefen(items, onChunk) {
  // items: [{id, text}]
  const schema = { type: 'object', properties: { korrekturen: { type: 'array', items: { type: 'object', properties: { id: { type: 'string', description: 'id exakt wie angegeben' }, neu: { type: 'string', description: 'vollständiger korrigierter Text' }, grund: { type: 'string', description: 'kurz' } }, required: ['id', 'neu', 'grund'] } } }, required: ['korrekturen'] };
  const BLOCK = 25, out = [];
  const blocks = []; for (let i = 0; i < items.length; i += BLOCK) blocks.push(items.slice(i, i + BLOCK));
  for (let bi = 0; bi < blocks.length; bi++) {
    const list = blocks[bi].map(i => `[${i.id}] ${i.text}`).join('\n');
    const r = await call([{ role: 'user', content: `Prüfe folgende Texte eines Streckenprotokolls auf Rechtschreibung, Grammatik, Zeichensetzung und einheitliche Schreibweise (z. B. "zum Abbiegen", "Gegenverkehr", Maße wie "4,35 m", Straßen wie "B 73"→"B73" einheitlich, "Sperrfläche" statt "Speerfläche"). Ändere den Inhalt nicht, füge nichts hinzu, kürze nicht, formuliere nicht um. Nur echte Korrekturen melden; Texte ohne Änderungsbedarf weglassen. Die id in eckigen Klammern exakt übernehmen.\n\n${list}` }], { system: STIL, schema, maxTokens: 6000 });
    const ids = new Set(blocks[bi].map(i => i.id));
    const k = (r.korrekturen || []).filter(x => ids.has(x.id) && x.neu);
    out.push(...k);
    onChunk?.(k, bi + 1, blocks.length);
  }
  return out;
}
