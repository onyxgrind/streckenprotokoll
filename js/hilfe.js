// Hilfetexte je Bildschirm + Installieren-Hilfe. Kurz, in der Sprache der Bedienung.
export const HILFE = {
  fahrten: { titel: 'Fahrten', text: `Jede Zeile ist ein Auftrag (eine Fahrt). Antippen öffnet sie.
＋ Neu legt eine Fahrt an. Suche oben filtert nach Kunde, Ziel oder Datum.
„Einspielen“ (Menü ⋯) nimmt eine Sicherung oder ein Fahrt-Paket – die App erkennt die Datei selbst.` },
  fahrt: { titel: 'Fahrt', text: `Oben: Auftraggeber und Datum. Titel antippen zum Umbenennen.
Unterlagen: Antrag, Bescheid, altes Protokoll anhängen (＋ Datei). Angehakte Dateien liest die KI aus und füllt Empfänger, Strecke und Maße – du prüfst das Formular, dann Übernehmen.
Checkliste: Was dokumentiert werden muss (Hinweg, Rückweg, weiteres Bundesland). „Anlegen“ erzeugt dafür ein Fahrtwegteil oder ein eigenes Protokoll.
Protokolle: je Behörde/Bundesland ein PDF.
▶ Fahrmodus starten: fotografieren und Standorte aufnehmen.
Menü „Mehr“: Umbenennen, versendet markieren, Fahrt senden (Paket für Kollegen), löschen.` },
  protokoll: { titel: 'Protokoll', text: `Ein Protokoll = ein PDF für eine Behörde. Es besteht aus Fahrtwegteilen (1.1 Lastfahrt, 1.2 Rückweg …).
Je Teil: Start, Strecke, Ziel, Besonderheiten, Maße der Lastfahrt. „B Auswahl fett“ hebt Teile der Strecke hervor (z. B. bei Alternativroute).
„Mehr“ am Teil: Nummer/Bezeichnung ändern, als Rückweg vorbelegen (Start/Ziel und Straßenfolge umgekehrt), löschen.
Alternativroute: eigener Block unter der Hauptstrecke, Punkte dafür im Fahrmodus über den Teil-Namen oben umschalten.
Schlusstext mit Bausteinen (Verwaltungshelfer, Schilderdienst …).
Prüfen & Erzeugen: Vollständigkeit, KI-Textprüfung, PDF/Word/ZIP.` },
  punkte: { titel: 'Punkte', text: `Alle Aufnahmen des Fahrtwegteils in Reihenfolge. Reiter: Hauptstrecke, Alternativroute, ⚑ Nachprüfen.
Status: „Text fehlt“ = noch kein Text, „📍?“ = Straßenvorschlag noch nicht bestätigt, ✓ = fertig.
▲▼ verschiebt, ⋮ öffnet Start/Ziel/Nachprüfen/Verschieben/Löschen.
„Mehr“: nach Zeit sortieren, Start und Ziel automatisch setzen, Flaggen löschen.
Fotothek: Bilder aus der Kamera-App oder Google-Maps-Screenshots als Punkte hinzufügen.` },
  punkt: { titel: 'Punkt bearbeiten', text: `Bilder: „Im Protokoll“ wählt das Foto fürs PDF (mehrere möglich, Hochkant nebeneinander). ↻ dreht, ✏️ Einzeichnen öffnet den Zeichen-Editor, ✂️ Zuschneiden entfernt Ränder (z. B. Fahrzeuge, Personen) – das Original bleibt erhalten.
Vorspann: Start: / Straße: / Ziel: / ohne – so beginnt die Bildunterschrift. ⚑ markiert zum Nachprüfen.
Straße: der gelbe GPS-Vorschlag kommt erst ins Protokoll, wenn du „Übernehmen“ tippst oder selbst etwas einträgst.
Text: Bausteine unten antippen, ✨ Ausformulieren aus Stichworten, KI-Einschätzung des Fotos.
Standort: Karte antippen zum Korrigieren, Koordinaten kopieren, in Google/Apple Maps öffnen.
Interne Notiz erscheint nicht im Protokoll.` },
  karte: { titel: 'Karte', text: `Punkte ziehen, um den Standort zu korrigieren. Antippen zeigt Foto und „Bearbeiten“.
Modus „Standort setzen“: Punkt ohne Standort wählen, dann auf die Karte tippen.
Farben: grün Start, rot Ziel, gelb Nachprüfen, blau Alternativroute. Gestrichelt = ungenauer Standort.
Die Karte ist nur für dich – im PDF erscheint sie nicht.` },
  erzeugen: { titel: 'Prüfen & Erzeugen', text: `Vollständigkeit: rote Punkte antippen und beheben. Erzeugen geht trotzdem.
KI-Textprüfung: Rechtschreibung und einheitliche Schreibweise, läuft in Blöcken; jeden Vorschlag einzeln übernehmen.
PDF: Deckblatt, dann Punkte, Abschluss auf eigener Seite. Word zum Nachbearbeiten. ZIP enthält zusätzlich alle Originalfotos.
Teilen öffnet das Teilen-Menü (Mail, WhatsApp, Dateien), Speichern lädt herunter.` },
  stamm: { titel: 'Stammdaten', text: `Signatur und Logo erscheinen im PDF. Standard-Schlusstext für neue Protokolle.
Kunden: Vorlagen für Empfänger. Textbausteine: Chips in den Textfeldern.
KI: eigener Anthropic-Schlüssel (Guthaben nötig, das Claude-Abo zählt nicht). „Verbindung testen“ prüft alles.
Speicher: Belegung, dauerhaft sichern, Fotos verkleinert speichern.
Daten: Sicherung exportieren; „Einspielen“ nimmt Sicherung UND Fahrt-Paket und erkennt die Datei selbst.
Mitarbeiter-Modus: reduzierte Oberfläche ohne KI, Stammdaten und Erzeugen – PIN-geschützt.` },
  fahrmodus: { titel: 'Fahrmodus', text: `Tippen = Foto mit Standort. Halten = Serie (bis 12 Bilder). ⚑ = Nachprüf-Punkt.
Oben links steht das Fahrtwegteil – antippen zum Wechseln (z. B. Rückweg oder Alternativroute).
Letztes Bild unten rechts antippen: Stichwort diktieren, als Ziel markieren, Fehlauslösung löschen.
Zoom: 1× / 2× / 3× oder zwei Finger. 0,5× nur, wenn das Gerät die Weitwinkelkamera freigibt.
Der Standort wird nachgetragen, sobald GPS genau ist – der Auslöser wartet nie.` },
  editor: { titel: 'Einzeichnen', text: `Werkzeuge: Linie, Pfeil, Fahrweg (mehrere Punkte antippen, ✓ = fertig, ergibt eine glatte Kurve), Rechteck, Kreis, ✕, Text.
Form antippen = auswählen: Punkte ziehen, ⊕ auf der Linie zieht einen neuen Punkt heraus, ⌒ rund/eckig, ➤ Pfeilspitze, ┄ gestrichelt, 🗑 löschen, ↶ rückgängig.
Farben und Strichstärke (Dünn/Mittel/Dick/Extra) gelten für die gewählte Form oder die nächste.
Zwei Finger: zoomen und verschieben, ⤢ zurück. Beim Ziehen erscheint eine Lupe.` },
  mitarbeiter: { titel: 'Kurzanleitung für Mitarbeiter', text: `1. Paket öffnen: Datei aus WhatsApp/Mail in „Dateien“ sichern → App → Menü ⋯ → „Einspielen“ → Datei wählen.
2. Fahrt antippen → „Fahrmodus starten“. Oben prüfen, ob das richtige Fahrtwegteil steht (z. B. 1.1 Lastfahrt).
3. Unterwegs: bei jeder relevanten Stelle tippen (Foto + Standort). Halten = Serie. Enge Stelle, Schilder, Brücken, Kreisverkehre, Inseln, weicher Untergrund – lieber ein Foto zu viel.
4. Unklare Stelle: ⚑ Nachprüfen. Stichwort zum letzten Bild: Bild unten rechts antippen.
5. Nach der Fahrt: Punkte kurz durchgehen (Straße bestätigen, Stichwort), dann Fahrt → Menü „Mehr“ → „Fahrt senden“ → per WhatsApp/AirDrop zurückschicken.
Texte, Einzeichnungen und das PDF macht die Zentrale.` },
};

// Installieren als App: echter Dialog, wenn der Browser ihn anbietet; sonst Anleitung
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredPrompt = e; });
export const istInstalliert = () => window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;
export async function installieren() {
  if (deferredPrompt) { const p = deferredPrompt; deferredPrompt = null; await p.prompt(); return { done: true }; }
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua);
  const safari = ios && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
  if (ios && safari) return { anleitung: 'iPhone/iPad (Safari):\n1. Unten das Teilen-Symbol (Viereck mit Pfeil) antippen.\n2. „Zum Home-Bildschirm“ wählen.\n3. Oben rechts „Hinzufügen“.\nDie App liegt dann wie jede andere App auf dem Home-Bildschirm. Immer von dort öffnen, damit die Daten an einem Ort bleiben.' };
  if (ios) return { anleitung: 'Auf dem iPhone geht das Installieren nur aus Safari:\n1. Adresse kopieren und in Safari öffnen.\n2. Teilen-Symbol → „Zum Home-Bildschirm“ → „Hinzufügen“.' };
  return { anleitung: 'Android (Chrome): Menü ⋮ → „App installieren“ oder „Zum Startbildschirm hinzufügen“.\nPC (Chrome/Edge): Symbol rechts in der Adressleiste → „Installieren“.' };
}
