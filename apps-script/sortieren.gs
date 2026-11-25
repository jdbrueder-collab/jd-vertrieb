// ===== LEADS NOV 2026 (Meta Lead Ads, Referenzautos + Angebote) =====
// Stand: 20.11.2026. Aufgebaut wie die Heldenwerker-Leadlisten:
// Header immer in Zeile 1, neueste Leads oben, Dropdown in lead_status,
// Zeilenfarbe nach Status über die ganze Zeile bis zur letzten Header-Spalte,
// Kalender zur Datumsauswahl in Spalte S (Termin).
// Seit 23.11.2026 genauso für den Reiter „Website-Anfragen“ (legt JD Vertrieb bei der ersten
// Anfrage über das Formular auf jd-brueder.de an, Termin steht dort in Spalte K).
//
// Einrichtung: Code einfügen, speichern, einmal "einrichten" ausführen.
// Danach sortiert das Skript alle 10 Minuten, Farben setzen sich sofort bei Statusänderung.

const SHEET_NAMEN = ["Tabellenblatt1", "Website-Anfragen"]; // Meta-Leads, Anfragen der Website
const STATUS_NAME = "lead_status";
const NOTIZ_NAMEN = ["Notiz", "Notizen"];
const DATUM_NAME = "created_time";
const STATUS_WERTE = ["Neu", "Nicht erreicht", "Angebot abgeschickt", "Termin", "Unqualifiziert"]; // Neu = weiß, zum Zurücksetzen
// Seit 25.11.2026 nur noch diese Status. Alte Werte werden beim Sortieren umgeschrieben statt gelöscht.
const ALTE_STATUS = { "offen": "Nicht erreicht", "zurückrufen": "Nicht erreicht", "terminiert": "Termin", "auftrag": "Termin" };
const KALENDER_NAME = "Termin";    // Spalte mit dieser Überschrift bekommt den Kalender (Doppelklick)
const KALENDER_SPALTE = 19;        // S: falls es noch keine Spalte „Termin“ gibt, kommt sie hierhin (nur wenn S1 leer)

// Was Meta beim Eintragen als Müll hinterlässt (zusätzlich zu den eigenen Header-Namen)
const META_MUELL = ["CREATED", "id", "created_time", "ad_id", "ad_name", "adset_id",
  "adset_name", "campaign_id", "campaign_name", "form_id", "form_name", "is_organic",
  "platform", "full_name", "phone_number", "email", "lead_status"];

const HEADER_BG   = "#999999";
const FARBE_GRUEN = "#93c47d";
const FARBE_GELB  = "#ffd966";
const FARBE_ROT   = "#e06666";
const FARBE_BLAU  = "#9fc5e8";
const FARBE_WEISS = "#ffffff";

// ===== EINMALIG AUSFÜHREN =====
function einrichten() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === "autoSortLeads")
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger("autoSortLeads").timeBased().everyMinutes(10).create();
  autoSortLeads();
  repariereErsteZeiten_();
}

// ===== EINMAL-KORREKTUR (20.11.2026) =====
// Die erste Version hat diese Leads in GMT statt deutscher Zeit eingetragen, 1 Stunde zu früh.
// Hier stehen ihre Original-Zeiten von Meta. Kann gefahrlos mehrfach laufen und später raus.
const ERSTE_ZEITEN = {
  "l:1486766926671186": "2026-11-20T09:14:03-05:00", "l:1923595338798743": "2026-11-20T09:11:49-05:00",
  "l:1447516326904544": "2026-11-18T10:18:47-05:00", "l:2403796073770383": "2026-11-18T12:11:05-05:00",
  "l:1168449839106030": "2026-11-18T17:50:27-05:00", "l:1766834724413090": "2026-11-19T03:02:10-05:00",
  "l:1781359809638265": "2026-11-19T05:52:12-05:00", "l:1706986404371597": "2026-11-19T08:16:54-05:00",
  "l:1392342333970791": "2026-11-19T08:28:29-05:00", "l:1132130973017412": "2026-11-19T11:24:51-05:00",
  "l:1125831603768827": "2026-11-19T11:53:44-05:00", "l:1446288970387026": "2026-11-19T12:51:19-05:00",
  "l:3129302840598178": "2026-11-19T14:36:36-05:00", "l:1675666084283580": "2026-11-19T15:15:43-05:00",
  "l:1114944794646769": "2026-11-19T16:10:47-05:00", "l:3481035185389766": "2026-11-19T19:16:16-05:00",
  "l:1786485759127791": "2026-11-20T03:00:23-05:00", "l:1724122816043933": "2026-11-20T04:47:42-05:00",
  "l:3236215839905182": "2026-11-20T08:56:46-05:00",
};

function repariereErsteZeiten_() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAMEN[0]);
  const lastRow = sheet.getLastRow();
  const sp = spalten_(sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]);
  if (lastRow < 2 || !sp.datum) return;
  sheet.getRange(2, 1, lastRow - 1, 1).getValues().forEach((id, i) => {
    const iso = ERSTE_ZEITEN[String(id[0]).trim()];
    if (iso) sheet.getRange(2 + i, sp.datum).setValue(berlinSerial_(new Date(iso)));
  });
}

// ===== HILFSFUNKTIONEN =====
function normalisiereStatus_(status) {
  return String(status === null || status === undefined ? "" : status)
    .replace(/ /g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

// Zeitpunkt als Tabellen-Zahl in deutscher Uhrzeit. Eine Zahl statt eines Datums,
// damit die Zeitzonen-Einstellung der Tabelle keine Rolle spielt (diese hier hat keine).
function berlinSerial_(datum) {
  const t = Utilities.formatDate(datum, "Europe/Berlin", "yyyy-MM-dd-HH-mm-ss").split("-").map(Number);
  return Date.UTC(t[0], t[1] - 1, t[2], t[3], t[4], t[5]) / 86400000 + 25569;
}

function farbeFuerStatus_(status) {
  const s = normalisiereStatus_(status);
  if (s === "termin") return FARBE_GRUEN;
  if (s === "nicht erreicht") return FARBE_GELB;
  if (s === "unqualifiziert") return FARBE_ROT;
  if (s === "angebot abgeschickt") return FARBE_BLAU;
  return FARBE_WEISS;
}

// Spaltennummern (1-basiert, 0 = fehlt) anhand der Kopfzeile.
// breite = letzte beschriftete Header-Spalte. Alles rechts davon ist Meta-Gebiet.
function spalten_(header) {
  const namen = header.map(h => String(h).trim());
  let breite = namen.length;
  while (breite > 0 && !namen[breite - 1]) breite--;
  return {
    status: namen.indexOf(STATUS_NAME) + 1,
    notiz: namen.findIndex(h => NOTIZ_NAMEN.includes(h)) + 1,
    datum: namen.indexOf(DATUM_NAME) + 1,
    kalender: namen.indexOf(KALENDER_NAME) + 1,
    breite: breite,
  };
}

// Räumt Meta-Reste auf. Reine Funktion auf dem Werte-Array (Zeile 0 = Kopfzeile).
// - "CREATED" und alles, was nicht im Dropdown steht, wird in lead_status geleert (leer = neuer Lead),
//   sonst bricht das Dropdown beim Setzen ab
// - Meta-Müll in der Notizspalte und rechts vom Header wird geleert
// - echter Text rechts vom Header wird in die Notizspalte verschoben, nie gelöscht
// - created_time im ISO-Format (Meta, US-Zeitzone) wird zu deutscher Uhrzeit
function bereinigeLeads_(werte) {
  const sp = spalten_(werte[0]);
  const muell = new Set(META_MUELL.concat(werte[0].map(h => String(h).trim()).filter(Boolean)));
  const erlaubt = new Set(STATUS_WERTE.map(normalisiereStatus_));
  let geaendert = false;

  for (let r = 1; r < werte.length; r++) {
    const zeile = werte[r];
    const setze = (i, v) => { if (zeile[i] !== v) { zeile[i] = v; geaendert = true; } };

    if (sp.status && ALTE_STATUS[normalisiereStatus_(zeile[sp.status - 1])]) setze(sp.status - 1, ALTE_STATUS[normalisiereStatus_(zeile[sp.status - 1])]);
    if (sp.status && !erlaubt.has(normalisiereStatus_(zeile[sp.status - 1]))) setze(sp.status - 1, "");

    // Kalenderspalte: Meta-Müll raus, Datumswerte bleiben
    const k = (sp.kalender || KALENDER_SPALTE) - 1;
    if (typeof zeile[k] === "string" && muell.has(zeile[k].trim())) setze(k, "");

    const extra = [];
    for (let c = sp.breite; c < zeile.length; c++) {
      const v = String(zeile[c]).trim();
      if (!v) continue;
      if (muell.has(v)) setze(c, "");
      else if (sp.notiz) { extra.push(v); setze(c, ""); }  // ohne Notizspalte bleibt Text stehen
    }

    if (sp.notiz) {
      const n = sp.notiz - 1;
      const eigene = String(zeile[n]).trim();
      const eigeneIstMuell = muell.has(eigene);
      if (eigeneIstMuell || extra.length) {
        setze(n, (eigeneIstMuell ? [] : [eigene]).concat(extra).filter(Boolean).join(" | "));
      }
    }

    if (sp.datum) {
      const d = zeile[sp.datum - 1];
      if (typeof d === "string" && /^\d{4}-\d{2}-\d{2}T/.test(d)) {
        const datum = new Date(d);
        if (!isNaN(datum.getTime())) setze(sp.datum - 1, berlinSerial_(datum));
      }
    }
  }
  return { werte: werte, geaendert: geaendert };
}

// Färbt die Zeilen startRow..startRow+anzahl-1 nach ihrem Status.
function faerbeZeilen_(sheet, startRow, anzahl, sp) {
  if (anzahl < 1 || !sp.status) return;
  const status = sheet.getRange(startRow, sp.status, anzahl, 1).getValues();
  const farben = status.map(s => new Array(sp.breite).fill(farbeFuerStatus_(s[0])));
  sheet.getRange(startRow, 1, anzahl, sp.breite).setBackgrounds(farben);
}

// ===== FARBE SOFORT BEI STATUSÄNDERUNG =====
function onEdit(e) {
  if (!e) return;
  const sheet = e.range.getSheet();
  if (!SHEET_NAMEN.includes(sheet.getName()) || e.range.getRow() < 2) return;

  const sp = spalten_(sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]);
  if (!sp.status) return; // Header steht gerade nicht oben, der nächste Sortierlauf richtet das
  if (sp.status < e.range.getColumn() || sp.status > e.range.getLastColumn()) return;

  faerbeZeilen_(sheet, e.range.getRow(), e.range.getNumRows(), sp);
}

// ===== HEADER FIX + AUFRÄUMEN + SORTIEREN + DROPDOWN + FARBEN =====
function autoSortLeads() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  SHEET_NAMEN.forEach(name => {
    const sheet = ss.getSheetByName(name);
    if (sheet) sortiereBlatt_(sheet);   // Reiter „Website-Anfragen“ gibt es erst nach der ersten Anfrage
  });
}

function sortiereBlatt_(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;

  // Meta fügt neue Leads über dem Header ein. Header (created_time in Spalte B) zurück nach Zeile 1.
  const spalteB = sheet.getRange(1, 2, Math.min(lastRow, 50), 1).getValues();
  const headerRow = spalteB.findIndex(v => String(v[0]).trim() === DATUM_NAME) + 1;
  if (headerRow === 0) {
    console.warn("Kopfzeile nicht gefunden (created_time in Spalte B).");
    return;
  }
  if (headerRow > 1) sheet.moveRows(sheet.getRange(headerRow + ":" + headerRow), 1);

  // Überschrift für die Kalenderspalte, damit S zur Tabelle gehört und nicht als Meta-Müll gilt.
  // Hat der Reiter schon eine Spalte „Termin“ (Website-Anfragen: K), bleibt alles, wie es ist.
  const kopf = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  if (!kopf.some(h => String(h).trim() === KALENDER_NAME)) {
    const kopfKalender = sheet.getRange(1, KALENDER_SPALTE);
    if (!String(kopfKalender.getValue()).trim()) kopfKalender.setValue(KALENDER_NAME);
  }
  const lastCol = sheet.getLastColumn();

  // Meta-Reste aufräumen, nur schreiben wenn sich etwas geändert hat
  const ergebnis = bereinigeLeads_(sheet.getRange(1, 1, lastRow, lastCol).getValues());
  const sp = spalten_(ergebnis.werte[0]);
  if (!sp.status || !sp.datum) {
    console.warn("Spalte lead_status oder created_time fehlt in der Kopfzeile.");
    return;
  }
  if (ergebnis.geaendert) {
    sheet.getRange(2, 1, lastRow - 1, lastCol).setValues(ergebnis.werte.slice(1));
  }
  if (lastCol > sp.breite) {
    sheet.getRange(1, sp.breite + 1, sheet.getMaxRows(), lastCol - sp.breite).clearFormat();
  }

  // Neueste zuerst
  const daten = sheet.getRange(2, 1, lastRow - 1, sp.breite);
  daten.sort({ column: sp.datum, ascending: false });
  sheet.getRange(2, sp.datum, lastRow - 1, 1).setNumberFormat("dd.MM.yyyy HH:mm");

  // Dropdown wie bei Heldenwerker
  const regel = SpreadsheetApp.newDataValidation()
    .requireValueInList(STATUS_WERTE, true)
    .setAllowInvalid(false)
    .build();
  sheet.getRange(2, sp.status, lastRow - 1, 1).setDataValidation(regel);

  // Kalender in der Spalte „Termin“: Datumsprüfung sorgt für die Kalenderauswahl beim Doppelklick
  sheet.getRange(2, sp.kalender || KALENDER_SPALTE, lastRow - 1, 1)
    .setDataValidation(SpreadsheetApp.newDataValidation().requireDate().setAllowInvalid(false).build())
    .setNumberFormat("dd.MM.yyyy");

  // Header grau + fett, Leads normal, Farben nach Status
  sheet.getRange(1, 1, 1, sp.breite).setBackground(HEADER_BG).setFontWeight("bold");
  daten.setFontWeight("normal");
  faerbeZeilen_(sheet, 2, lastRow - 1, sp);
}
