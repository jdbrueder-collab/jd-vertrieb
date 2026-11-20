// Test für apps-script/vertrieb.gs ohne Google: Tabellen, Cache und Claude werden nachgebaut.
// Start: node test.js
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const A = 'TABELLE_A_123456789012345', KAPUTT = 'KAPUTT_12345678901234567';

// Kleine Nachbildung einer Tabelle (Zeilen als Array, 1-basiert wie bei Google)
function blatt(rows) {
  const breite = () => Math.max(...rows.map((z) => z.length));
  const range = (r, c, nr = 1, nc = 1) => ({
    getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => (rows[r - 1 + i] || [])[c - 1 + j] ?? '')),
    getValue: () => (rows[r - 1] || [])[c - 1] ?? '',
    setValue: (x) => { (rows[r - 1] ||= [])[c - 1] = x; },
    createTextFinder: (text) => ({
      matchEntireCell() { return this; },
      findNext: () => { for (let i = 0; i < nr; i++) if (String((rows[r - 1 + i] || [])[c - 1]) === text) return { getRow: () => r + i }; return null; },
    }),
  });
  return { rows, getRange: range, getLastRow: () => rows.length, getDataRange: () => range(1, 1, rows.length, breite()), appendRow: (z) => rows.push(z) };
}

function welt(props) {
  const kopf = ['id', 'created_time', 'ad_name', 'platform', 'interesse', 'fahrzeug', 'full_name', 'phone_number', 'lead_status', 'Notiz', 'Termin'];
  const lead = blatt([
    // Meta hat einen neuen Lead über die Kopfzeile geschoben, das Sortier-Skript lief noch nicht
    ['l:3', '2026-11-20T15:00:00-05:00', 'Referenzautos', 'ig', 'referenzauto', 'Golf 4', 'Cora Frisch', 'p:+491713333333', 'CREATED', '', 'Termin'],
    kopf,
    ['l:1', new Date('2026-11-19T09:00:00Z'), 'Referenzautos', 'ig', 'referenzauto', 'Audi A6', 'Anna Alt', 'p:0171 1111111', 'Zurückrufen', 'Hat Interesse', ''],
    ['l:2', 20777.5 + 25569, 'Referenzautos', 'fb', 'aufbereitung', '', 'Ben Neu', 'p:+49 171 2222222', '', '', ''],
    ['', '', '', '', '', '', 'Von Hand', '0171 4444444', 'Offen', '', ''],
  ]);
  const heim = blatt([['Link'], ['https://docs.google.com/spreadsheets/d/' + A + '/edit?usp=sharing', ''], ['https://docs.google.com/spreadsheets/d/' + KAPUTT + '/edit', 'Alt']]);
  const feedback = [], cache = {};
  let claudeBody = null;
  const ctx = {
    console, JSON, Date, Object, String, Number, Array, Math, isNaN, Set,
    SpreadsheetApp: {
      flush() {},
      getActiveSpreadsheet: () => ({
        // Skript liegt in einer Lead-Tabelle: erster Reiter sind Leads, die Links stehen im zweiten
        getSheets: () => [blatt([['id', 'created_time'], ['l:77', '20.11.2026 10:00']]), heim], getUrl: () => 'https://heim',
        getSheetByName: (n) => (n === 'Feedback' && feedback.length ? { appendRow: (r) => feedback.push(r) } : null),
        insertSheet: () => ({ appendRow: (r) => feedback.push(r) }),
      }),
      openById: (id) => {
        if (id !== A) throw new Error('Datei nicht gefunden');
        return { getSheets: () => [blatt([['Nur ein Hinweis']]), lead], getName: () => 'Leads November 2026', getUrl: () => 'https://a', getSpreadsheetTimeZone: () => 'Europe/Berlin' };
      },
    },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props[k] }) },
    CacheService: { getScriptCache: () => ({ get: (k) => cache[k], put: (k, v) => { cache[k] = v; } }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    Utilities: {
      getUuid: () => 'abcdef12-0000',
      formatDate: (d, tz, f) => f === 'dd.MM.yy HH:mm' ? '20.11.26 14:03' : f.startsWith('yyyy') ? d.toISOString().slice(0, 19) : 'Freitag',
    },
    ContentService: { createTextOutput: (t) => ({ t, setMimeType() { return this; } }), MimeType: { JSON: 'json' } },
    UrlFetchApp: { fetch: (url, o) => {
      claudeBody = { url, headers: o.headers, body: JSON.parse(o.payload) };
      const antwort = { zusammenfassung: 'Will den Audi aufbereiten lassen.', naechster_schritt: 'Freitag zurückrufen.', status: 'Zurückrufen', naechster_kontakt: '2026-11-27' };
      return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: JSON.stringify(antwort) }] }) };
    } },
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(__dirname + '/apps-script/vertrieb.gs', 'utf8'), ctx);
  const post = (d) => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(d) } }).t);
  return { post, lead: lead.rows, heim: heim.rows, feedback, cache, claude: () => claudeBody };
}

const w = welt({ TEAM_PASSWORT: 'geheim', ANTHROPIC_API_KEY: 'sk-ant-api-test' });
const pw = 'geheim', anna = A + '~l:1', ben = A + '~l:2';

// Falsches Passwort wird abgelehnt und gezählt
let r = w.post({ aktion: 'liste', pw: 'falsch' });
assert.strictEqual(r.ok, false); assert.strictEqual(r.code, 'pw'); assert.strictEqual(w.cache.fehlversuche, '1');

// Liste: Leads auch über der Kopfzeile, neueste zuerst, Meta-Reste ignoriert, kaputte Tabelle gemeldet statt Absturz
r = w.post({ aktion: 'liste', pw });
assert.ok(r.ok, r.fehler);
assert.strictEqual(r.leads.map((l) => l.name).join('|'), 'Cora Frisch|Ben Neu|Anna Alt|Von Hand');
const [cora, , a] = r.leads;
assert.strictEqual(cora.status, 'Neu');                 // CREATED zählt als neu
assert.strictEqual(cora.naechster, '');                 // "Termin" als Meta-Rest ist kein Datum
assert.strictEqual(cora.wa, 'https://wa.me/491713333333');
assert.strictEqual(a.id, anna);
assert.strictEqual(a.status, 'Zurückrufen');
assert.strictEqual(a.telefon, '0171 1111111');           // ohne "p:"
assert.strictEqual(a.wa, 'https://wa.me/491711111111');
assert.strictEqual(a.quelle, 'Instagram');
assert.strictEqual(JSON.stringify(a.antworten), '[["Interesse","Referenzauto"],["Fahrzeug","Audi A6"]]');
assert.strictEqual(r.leads[1].datum, new Date(Math.round(20777.5 * 864e5)).toISOString().slice(0, 19)); // Tabellen-Zahl
assert.strictEqual(r.leads[3].status, 'Offen');
assert.match(w.lead[4][0], /^manuell-abcdef12$/);         // von Hand eingetragener Lead bekommt eine id
assert.strictEqual(w.heim[1][1], 'Leads November 2026');  // Name landet in Spalte B
assert.strictEqual(r.tabellen[0].anzahl, 4);
assert.match(r.tabellen[1].fehler, /Kein Zugriff/);
assert.strictEqual(r.heimUrl, 'https://heim');

// Meta schiebt zwischendurch noch einen Lead nach oben: gespeichert wird trotzdem beim richtigen Lead
w.lead.unshift(['l:4', '', '', '', '', '', 'Dora Dazwischen', 'p:+491715555555', 'CREATED', '', '']);
r = w.post({ aktion: 'speichern', pw, wer: 'David', id: anna, status: 'Terminiert', naechster: '2026-11-25', notiz: 'Erster Anruf' });
assert.ok(r.ok, r.fehler);
const zeileAnna = w.lead.find((z) => z[6] === 'Anna Alt');
assert.strictEqual(zeileAnna[8], 'Terminiert');
assert.ok(zeileAnna[10] instanceof Date);
assert.strictEqual(zeileAnna[9], 'Hat Interesse\n\n20.11.26 14:03 David: Erster Anruf'); // angehängt, nicht überschrieben
assert.strictEqual(w.lead.find((z) => z[6] === 'Dora Dazwischen')[9], '');
assert.strictEqual(r.lead.naechster, '2026-11-25');
assert.strictEqual(w.post({ aktion: 'speichern', pw, id: anna, status: 'Neu' }).lead.status, 'Neu');
assert.strictEqual(zeileAnna[8], '');                     // Neu = Status leeren
assert.strictEqual(w.post({ aktion: 'speichern', pw, id: anna, status: 'Quatsch' }).code, 'status');
assert.strictEqual(w.post({ aktion: 'speichern', pw, id: anna, naechster: 'morgen' }).code, 'datum');
assert.strictEqual(w.post({ aktion: 'speichern', pw, id: A + '~l:9', notiz: 'x' }).code, 'weg');
assert.strictEqual(w.post({ aktion: 'speichern', pw, id: 'l:1', notiz: 'x' }).code, 'weg');

// KI: richtige Anfrage an Claude, Zusammenfassung als KI-Eintrag in der Notiz, Vorschlag kommt zurück
assert.strictEqual(w.post({ aktion: 'ki', pw, id: ben }).code, 'leer');
r = w.post({ aktion: 'ki', pw, wer: 'David', id: anna });
assert.ok(r.ok, r.fehler);
const c = w.claude();
assert.strictEqual(c.url, 'https://api.anthropic.com/v1/messages');
assert.strictEqual(c.headers['x-api-key'], 'sk-ant-api-test');
assert.strictEqual(c.body.model, 'claude-opus-5-5');
assert.strictEqual(c.body.output_config.format.type, 'json_schema');
assert.match(c.body.messages[0].content, /Erster Anruf/);
assert.match(c.body.messages[0].content, /Fahrzeug: Audi A6/);
assert.strictEqual(r.lead.ki, 'Will den Audi aufbereiten lassen.\nNächster Schritt: Freitag zurückrufen.');
assert.doesNotMatch(r.lead.notizen, /KI:/);               // Verlauf zeigt nur, was das Team geschrieben hat
assert.match(zeileAnna[9], /\n\n20\.11\.26 14:03 KI: Will den Audi/);
assert.strictEqual(JSON.stringify(r.vorschlag), '{"status":"Zurückrufen","naechster":"2026-11-27"}');

// Feedback
assert.strictEqual(w.post({ aktion: 'feedback', pw, text: ' ' }).code, 'leer');
assert.ok(w.post({ aktion: 'feedback', pw, wer: 'David', art: 'Idee', text: 'Mehr Gold' }).ok);
assert.strictEqual(w.feedback.at(-1).slice(1).join('|'), 'David|Idee|Mehr Gold');

// Ohne Schlüssel: verständliche Meldung statt Absturz
const ohne = welt({ TEAM_PASSWORT: 'x' });
ohne.post({ aktion: 'speichern', pw: 'x', id: anna, notiz: 'hallo' });
assert.match(ohne.post({ aktion: 'ki', pw: 'x', id: anna }).fehler, /noch nicht eingerichtet/);

// Sperre nach 10 Fehlversuchen
for (let i = 0; i < 10; i++) w.post({ aktion: 'liste', pw: 'falsch' });
assert.match(w.post({ aktion: 'liste', pw }).fehler, /Zu viele Fehlversuche/);

console.log('✓ Alle Tests bestanden');
