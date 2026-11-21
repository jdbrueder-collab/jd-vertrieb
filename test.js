// Test für apps-script/vertrieb.gs ohne Google: Tabellen, Cache und Claude werden nachgebaut.
// Start: node test.js
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const A = 'TABELLE_A_123456789012345', KAPUTT = 'KAPUTT_12345678901234567';

// Kleine Nachbildung einer Tabelle (Zeilen als Array, 1-basiert wie bei Google)
function blatt(rows) {
  const breite = () => Math.max(...rows.map((z) => z.length));
  const p2 = (n) => String(n).padStart(2, '0');
  // Anzeige wie in Sheets: Datum als dd.MM.yyyy HH:mm, Zahl mit Komma
  const zeige = (x) => x instanceof Date ? `${p2(x.getUTCDate())}.${p2(x.getUTCMonth() + 1)}.${x.getUTCFullYear()} ${p2(x.getUTCHours())}:${p2(x.getUTCMinutes())}`
    : typeof x === 'number' ? String(x).replace('.', ',') : String(x);
  const range = (r, c, nr = 1, nc = 1) => ({
    getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => (rows[r - 1 + i] || [])[c - 1 + j] ?? '')),
    getValue: () => (rows[r - 1] || [])[c - 1] ?? '',
    getDisplayValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => zeige((rows[r - 1 + i] || [])[c - 1 + j] ?? ''))),
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
  const feedback = [], cache = {}, pushes = [], drive = { ordner: [], geaendert: 1, weg: [] };
  let claudeBody = null;
  const ordner = (name) => {
    const o = { id: 'O' + drive.ordner.length, name, dateien: [], freigabe: null, getId: () => o.id, getUrl: () => 'https://drive/' + o.id,
      createFolder: (n) => ordner(n), setSharing: (a, b) => { o.freigabe = a + '/' + b; },
      createFile: (blob) => { o.dateien.push(blob); },
      getFiles: () => { let i = 0; return { hasNext: () => i < o.dateien.length, next: () => { const b = o.dateien[i++]; return { getName: () => b.name, getUrl: () => 'https://datei/' + b.name, getThumbnail: () => ({ getContentType: () => 'image/png', getBytes: () => [1, 2, 3] }) }; } }; } };
    drive.ordner.push(o);
    return o;
  };
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
        return { getSheets: () => [blatt([['Nur ein Hinweis']]), lead], getName: () => 'Leads November 2026', getUrl: () => 'https://a' }; // ohne Zeitzone, wie die echte Tabelle
      },
    },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props[k] ?? null, setProperty: (k, v) => { props[k] = v; }, setProperties: (o) => Object.assign(props, o) }) },
    DriveApp: {
      Access: { ANYONE_WITH_LINK: 'jeder' }, Permission: { VIEW: 'ansehen' },
      getFileById: () => ({ getLastUpdated: () => new Date(drive.geaendert) }),
      createFolder: (n) => ordner(n), getFolderById: (id) => drive.ordner.find((o) => o.id === id), getRootFolder: () => ({}),
    },
    CacheService: { getScriptCache: () => ({ get: (k) => cache[k], put: (k, v) => { cache[k] = v; } }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    Utilities: {
      getUuid: () => 'abcdef12-0000',
      newBlob: (bytes, typ, name) => ({ bytes, typ, name }),
      base64Decode: (t) => Array.from(Buffer.from(t, 'base64')), base64Encode: (b) => Buffer.from(b).toString('base64'),
      formatDate: (d, tz, f) => f === 'dd.MM.yy HH:mm' ? '20.11.26 14:03' : f.startsWith('yyyy') ? d.toISOString().slice(0, 19) : 'Freitag',
    },
    ContentService: { createTextOutput: (t) => ({ t, setMimeType() { return this; } }), MimeType: { JSON: 'json' } },
    UrlFetchApp: { fetch: (url, o) => {
      if (url.includes('workers.dev')) {
        pushes.push({ url, headers: o.headers, body: JSON.parse(o.payload) });
        return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ weg: drive.weg }) };
      }
      claudeBody = { url, headers: o.headers, body: JSON.parse(o.payload) };
      const antwort = { stichpunkte: ['Will Komplettpaket', 'Ruft\n\nnach Rücksprache zurück'], naechster_schritt: 'Freitag zurückrufen', status: 'Zurückrufen', naechster_kontakt: '2026-11-27' };
      return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: JSON.stringify(antwort) }] }) };
    } },
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(__dirname + '/apps-script/vertrieb.gs', 'utf8'), ctx);
  const post = (d) => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(d) } }).t);
  return { post, ctx, props, pushes, drive, aendern: () => drive.geaendert++, lead: lead.rows, heim: heim.rows, feedback, cache, claude: () => claudeBody };
}

const w = welt({ TEAM_PASSWORT: 'geheim', ANTHROPIC_API_KEY: 'sk-ant-api-test', PUSH_GEHEIMNIS: 'push-geheim' });
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
assert.strictEqual(a.datum, '2026-11-19T09:00:00');        // aus der Anzeige, ohne Zeitzone der Tabelle
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
assert.strictEqual(r.lead.ki, '• Will Komplettpaket\n• Ruft nach Rücksprache zurück\nNächster Schritt: Freitag zurückrufen');
assert.doesNotMatch(r.lead.notizen, /KI:/);               // Verlauf zeigt nur, was das Team geschrieben hat
assert.match(zeileAnna[9], /\n\n20\.11\.26 14:03 KI: • Will Komplettpaket\n/);
assert.strictEqual(JSON.stringify(r.vorschlag), '{"status":"Zurückrufen","naechster":"2026-11-27"}');

// Feedback
assert.strictEqual(w.post({ aktion: 'feedback', pw, text: ' ' }).code, 'leer');
assert.ok(w.post({ aktion: 'feedback', pw, wer: 'David', art: 'Idee', text: 'Mehr Gold' }).ok);
assert.strictEqual(w.feedback.at(-1).slice(1).join('|'), 'David|Idee|Mehr Gold');

// Ohne Schlüssel: verständliche Meldung statt Absturz
const ohne = welt({ TEAM_PASSWORT: 'x' });
ohne.post({ aktion: 'speichern', pw: 'x', id: anna, notiz: 'hallo' });
assert.match(ohne.post({ aktion: 'ki', pw: 'x', id: anna }).fehler, /noch nicht eingerichtet/);

// Benachrichtigungen: nur echte Push-Dienste, ein Gerät nur einmal
const abo = { endpoint: 'https://web.push.apple.com/abc', keys: { p256dh: 'P', auth: 'A' } };
assert.strictEqual(w.post({ aktion: 'push', pw, abo: { ...abo, endpoint: 'https://boese.example/x' } }).code, 'push');
assert.ok(w.post({ aktion: 'push', pw, wer: 'David', abo }).ok);
assert.ok(w.post({ aktion: 'push', pw, wer: 'David', abo }).ok);
assert.strictEqual(JSON.parse(w.props.PUSH_ABOS).length, 1);
const handy2 = { endpoint: 'https://fcm.googleapis.com/fcm/send/zwei', keys: { p256dh: 'Q', auth: 'B' } };
assert.ok(w.post({ aktion: 'pushTest', pw, wer: 'Jonathan', abo: handy2 }).ok);   // Testnachricht nur an das neue Gerät
assert.strictEqual(w.pushes.length, 1);
assert.strictEqual(JSON.stringify(w.pushes[0].body.abos.map((a) => a.endpoint)), JSON.stringify([handy2.endpoint]));
assert.strictEqual(JSON.parse(w.props.PUSH_ABOS).length, 2);
w.pushes.length = 0; w.props.PUSH_ABOS = JSON.stringify([abo]);

// Neue Leads: erster Lauf merkt nur, danach wird jeder neue Lead genau einmal gemeldet
w.ctx.meldeNeueLeads();
assert.strictEqual(w.pushes.length, 0);
w.lead.push(['l:5', new Date().toISOString(), 'Referenzautos', 'ig', 'aufbereitung', 'BMW X5', 'Eva Neu', 'p:+491715555555', 'CREATED', '', '']);
w.ctx.meldeNeueLeads();                       // Tabelle laut Drive unverändert: gar nicht erst gelesen
assert.strictEqual(w.pushes.length, 0);
w.aendern(); w.ctx.meldeNeueLeads();
assert.strictEqual(w.pushes.length, 1);
assert.strictEqual(w.pushes[0].headers.Authorization, 'Bearer push-geheim');
assert.strictEqual(w.pushes[0].body.title, '🔔 Neuer Lead: Eva Neu');
assert.strictEqual(w.pushes[0].body.body, 'Aufbereitung · BMW X5');
assert.match(w.pushes[0].body.url, /#lead=TABELLE_A_123456789012345~l%3A5$/);
w.aendern(); w.ctx.meldeNeueLeads();
assert.strictEqual(w.pushes.length, 1);

// Morgens fällige Leads; abgemeldete Geräte fliegen raus, ohne Geräte wird nichts mehr geschickt
const ben5 = w.lead.find((z) => z[6] === 'Ben Neu');
ben5[8] = 'Zurückrufen'; ben5[10] = new Date('2026-01-01T12:00:00Z');
w.drive.weg = [abo.endpoint];
w.ctx.meldeFaellige();
assert.match(w.pushes[1].body.title, /^☎️ Heute fällig: \d+$/);
assert.match(w.pushes[1].body.body, /Ben Neu/);
assert.strictEqual(w.props.PUSH_ABOS, '[]');
w.ctx.meldeFaellige();
assert.strictEqual(w.pushes.length, 2);

// Fotos: nur Bilder, ein Ordner pro Lead mit Namen und Auto, Vorschau, Ordner per Link sichtbar
assert.strictEqual(JSON.stringify(w.post({ aktion: 'fotos', pw, id: anna })), '{"ok":true,"fotos":[],"ordner":""}');
assert.strictEqual(w.post({ aktion: 'foto', pw, id: anna, typ: 'text/html', daten: 'eA==' }).code, 'foto');
assert.ok(w.post({ aktion: 'foto', pw, id: anna, typ: 'image/jpeg', nr: 1, daten: Buffer.from('bild-1').toString('base64') }).ok);
assert.ok(w.post({ aktion: 'foto', pw, id: anna, typ: 'image/jpeg', nr: 2, daten: Buffer.from('bild-2').toString('base64') }).ok);
assert.strictEqual(w.drive.ordner.map((o) => o.name).join('|'), 'JD Vertrieb Fotos|Anna Alt, Audi A6');
assert.strictEqual(Buffer.from(w.drive.ordner[1].dateien[0].bytes).toString(), 'bild-1');   // unverändert, volle Auflösung
r = w.post({ aktion: 'fotos', pw, id: anna });
assert.strictEqual(r.fotos.length, 2);
assert.match(r.fotos[1].name, / 2\.jpg$/);
assert.strictEqual(r.fotos[0].bild, 'data:image/png;base64,AQID');
assert.strictEqual(r.ordner, 'https://drive/O1');
assert.strictEqual(w.drive.ordner[1].freigabe, 'jeder/ansehen');    // Link an den Kunden funktioniert

// Sperre nach 10 Fehlversuchen
for (let i = 0; i < 10; i++) w.post({ aktion: 'liste', pw: 'falsch' });
assert.match(w.post({ aktion: 'liste', pw }).fehler, /Zu viele Fehlversuche/);

console.log('✓ Alle Tests bestanden');
