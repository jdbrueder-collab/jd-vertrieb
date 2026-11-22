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
  const kopf = ['id', 'created_time', 'ad_name', 'platform', 'interesse', 'fahrzeug', 'full_name', 'phone_number', 'lead_status', 'Notiz', 'Termin', 'email', 'city'];
  const lead = blatt([
    // Meta hat einen neuen Lead über die Kopfzeile geschoben, das Sortier-Skript lief noch nicht
    ['l:3', '2026-11-20T15:00:00-05:00', 'Referenzautos', 'ig', 'referenzauto', 'Golf 4', 'Cora Frisch', 'p:+491713333333', 'CREATED', '', 'Termin'],
    kopf,
    ['l:1', new Date('2026-11-19T09:00:00Z'), 'Referenzautos', 'ig', 'referenzauto', 'Audi A6', 'Anna Alt', 'p:0171 1111111', 'Zurückrufen', 'Hat Interesse', ''],
    ['l:2', 20777.5 + 25569, 'Referenzautos', 'fb', 'aufbereitung', '', 'Ben Neu', 'p:+49 171 2222222', '', '', '', 'ben@example.de', 'Puderbach'],
    ['', '', '', '', '', '', 'Von Hand', '0171 4444444', 'Offen', '', ''],
  ]);
  const heim = blatt([['Link'], ['https://docs.google.com/spreadsheets/d/' + A + '/edit?usp=sharing', ''], ['https://docs.google.com/spreadsheets/d/' + KAPUTT + '/edit', 'Alt']]);
  const feedback = [], cache = {}, pushes = [], mails = [], drive = { ordner: [], geaendert: 1, weg: [] };
  // Nachgebautes Lexware: merkt sich Anfragen, Antworten lassen sich vorgeben (z. B. 429)
  const lexware = { anfragen: [], naechste: [], vorhanden: [] };   // vorhanden: Kunden, die es in Lexware schon gibt
  const lexAntwort = (url, o) => {
    const body = o.payload ? JSON.parse(o.payload) : null, pfad = url.replace('https://api.lexware.io', '');
    lexware.anfragen.push({ pfad, methode: o.method, auth: o.headers.Authorization, accept: o.headers.Accept, body });
    const vor = lexware.naechste.shift();
    if (vor) return { getResponseCode: () => vor.code, getContentText: () => JSON.stringify(vor.body || {}) };
    let j = null;
    if (pfad === '/v1/profile') j = { companyName: 'JD Brüder GbR', smallBusiness: false, taxType: 'net' };
    else if (pfad.startsWith('/v1/articles')) j = { content: [
      { id: 'A2', title: 'Politur', type: 'SERVICE', unitName: 'Pauschal', price: { netPrice: 168.07, grossPrice: 200, leadingPrice: 'GROSS', taxRate: 19 } },
      { id: 'A1', title: 'Interieur Aufbereitung', type: 'SERVICE', unitName: 'Stück', description: 'Sitze, Teppich, Himmel', price: { netPrice: 190, leadingPrice: 'NET', taxRate: 19 } },
      { id: 'A4', title: 'Auftragspauschale', type: 'PRODUCT', unitName: 'Stück', price: { netPrice: 58, grossPrice: 58, leadingPrice: 'NET', taxRate: 0 } },
      { id: 'A3', title: 'Alt', type: 'PRODUCT', archived: true, price: {} }] };
    else if (pfad.startsWith('/v1/contacts?')) j = { content: lexware.vorhanden.filter((c) => c.person.lastName === decodeURIComponent(pfad.split('name=')[1])) };
    else if (pfad === '/v1/contacts' && o.method === 'post') { lexware.kontakt = Object.assign({}, body, { id: 'K-1', version: 1 }); j = { id: 'K-1', version: 1 }; }
    else if (pfad === '/v1/contacts/K-1' && o.method === 'get') j = JSON.parse(JSON.stringify(lexware.kontakt));
    else if (pfad === '/v1/contacts/K-1' && o.method === 'put') { lexware.kontakt = Object.assign(body, { version: body.version + 1 }); j = { id: 'K-1' }; }
    else if (pfad === '/v1/quotations?finalize=true') j = { id: 'Q-1', version: 1 };
    else if (pfad === '/v1/quotations/Q-1') j = { id: 'Q-1', voucherNumber: 'AG0049', voucherStatus: 'open', totalPrice: { totalGrossAmount: 409.56 } };
    else if (pfad === '/v1/quotations/Q-1/file') return { getResponseCode: () => 200, getBlob: () => ({ bytes: '%PDF', getBytes: () => [37, 80, 68, 70], setName(n) { this.name = n; return this; } }) };
    return { getResponseCode: () => j ? 200 : 404, getContentText: () => JSON.stringify(j || {}) };
  };

  let claudeBody = null;
  const ordner = (name) => {
    const o = { id: 'O' + drive.ordner.length, name, dateien: [], freigabe: null, getId: () => o.id, getUrl: () => 'https://drive/' + o.id,
      createFolder: (n) => ordner(n), setSharing: (a, b) => { o.freigabe = a + '/' + b; },
      createFile: (blob) => { o.dateien.push(blob); return { getUrl: () => 'https://datei/' + blob.name, setSharing() {} }; },
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
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props[k] ?? null, setProperty: (k, v) => { props[k] = v; }, setProperties: (o) => Object.assign(props, o), deleteProperty: (k) => { delete props[k]; }, getProperties: () => ({ ...props }) }) },
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
      formatDate: (d, tz, f) => f === 'dd.MM.yy HH:mm' ? '20.11.26 14:03' : f.endsWith('XXX') ? d.toISOString().slice(0, 23) + '+01:00' : f === 'yyyy-MM-dd' ? d.toISOString().slice(0, 10) : f.startsWith('yyyy') ? d.toISOString().slice(0, 19) : 'Freitag',
      sleep: () => {},
    },
    MailApp: { sendEmail: (m) => mails.push(m), getRemainingDailyQuota: () => 100 },
    ContentService: { createTextOutput: (t) => ({ t, setMimeType() { return this; } }), MimeType: { JSON: 'json' } },
    UrlFetchApp: { fetch: (url, o) => {
      if (url.startsWith('https://api.lexware.io')) return lexAntwort(url, o);
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
  return { post, ctx, lexware, mails, props, pushes, drive, aendern: () => drive.geaendert++, lead: lead.rows, heim: heim.rows, feedback, cache, claude: () => claudeBody };
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

// WhatsApp-Vorlage: Platzhalter {Name} und {Wunsch} müssen bleiben, danach kommt sie mit der Liste
assert.strictEqual(JSON.stringify(w.post({ aktion: 'liste', pw }).texte), '{}');
assert.strictEqual(w.post({ aktion: 'vorlage', pw, vorlage: 'Hallo, ruf zurück' }).code, 'vorlage');
assert.strictEqual(w.post({ aktion: 'vorlage', pw, vorlage: 'Hallo {Name}, ruf zurück' }).code, 'vorlage');
assert.ok(w.post({ aktion: 'vorlage', pw, vorlage: ' Hallo {Name}, wegen {Wunsch}: ruf zurück! ' }).ok);
assert.strictEqual(w.post({ aktion: 'liste', pw }).texte.WA_VORLAGE, 'Hallo {Name}, wegen {Wunsch}: ruf zurück!');
// Weitere Texte (Angebot per WhatsApp und Mail): ohne Pflichtfelder, leer = zurück zum Standard, nur bekannte Schlüssel
assert.ok(w.post({ aktion: 'vorlage', pw, art: 'TEXT_MAIL_BETREFF', text: 'Angebot {Nr}' }).ok);
assert.strictEqual(w.post({ aktion: 'liste', pw }).texte.TEXT_MAIL_BETREFF, 'Angebot {Nr}');
assert.ok(w.post({ aktion: 'vorlage', pw, art: 'TEXT_MAIL_BETREFF', text: '  ' }).ok);
assert.strictEqual(w.props.TEXT_MAIL_BETREFF, undefined);
assert.strictEqual(w.post({ aktion: 'vorlage', pw, art: 'LEXWARE_API_KEY', text: 'x' }).code, 'vorlage');
assert.strictEqual(w.post({ aktion: 'vorlage', pw, art: 'WA_VORLAGE', text: 'ohne Platzhalter' }).code, 'vorlage');

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

// Lexware: ohne Schlüssel eine klare Meldung
assert.match(w.post({ aktion: 'lexArtikel', pw }).fehler, /LEXWARE_API_KEY fehlt/);
assert.strictEqual(w.post({ aktion: 'liste', pw }).lexware, false);
w.props.LEXWARE_API_KEY = ' lex-schluessel ';
r = w.post({ aktion: 'liste', pw });
assert.strictEqual(r.lexware, true);
const annaL = r.leads.find((l) => l.id === anna), benL = r.leads.find((l) => l.id === ben);
assert.strictEqual(annaL.lex, ''); assert.strictEqual(annaL.angebot, null);
assert.strictEqual(JSON.stringify(benL.kunde), '{"email":"ben@example.de","strasse":"","plz":"","ort":"Puderbach"}');   // aus dem Meta-Formular
assert.ok(!benL.antworten.some((x) => /ben@|Puderbach/.test(x[1])));   // steht bei den Kundendaten, nicht bei den Antworten

// Artikel: archivierte weg, sortiert, Endpreis (auch wenn nur netto hinterlegt), Profil nur einmal geholt
r = w.post({ aktion: 'lexArtikel', pw });
assert.ok(r.ok, r.fehler);
assert.strictEqual(r.firma, 'JD Brüder GbR');
assert.strictEqual(JSON.stringify(r.artikel.map((a) => [a.name, a.preis])), '[["Auftragspauschale",58],["Interieur Aufbereitung",226.1],["Politur",200]]');
assert.strictEqual(w.lexware.anfragen[0].auth, 'Bearer lex-schluessel');
w.post({ aktion: 'lexArtikel', pw });
assert.strictEqual(w.lexware.anfragen.filter((x) => x.pfad === '/v1/profile').length, 1);

// Kundendaten: ohne Kontakt aus Meta gelesen; Speichern legt den Kunden an, mit E-Mail und Adresse
r = w.post({ aktion: 'lexDaten', pw, id: ben });
assert.strictEqual(JSON.stringify(r), '{"ok":true,"lex":"","kunde":{"email":"ben@example.de","strasse":"","plz":"","ort":"Puderbach"}}');
assert.strictEqual(w.post({ aktion: 'lexDaten', pw, id: anna, speichern: true, email: 'kaputt' }).code, 'email');
w.lexware.anfragen.length = 0;
r = w.post({ aktion: 'lexDaten', pw, id: anna, speichern: true, email: 'anna@example.de', strasse: 'Hauptstr. 5', plz: '56305', ort: 'Puderbach' });
assert.ok(r.ok, r.fehler);
assert.strictEqual(r.lex, 'K-1');
assert.match(w.lexware.anfragen[0].pfad, /^\/v1\/contacts\?customer=true&size=100&name=Alt$/);   // erst nach Dubletten schauen
let k = w.lexware.anfragen[1].body;
assert.strictEqual(JSON.stringify(k.person), '{"firstName":"Anna","lastName":"Alt"}');
assert.strictEqual(k.phoneNumbers.mobile[0], '0171 1111111');
assert.strictEqual(JSON.stringify(k.emailAddresses), '{"private":["anna@example.de"]}');
assert.strictEqual(JSON.stringify(k.addresses), '{"billing":[{"street":"Hauptstr. 5","zip":"56305","city":"Puderbach","countryCode":"DE"}]}');
assert.strictEqual(w.post({ aktion: 'liste', pw }).leads.find((l) => l.id === anna).lex, 'K-1');
// mit Kontakt: lesen aus Lexware; ändern = lesen + PUT mit Version, bei 409 nochmal
assert.strictEqual(w.post({ aktion: 'lexDaten', pw, id: anna }).kunde.strasse, 'Hauptstr. 5');
w.lexware.anfragen.length = 0;
w.lexware.naechste.push(null, { code: 409, body: { status: 409 } });   // GET normal, PUT trifft eine neuere Version
r = w.post({ aktion: 'lexDaten', pw, id: anna, speichern: true, email: '', strasse: 'Bahnhofstr. 1', plz: '', ort: '' });
assert.ok(r.ok, r.fehler);
assert.strictEqual(w.lexware.anfragen.map((x) => x.methode).join(), 'get,put,get,put');
assert.strictEqual(JSON.stringify(w.lexware.kontakt.addresses.billing[0]), '{"street":"Bahnhofstr. 1","zip":"56305","city":"Puderbach","countryCode":"DE"}');   // leere Felder ändern nichts
assert.strictEqual(w.lexware.kontakt.emailAddresses.private[0], 'anna@example.de');
assert.strictEqual(w.lexware.kontakt.version, 2);   // mit der frisch gelesenen Version geschrieben

// Angebot: nichts gewählt geht nicht, unbekannter Artikel wird gemeldet
assert.strictEqual(w.post({ aktion: 'lexAngebot', pw, id: anna, posten: [{ name: 'X', menge: 0, preis: 5 }] }).code, 'leer');
assert.strictEqual(w.post({ aktion: 'lexAngebot', pw, id: anna, posten: [{ artikel: 'WEG', menge: 1 }] }).code, 'artikel');
// fertiges Angebot mit eurem Steuer-Typ (netto), Artikelpreisen aus Lexware, eigener Position, Rabatt und PDF in Drive
w.lexware.anfragen.length = 0;
w.lexware.naechste.push(null, null, { code: 429 });   // Profil aus dem Cache, Artikel und Kontakt normal, Angebot zu schnell: warten, nochmal
r = w.post({ aktion: 'lexAngebot', pw, wer: 'David', id: anna, rabatt: 20, referenz: true, posten: [
  { artikel: 'A1', menge: 2, preis: 1 },               // Preis aus der App zählt nicht, nur der aus Lexware
  { name: 'Lederpflege', menge: 1, preis: 59.5 }] });
assert.ok(r.ok, r.fehler);
const q = w.lexware.anfragen.filter((x) => x.pfad === '/v1/quotations?finalize=true').pop().body;
assert.strictEqual(w.lexware.anfragen.filter((x) => x.pfad === '/v1/quotations?finalize=true').length, 2);
assert.strictEqual(q.address.contactId, 'K-1');
assert.strictEqual(q.taxConditions.taxType, 'net');
assert.match(q.voucherDate, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}\+01:00$/);
assert.strictEqual(JSON.stringify(q.totalPrice), '{"currency":"EUR","totalDiscountPercentage":20}');
assert.strictEqual(q.introduction, 'Fahrzeug: Audi A6\nAls Referenzkunde erhalten Sie 20 % Rabatt.\nGerne bieten wir Ihnen an:');
assert.match(q.remark, /Auftragserteilung/);
assert.strictEqual(JSON.stringify(q.lineItems[0]), '{"id":"A1","type":"service","name":"Interieur Aufbereitung","quantity":2,"unitName":"Stück","unitPrice":{"currency":"EUR","netAmount":190,"taxRatePercentage":19},"description":"Sitze, Teppich, Himmel"}');
assert.strictEqual(JSON.stringify(q.lineItems[1]), '{"type":"custom","name":"Lederpflege","quantity":1,"unitName":"Pauschal","unitPrice":{"currency":"EUR","netAmount":50,"taxRatePercentage":19}}');
assert.strictEqual(w.lexware.anfragen.find((x) => x.pfad.endsWith('/file')).accept, 'application/pdf');
assert.strictEqual(JSON.stringify(r.angebot), JSON.stringify({ nr: 'AG0049', summe: 409.56, pdf: 'https://datei/Angebot AG0049.pdf', link: 'https://app.lexware.de/permalink/quotations/view/Q-1', datum: r.angebot.datum }));
assert.ok(w.drive.ordner.some((o) => o.dateien.some((d) => d.name === 'Angebot AG0049.pdf')));
assert.strictEqual(r.pdf64, 'JVBERg==');   // das PDF selbst für WhatsApp
assert.strictEqual(JSON.stringify(w.post({ aktion: 'angebotPdf', pw, id: anna })), '{"ok":true,"nr":"AG0049","daten":"JVBERg=="}');
assert.strictEqual(w.post({ aktion: 'angebotPdf', pw, id: ben }).code, 'weg');
assert.match(r.lead.notizen, /David: Angebot AG0049 erstellt \(409,56 €, 20 % Rabatt\): 2× Interieur Aufbereitung, Lederpflege$/);
assert.strictEqual(w.post({ aktion: 'liste', pw }).leads.find((l) => l.id === anna).angebot.nr, 'AG0049');
// PDF klappt nicht: Angebot ist trotzdem da und gemerkt
w.lexware.naechste.push(null, null, null, null, { code: 500 });   // Artikel, Kontakt, Angebot, Nummer normal, PDF kaputt
r = w.post({ aktion: 'lexAngebot', pw, id: anna, posten: [{ artikel: 'A4', menge: 1 }] });
assert.ok(r.ok, r.fehler);
assert.strictEqual(r.angebot.nr, 'AG0049'); assert.strictEqual(r.angebot.pdf, '');

// Kunde ohne Rechnungsadresse (z. B. alt oder verknüpft): vor dem Angebot wird das Land eingetragen, sonst lehnt Lexware ab
delete w.lexware.kontakt.addresses;
w.lexware.anfragen.length = 0;
r = w.post({ aktion: 'lexAngebot', pw, id: anna, posten: [{ artikel: 'A4', menge: 1 }] });
assert.ok(r.ok, r.fehler);
assert.strictEqual(w.lexware.anfragen.map((x) => x.methode + ' ' + x.pfad.split('?')[0]).slice(1, 4).join(), 'get /v1/contacts/K-1,put /v1/contacts/K-1,post /v1/quotations');
assert.strictEqual(JSON.stringify(w.lexware.kontakt.addresses), '{"billing":[{"countryCode":"DE"}]}');
// Lexware-Meldung ohne Detailliste wird mit angezeigt
w.lexware.naechste.push(null, null, { code: 406, body: { status: 406, message: 'Referenced contact needs to have exactly one billing address' } });
assert.strictEqual(w.post({ aktion: 'lexAngebot', pw, id: anna, posten: [{ artikel: 'A4', menge: 1 }] }).fehler, 'Lexware meldet Fehler 406: Referenced contact needs to have exactly one billing address.');

// Neue Anfrage: wird sofort Kunde in Lexware, mit E-Mail aus dem Formular
const vorher = w.lexware.anfragen.filter((x) => x.pfad === '/v1/contacts').length;
w.lead.push(['l:6', new Date().toISOString(), 'Referenzautos', 'ig', 'referenzauto', 'Golf 7', 'Fritz Frisch', 'p:+491716666666', 'CREATED', '', '', 'fritz@example.de', '']);
w.aendern(); w.ctx.meldeNeueLeads();
const neuK = w.lexware.anfragen.filter((x) => x.pfad === '/v1/contacts');
assert.strictEqual(neuK.length, vorher + 1);
const fritzK = neuK.pop().body;
assert.strictEqual(fritzK.emailAddresses.private[0], 'fritz@example.de');
assert.strictEqual(JSON.stringify(fritzK.addresses), '{"billing":[{"countryCode":"DE"}]}');   // ohne Adresse im Formular: wenigstens das Land
assert.ok(w.props['LEX_' + A + '~l:6']);

// Verschickt: Vermerk, Datum am Angebot, Nachfassen in 3 Tagen (Anna ist „Zurückrufen“ ohne Termin)
Object.assign(w.lead.find((z) => z[6] === 'Anna Alt'), { 8: 'Zurückrufen', 10: '' });
r = w.post({ aktion: 'gesendet', pw, wer: 'David', id: anna, weg: 'WhatsApp' });
assert.ok(r.ok, r.fehler);
assert.match(r.lead.notizen, /David: Angebot AG0049 per WhatsApp geschickt$/);
assert.strictEqual(r.nachfassen, r.lead.naechster);
assert.ok(r.nachfassen > new Date().toISOString().slice(0, 10));
assert.ok(JSON.parse(w.props['ANGEBOT_' + anna]).gesendet);
r = w.post({ aktion: 'gesendet', pw, id: anna, weg: 'Mail' });
assert.strictEqual(r.nachfassen, '');                     // Termin steht schon, wird nicht verschoben
assert.strictEqual(w.post({ aktion: 'gesendet', pw, id: ben, weg: 'Mail' }).code, 'weg');   // Ben hat kein Angebot
// Per Mail aus dem Gmail-Konto des Skripts: PDF frisch aus Lexware im Anhang, Vermerk mit Empfänger
assert.strictEqual(w.post({ aktion: 'angebotMail', pw, id: anna, email: 'kaputt' }).code, 'email');
assert.strictEqual(w.post({ aktion: 'angebotMail', pw, id: ben, email: 'ben@example.de' }).code, 'weg');   // kein Angebot
r = w.post({ aktion: 'angebotMail', pw, wer: 'David', id: anna, email: 'anna@example.de' });
assert.ok(r.ok, r.fehler);
const m = w.mails.pop();
assert.strictEqual(JSON.stringify([m.to, m.name, m.subject]), '["anna@example.de","JD Brüder","Dein Angebot AG0049 von JD Brüder"]');
assert.strictEqual(m.attachments[0].name, 'Angebot AG0049.pdf');
assert.match(m.body, /^Hallo Anna,\n\nim Anhang findest du dein Angebot AG0049\.[\s\S]*Viele Grüße\nDavid\nJD Brüder$/);
assert.match(r.lead.notizen, /David: Angebot AG0049 per Mail an anna@example\.de geschickt$/);
// Mit eigenem Text aus dem Setup: die App schickt Betreff und Text fertig mit
assert.ok(w.post({ aktion: 'angebotMail', pw, wer: 'David', id: anna, email: 'anna@example.de', betreff: 'Hier dein Angebot', text: 'Hallo Anna,\nanbei.' }).ok);
assert.strictEqual(JSON.stringify([w.mails.at(-1).subject, w.mails.pop().body]), '["Hier dein Angebot","Hallo Anna,\\nanbei."]');

// Morgens fällig: Angebote zum Nachfassen erkennbar
w.lead.find((z) => z[6] === 'Anna Alt')[10] = new Date('2026-01-02T12:00:00Z');
w.props.PUSH_ABOS = JSON.stringify([abo]); w.drive.weg = []; w.pushes.length = 0;
w.ctx.meldeFaellige();
assert.match(w.pushes[0].body.body, /Anna Alt \(Angebot nachfassen\)/);

// Artikel ausblenden (z. B. Bauleistungen), gilt fürs ganze Team
assert.ok(w.post({ aktion: 'artikelAus', pw, aus: ['A2', 'bös<script>'] }).ok);
assert.strictEqual(w.props.ARTIKEL_AUS, '["A2"]');
assert.strictEqual(JSON.stringify(w.post({ aktion: 'lexArtikel', pw }).artikel.map((a) => [a.id, a.aus])), '[["A4",false],["A1",false],["A2",true]]');

// Dubletten: gleicher Nachname UND gleiche Nummer wird verknüpft, nur gleicher Name nicht
w.lexware.vorhanden.push({ id: 'K-ALT', person: { lastName: 'Frisch' }, phoneNumbers: { mobile: ['0171 3333333'] } });
w.lexware.anfragen.length = 0;
r = w.post({ aktion: 'nachziehen', pw });
assert.ok(r.ok, r.fehler);
assert.strictEqual(JSON.stringify([r.angelegt, r.rest]), '[5,0]');      // Dora, Cora, Ben, Eva, Von Hand
assert.strictEqual(w.props['LEX_' + A + '~l:3'], 'K-ALT');               // Cora Frisch gab es schon (gleiche Nummer)
assert.strictEqual(w.lexware.anfragen.filter((x) => x.pfad === '/v1/contacts').length, 4);   // Cora nicht neu
assert.strictEqual(JSON.stringify(w.post({ aktion: 'nachziehen', pw })), '{"ok":true,"angelegt":0,"rest":0}');

// Fehler von Lexware lesbar, falscher Schlüssel erklärt
w.lexware.naechste.push(null, null, { code: 406, body: { status: 406, details: [{ field: 'lineItems[0].unitPrice', violation: 'NOTNULL' }] } });
assert.strictEqual(w.post({ aktion: 'lexAngebot', pw, id: anna, posten: [{ name: 'X', menge: 1, preis: 5 }] }).fehler, 'Lexware meldet Fehler 406: lineItems[0].unitPrice NOTNULL.');
w.cache.LEX_PROFIL = undefined;
w.lexware.naechste.push({ code: 401, body: { message: 'Unauthorized' } });
assert.match(w.post({ aktion: 'lexArtikel', pw }).fehler, /lehnt den Schlüssel ab/);

// Sperre nach 10 Fehlversuchen
for (let i = 0; i < 10; i++) w.post({ aktion: 'liste', pw: 'falsch' });
assert.match(w.post({ aktion: 'liste', pw }).fehler, /Zu viele Fehlversuche/);

console.log('✓ Alle Tests bestanden');
