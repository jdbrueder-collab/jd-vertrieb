// Test für apps-script/vertrieb.gs ohne Google: Sheet, Cache und Claude werden nachgebaut.
// Start: node test.js
const fs = require('fs'), vm = require('vm'), assert = require('assert');

function welt(props) {
  const kopf = ['Datum', 'Name', 'Telefon', 'Interesse', 'Fahrzeug', 'Anzeige', 'WhatsApp-Link', 'Status', 'Lead-ID'];
  const rows = [kopf,
    [new Date('2026-11-19T09:00:00Z'), 'Anna Alt', '0171 1', 'Premium', 'Golf', 'Ad A', 'https://wa.me/491711', 'Neu', 'L1'],
    [new Date('2026-11-20T09:00:00Z'), 'Ben Neu', '0171 2', 'Basic', 'BMW X5', 'Ad B', 'https://wa.me/491712', '', 'L2'],
    ['', 'Von Hand', '0171 3', '', '', '', '', '', ''],
  ];
  const range = (r, c, nr = 1, nc = 1) => ({
    getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => (rows[r - 1 + i] || [])[c - 1 + j] ?? '')),
    setValues: (v) => v.forEach((z, i) => z.forEach((x, j) => { (rows[r - 1 + i] ||= [])[c - 1 + j] = x; })),
    setValue: (x) => { (rows[r - 1] ||= [])[c - 1] = x; },
  });
  const sheet = { getRange: range, getLastRow: () => rows.length, getLastColumn: () => Math.max(...rows.map((z) => z.length)) };
  const feedback = [];
  const cache = {};
  let claudeBody = null;
  const ctx = {
    console, JSON, Date, Object, String, Number, Array,
    SpreadsheetApp: { getActiveSpreadsheet: () => ({
      getSheets: () => [sheet], getUrl: () => 'https://sheet',
      getSheetByName: (n) => (n === 'Feedback' && feedback.length ? { appendRow: (r) => feedback.push(r) } : null),
      insertSheet: () => ({ appendRow: (r) => feedback.push(r) }),
    }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props[k] }) },
    CacheService: { getScriptCache: () => ({ get: (k) => cache[k], put: (k, v) => { cache[k] = v; } }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    Session: { getScriptTimeZone: () => 'Europe/Berlin' },
    Utilities: {
      getUuid: () => 'abcdef12-0000',
      formatDate: (d, tz, f) => f === 'yyyy-MM-dd' ? d.toISOString().slice(0, 10) : 'FMT',
    },
    ContentService: { createTextOutput: (t) => ({ t, setMimeType() { return this; } }), MimeType: { JSON: 'json' } },
    UrlFetchApp: { fetch: (url, o) => {
      claudeBody = { url, headers: o.headers, body: JSON.parse(o.payload) };
      const antwort = { zusammenfassung: 'Will Premium für den Golf.', naechster_schritt: 'Freitag zurückrufen.', status: 'Rückruf', naechster_kontakt: '2026-11-22' };
      return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: JSON.stringify(antwort) }] }) };
    } },
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(__dirname + '/apps-script/vertrieb.gs', 'utf8'), ctx);
  const post = (d) => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(d) } }).t);
  return { post, rows, feedback, cache, claude: () => claudeBody };
}

const w = welt({ TEAM_PASSWORT: 'geheim', ANTHROPIC_API_KEY: 'sk-ant-api-test' });

// Falsches Passwort wird abgelehnt und gezählt, nach 10 Versuchen ist Sperre
let r = w.post({ aktion: 'liste', pw: 'falsch' });
assert.strictEqual(r.ok, false); assert.strictEqual(r.code, 'pw'); assert.strictEqual(w.cache.fehlversuche, '1');

// Liste: neueste zuerst, Zusatzspalten angelegt, leerer Status = Neu, Lead ohne ID bekommt eine
r = w.post({ aktion: 'liste', pw: 'geheim' });
assert.ok(r.ok, r.fehler);
assert.deepStrictEqual(r.leads.map((l) => l.name), ['Ben Neu', 'Anna Alt', 'Von Hand']);
assert.strictEqual(r.leads[0].status, 'Neu');
assert.ok(w.rows[0].includes('Notizen') && w.rows[0].includes('Nächster Kontakt'));
assert.strictEqual(w.rows[3][8], 'manuell-abcdef12');

// Speichern: Status, Datum, Notiz wird angehängt statt überschrieben
r = w.post({ aktion: 'speichern', pw: 'geheim', wer: 'David', id: 'L1', status: 'Rückruf', naechster: '2026-11-22', notiz: 'Erster Anruf' });
assert.ok(r.ok, r.fehler);
r = w.post({ aktion: 'speichern', pw: 'geheim', wer: 'Jonathan', id: 'L1', notiz: 'Zweiter Anruf' });
assert.strictEqual(r.lead.status, 'Rückruf');
assert.strictEqual(r.lead.naechster, '2026-11-22');
assert.match(r.lead.notizen, /David: Erster Anruf\n\nFMT Jonathan: Zweiter Anruf$/);
assert.strictEqual(w.rows[1][6], 'https://wa.me/491711');   // andere Spalten bleiben unberührt
assert.strictEqual(w.post({ aktion: 'speichern', pw: 'geheim', id: 'L1', status: 'Quatsch' }).code, 'status');
assert.strictEqual(w.post({ aktion: 'speichern', pw: 'geheim', id: 'L1', naechster: 'morgen' }).code, 'datum');
assert.strictEqual(w.post({ aktion: 'speichern', pw: 'geheim', id: 'L9', status: 'Neu' }).code, 'weg');

// KI: richtige Anfrage an Claude, Zusammenfassung landet im Sheet, Vorschlag kommt zurück
assert.strictEqual(w.post({ aktion: 'ki', pw: 'geheim', id: 'L2' }).code, 'leer');
r = w.post({ aktion: 'ki', pw: 'geheim', wer: 'David', id: 'L1' });
assert.ok(r.ok, r.fehler);
const c = w.claude();
assert.strictEqual(c.url, 'https://api.anthropic.com/v1/messages');
assert.strictEqual(c.headers['x-api-key'], 'sk-ant-api-test');
assert.strictEqual(c.body.model, 'claude-opus-5-5');
assert.strictEqual(c.body.output_config.format.type, 'json_schema');
assert.match(c.body.messages[0].content, /Zweiter Anruf/);
assert.match(r.lead.ki, /^Will Premium für den Golf\.\nNächster Schritt: Freitag zurückrufen\.$/);
assert.deepStrictEqual(r.vorschlag, { status: 'Rückruf', naechster: '2026-11-22' });

// Feedback
assert.strictEqual(w.post({ aktion: 'feedback', pw: 'geheim', text: ' ' }).code, 'leer');
assert.ok(w.post({ aktion: 'feedback', pw: 'geheim', wer: 'David', art: 'Idee', text: 'Mehr Gold' }).ok);
assert.strictEqual(w.feedback.at(-1).slice(1).join('|'), 'David|Idee|Mehr Gold');

// Ohne Schlüssel: verständliche Meldung statt Absturz
assert.strictEqual(welt({ TEAM_PASSWORT: 'x' }).post({ aktion: 'ki', pw: 'x', id: 'L1' }).code, 'leer');
const ohne = welt({ TEAM_PASSWORT: 'x' });
ohne.post({ aktion: 'speichern', pw: 'x', id: 'L1', notiz: 'hallo' });
assert.match(ohne.post({ aktion: 'ki', pw: 'x', id: 'L1' }).fehler, /noch nicht eingerichtet/);

// Sperre nach 10 Fehlversuchen
for (let i = 0; i < 10; i++) w.post({ aktion: 'liste', pw: 'falsch' });
assert.match(w.post({ aktion: 'liste', pw: 'geheim' }).fehler, /Zu viele Fehlversuche/);

console.log('✓ Alle Tests bestanden');
