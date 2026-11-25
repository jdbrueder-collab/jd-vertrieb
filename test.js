// Test für apps-script/vertrieb.gs ohne Google: Tabellen, Cache und Claude werden nachgebaut.
// Start: node test.js
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const A = 'TABELLE_A_123456789012345', KAPUTT = 'KAPUTT_12345678901234567';

// Kleine Nachbildung einer Tabelle (Zeilen als Array, 1-basiert wie bei Google)
function blatt(rows, name = '') {
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
    setNumberFormat() {},
    setFontWeight() {},
    createTextFinder: (text) => ({
      matchEntireCell() { return this; },
      findNext: () => { for (let i = 0; i < nr; i++) if (String((rows[r - 1 + i] || [])[c - 1]) === text) return { getRow: () => r + i }; return null; },
    }),
  });
  return { rows, getName: () => name, getSheetId: () => 7, getRange: range, getLastRow: () => rows.length, getDataRange: () => range(1, 1, rows.length, breite()), setFrozenRows() {},
    appendRow: (z) => rows.push(z.map((x) => (typeof x === 'string' && x.startsWith("'") ? x.slice(1) : x))) }; // Apostroph = Text, wie in Sheets
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
  // Die Tabelle, in der das Skript liegt: erster Reiter Meta-Leads (nicht verlinkt), dann die Links.
  // Den Reiter „Website-Anfragen“ legt das Anfrageformular beim ersten Mal hinten an.
  const HEIM = 'HEIM_TABELLE_123456789012', web = blatt([], 'Website-Anfragen');
  const reiter = [blatt([['id', 'created_time'], ['l:77', '20.11.2026 10:00']], 'Tabellenblatt1'), heim];
  const aktiv = {
    getId: () => HEIM, getName: () => 'Leads Nov 2026', getUrl: () => 'https://heim', getSheets: () => reiter.slice(),
    getSheetByName: (n) => (n === 'JD Vertrieb' ? heim : n === 'Website-Anfragen' ? reiter.find((r) => r === web) || null
      : n === 'Feedback' && feedback.length ? { appendRow: (r) => feedback.push(r) } : null),
    insertSheet: (n, i) => { if (n !== 'Website-Anfragen') return { appendRow: (r) => feedback.push(r) }; reiter.splice(i, 0, web); return web; },
  };
  const feedback = [], cache = {}, pushes = [], mails = [], drive = { ordner: [], geaendert: 1, weg: [], papierkorb: [] };
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
      { id: 'A2', title: 'Politur', type: 'PRODUCT', unitName: 'Pauschal', price: { netPrice: 168.07, grossPrice: 200, leadingPrice: 'GROSS', taxRate: 19 } },
      { id: 'A1', title: 'Interieur Aufbereitung', type: 'SERVICE', unitName: 'Stück', description: 'Sitze, Teppich, Himmel', price: { netPrice: 190, leadingPrice: 'NET', taxRate: 19 } },
      { id: 'A4', title: 'Auftragspauschale', type: 'PRODUCT', unitName: 'Stück', price: { netPrice: 58, grossPrice: 58, leadingPrice: 'NET', taxRate: 0 } },
      { id: 'A3', title: 'Alt', type: 'PRODUCT', archived: true, price: {} },
      { id: 'A6', title: 'Mahngebühr', type: 'PRODUCT', price: { netPrice: 5, leadingPrice: 'NET', taxRate: 0 } },
      { id: 'A7', title: 'Videoproduktion Werbematerial', type: 'PRODUCT', price: { netPrice: 357, leadingPrice: 'NET', taxRate: 0 } }] };
    else if (pfad.startsWith('/v1/contacts?')) j = { content: lexware.vorhanden.filter((c) => c.person.lastName === decodeURIComponent(pfad.split('name=')[1])) };
    else if (pfad === '/v1/contacts' && o.method === 'post') { lexware.kontakt = Object.assign({}, body, { id: 'K-1', version: 1 }); j = { id: 'K-1', version: 1 }; }
    else if (pfad === '/v1/contacts/K-1' && o.method === 'get') j = JSON.parse(JSON.stringify(lexware.kontakt));
    else if (pfad === '/v1/contacts/K-1' && o.method === 'put') { lexware.kontakt = Object.assign(body, { version: body.version + 1 }); j = { id: 'K-1' }; }
    else if (pfad.startsWith('/v1/contacts/')) {   // schon vorhandene Kunden
      const c = lexware.vorhanden.find((x) => x.id === pfad.split('/').pop());
      if (c && o.method === 'put') Object.assign(c, body);
      j = c ? JSON.parse(JSON.stringify(c)) : null;
    }
    else if (pfad.startsWith('/v1/voucherlist?voucherType=invoice')) j = { last: true, content: (lexware.rechnungen || []).filter((v) => !pfad.includes('updatedDateFrom') || v.voucherStatus === 'paid') };
    else if (pfad.startsWith('/v1/voucherlist?')) j = { last: true, content: (lexware.angebote || []).filter((v) => !pfad.includes('contactId=') || pfad.includes('contactId=' + v.contactId)) };
    else if (pfad === '/v1/quotations?finalize=true') j = { id: 'Q-1', version: 1 };
    else if (pfad === '/v1/quotations/Q-1') j = Object.assign({ id: 'Q-1', version: 1, voucherNumber: 'AG0049', voucherStatus: 'open', totalPrice: { totalGrossAmount: 409.56 } }, lexware.angebot);   // angebot: in Lexware bearbeitet
    else if (/^\/v1\/(invoices|quotations)\/[^/]+$/.test(pfad)) j = (lexware.positionen || {})[pfad.split('/').pop()] || { lineItems: [] };   // Positionen eines Belegs
    else if (pfad === '/v1/quotations/Q-1/file') return { getResponseCode: () => 200, getBlob: () => ({ bytes: '%PDF', getBytes: () => [37, 80, 68, 70], setName(n) { this.name = n; return this; } }) };
    return { getResponseCode: () => j ? 200 : 404, getContentText: () => JSON.stringify(j || {}) };
  };

  let claudeBody = null, metaAntwort = null;
  const metaUrls = [];
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
      getActiveSpreadsheet: () => aktiv,
      openById: (id) => {
        if (id === HEIM) return aktiv;
        if (id !== A) throw new Error('Datei nicht gefunden');
        return { getSheets: () => [blatt([['Nur ein Hinweis']]), lead], getName: () => 'Leads November 2026', getUrl: () => 'https://a' }; // ohne Zeitzone, wie die echte Tabelle
      },
    },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props[k] ?? null, setProperty: (k, v) => { props[k] = v; }, setProperties: (o) => Object.assign(props, o), deleteProperty: (k) => { delete props[k]; }, getProperties: () => ({ ...props }) }) },
    DriveApp: {
      Access: { ANYONE_WITH_LINK: 'jeder' }, Permission: { VIEW: 'ansehen' },
      getFileById: (id) => ({ getLastUpdated: () => new Date(drive.geaendert), setTrashed: (j) => { if (j) drive.papierkorb.push(id); } }),
      createFolder: (n) => ordner(n), getFolderById: (id) => drive.ordner.find((o) => o.id === id), getRootFolder: () => ({}),
    },
    CacheService: { getScriptCache: () => ({ get: (k) => cache[k], put: (k, v) => { cache[k] = v; } }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    Utilities: {
      getUuid: () => 'abcdef12-0000',
      newBlob: (bytes, typ, name) => ({ bytes, typ, name }),
      base64Decode: (t) => Array.from(Buffer.from(t, 'base64')), base64Encode: (b) => Buffer.from(b).toString('base64'),
      formatDate: (d, tz, f) => f === 'yyyy-MM-dd-HH-mm-ss' ? d.toISOString().slice(0, 19).replace(/[T:]/g, '-') : f === 'dd.MM.yy HH:mm' ? '20.11.26 14:03' : f.endsWith('XXX') ? d.toISOString().slice(0, 23) + '+01:00' : f === 'yyyy-MM-dd' ? d.toISOString().slice(0, 10) : f.startsWith('yyyy') ? d.toISOString().slice(0, 19) : 'Freitag',
      sleep: () => {},
    },
    MailApp: { sendEmail: (m) => mails.push(m), getRemainingDailyQuota: () => 100 },
    ContentService: { createTextOutput: (t) => ({ t, setMimeType() { return this; } }), MimeType: { JSON: 'json' } },
    UrlFetchApp: { fetch: (url, o) => {
      if (url.startsWith('https://api.lexware.io')) return lexAntwort(url, o);
      if (url.startsWith('https://graph.facebook.com')) {   // Meta: Werbekonten und Insights
        metaUrls.push(url);
        const j = metaAntwort ? metaAntwort(url) : url.includes('/me/adaccounts') ? { data: [{ id: 'act_1', account_status: 2 }, { id: 'act_7', account_status: 1 }] }
          : { data: [{ spend: '312.45', impressions: '40210', clicks: '812', account_currency: 'EUR' }] };
        return { getResponseCode: () => (j.error ? 400 : 200), getContentText: () => JSON.stringify(j) };
      }
      if (url.includes('workers.dev')) {
        pushes.push({ url, headers: o.headers, body: JSON.parse(o.payload) });
        return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ weg: drive.weg }) };
      }
      claudeBody = { url, headers: o.headers, body: JSON.parse(o.payload) };
      const antwort = { stichpunkte: ['Will Komplettpaket', 'Ruft\n\nnach Rücksprache zurück'], naechster_schritt: 'Freitag zurückrufen', status: 'Nicht erreicht', naechster_kontakt: '2026-11-27' };
      return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: JSON.stringify(antwort) }] }) };
    } },
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(__dirname + '/apps-script/vertrieb.gs', 'utf8'), ctx);
  const post = (d) => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(d) } }).t);
  return { post, ctx, lexware, metaUrls, metaFalsch: (f) => { metaAntwort = f; }, mails, props, pushes, drive, aendern: () => drive.geaendert++, lead: lead.rows, heim: heim.rows, web: web.rows, feedback, cache, claude: () => claudeBody };
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
assert.strictEqual(a.status, 'Nicht erreicht');          // alter Status „Zurückrufen“ heißt jetzt so
assert.strictEqual(a.telefon, '0171 1111111');           // ohne "p:"
assert.strictEqual(a.wa, 'https://wa.me/491711111111');
assert.strictEqual(a.quelle, 'Instagram');
assert.strictEqual(JSON.stringify(a.antworten), '[["Interesse","Referenzauto"],["Fahrzeug","Audi A6"]]');
assert.strictEqual(r.leads[1].datum, new Date(Math.round(20777.5 * 864e5)).toISOString().slice(0, 19)); // Tabellen-Zahl
assert.strictEqual(r.leads[3].status, 'Nicht erreicht');   // alter Status „Offen“
assert.strictEqual(a.datum, '2026-11-19T09:00:00');        // aus der Anzeige, ohne Zeitzone der Tabelle
assert.match(w.lead[4][0], /^manuell-abcdef12$/);         // von Hand eingetragener Lead bekommt eine id
assert.strictEqual(w.heim[1][1], 'Leads November 2026');  // Name landet in Spalte B
assert.strictEqual(r.tabellen[0].anzahl, 4);
assert.match(r.tabellen[1].fehler, /Kein Zugriff/);
assert.strictEqual(r.heimUrl, 'https://heim');

// Meta schiebt zwischendurch noch einen Lead nach oben: gespeichert wird trotzdem beim richtigen Lead
w.lead.unshift(['l:4', '', '', '', '', '', 'Dora Dazwischen', 'p:+491715555555', 'CREATED', '', '']);
assert.strictEqual(w.post({ aktion: 'speichern', pw, id: anna, status: 'Zurückrufen' }).code, 'status');   // alte Status gibt es nicht mehr
r = w.post({ aktion: 'speichern', pw, wer: 'David', id: anna, status: 'Termin', naechster: '2026-11-25', notiz: 'Erster Anruf' });
assert.ok(r.ok, r.fehler);
const zeileAnna = w.lead.find((z) => z[6] === 'Anna Alt');
assert.strictEqual(zeileAnna[8], 'Termin');
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
assert.strictEqual(JSON.stringify(r.vorschlag), '{"status":"Nicht erreicht","naechster":"2026-11-27"}');

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

// Artikel: nur Produkte (Service ist in Lexware Bau und Kleinkram), ohne Mahngebühr und Videoproduktion, archivierte weg, sortiert, Endpreis (auch wenn nur netto hinterlegt), Profil nur einmal geholt
r = w.post({ aktion: 'lexArtikel', pw });
assert.ok(r.ok, r.fehler);
assert.strictEqual(r.firma, 'JD Brüder GbR');
assert.strictEqual(JSON.stringify(r.artikel.map((a) => [a.name, a.preis])), '[["Auftragspauschale",58],["Politur",200]]');
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
assert.strictEqual(w.lexware.kontakt.version, 3);   // mit der frisch gelesenen Version geschrieben

// Angebot: nichts gewählt geht nicht, unbekannter Artikel wird gemeldet
assert.strictEqual(w.post({ aktion: 'lexAngebot', pw, id: anna, posten: [{ name: 'X', menge: 0, preis: 5 }] }).code, 'leer');
assert.strictEqual(w.post({ aktion: 'lexAngebot', pw, id: anna, posten: [{ artikel: 'WEG', menge: 1 }] }).code, 'artikel');
// fertiges Angebot mit eurem Steuer-Typ (netto), Artikelpreisen aus Lexware, eigener Position, Rabatt und PDF in Drive
w.lexware.anfragen.length = 0;
w.lexware.naechste.push(null, null, { code: 429 });   // Profil aus dem Cache, Artikel und Kontakt normal, Angebot zu schnell: warten, nochmal
r = w.post({ aktion: 'lexAngebot', pw, wer: 'David', id: anna, rabatt: 20, referenz: true, posten: [
  { artikel: 'A1', menge: 2 },                         // ohne eigenen Preis gilt der aus Lexware (geänderter Preis: Test weiter unten)
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
assert.strictEqual(JSON.stringify(r.angebot), JSON.stringify({ nr: 'AG0049', summe: 409.56, pdf: 'https://datei/Angebot AG0049.pdf', link: 'https://app.lexware.de/permalink/quotations/view/Q-1', datum: r.angebot.datum, version: 1 }));
assert.ok(w.drive.ordner.some((o) => o.dateien.some((d) => d.name === 'Angebot AG0049.pdf')));
assert.strictEqual(r.pdf64, 'JVBERg==');   // das PDF selbst für WhatsApp
let pdf = w.post({ aktion: 'angebotPdf', pw, id: anna });
assert.strictEqual(pdf.daten, 'JVBERg=='); assert.strictEqual(pdf.angebot.summe, 409.56); assert.strictEqual(pdf.angebot.geaendert, undefined);
// In Lexware bearbeitet (neue Version, neue Summe): App bekommt die neue Fassung, die alte Kopie im Drive fliegt in den Papierkorb
const dateienVorher = w.drive.ordner.reduce((n, o) => n + o.dateien.length, 0);
w.props['ANGEBOT_' + anna] = JSON.stringify(Object.assign(pdf.angebot, { pdf: 'https://drive.google.com/file/d/ALT-1/view?usp=drivesdk' }));
w.lexware.angebot = { version: 3, updatedDate: '2026-11-23T10:00:00.000+01:00', totalPrice: { totalGrossAmount: 499 } };
pdf = w.post({ aktion: 'angebotPdf', pw, id: anna });
assert.strictEqual(pdf.angebot.summe, 499); assert.strictEqual(pdf.angebot.version, 3); assert.strictEqual(pdf.angebot.geaendert, '2026-11-23');
assert.strictEqual(pdf.angebot.pdf, 'https://datei/Angebot AG0049.pdf');
assert.strictEqual(w.drive.ordner.reduce((n, o) => n + o.dateien.length, 0), dateienVorher + 1);
assert.strictEqual(w.drive.papierkorb.join(), 'ALT-1');
assert.strictEqual(w.post({ aktion: 'liste', pw }).leads.find((l) => l.id === anna).angebot.summe, 499);
w.post({ aktion: 'angebotPdf', pw, id: anna });   // unverändert: keine weitere Kopie
assert.strictEqual(w.drive.ordner.reduce((n, o) => n + o.dateien.length, 0), dateienVorher + 1);
delete w.lexware.angebot;
// Beim Öffnen gilt, was in Lexware steht: Name, Telefon, neuestes Angebot mit Status
w.lexware.kontakt.person = { firstName: 'Anna', lastName: 'Alt-Neumann' };
w.lexware.kontakt.phoneNumbers = { mobile: ['0171 9999999'] };
w.lexware.angebote = [{ id: 'Q-1', contactId: 'K-1', voucherNumber: 'AG0049', voucherStatus: 'accepted', totalAmount: 499, voucherDate: '2026-11-20T00:00:00.000+01:00' }];
let daten = w.post({ aktion: 'lexDaten', pw, id: anna });
assert.strictEqual(daten.name, 'Anna Alt-Neumann'); assert.strictEqual(daten.telefon, '0171 9999999'); assert.strictEqual(daten.wa, 'https://wa.me/491719999999');
assert.strictEqual(daten.angebot.nr, 'AG0049'); assert.strictEqual(daten.angebot.status, 'accepted'); assert.strictEqual(daten.angebot.gesendet, undefined);
let annaListe = w.post({ aktion: 'liste', pw }).leads.find((l) => l.id === anna);
assert.strictEqual(annaListe.name, 'Anna Alt-Neumann'); assert.strictEqual(annaListe.telefon, '0171 9999999'); assert.strictEqual(annaListe.angebot.status, 'accepted');
// Neues Angebot direkt in Lexware angelegt: die App zeigt ab jetzt dieses
w.lexware.angebote = [{ id: 'Q-9', contactId: 'K-1', voucherNumber: 'AG0060', voucherStatus: 'open', totalAmount: 120.5, voucherDate: '2026-11-23T00:00:00.000+01:00' }];
daten = w.post({ aktion: 'lexDaten', pw, id: anna });
assert.strictEqual(JSON.stringify(daten.angebot), '{"nr":"AG0060","summe":120.5,"pdf":"","link":"https://app.lexware.de/permalink/quotations/view/Q-9","datum":"2026-11-23","status":"open"}');
assert.strictEqual(w.post({ aktion: 'liste', pw }).leads.find((l) => l.id === anna).angebot.nr, 'AG0060');
// zurück auf Q-1 für die Tests danach
w.lexware.angebote = [{ id: 'Q-1', contactId: 'K-1', voucherNumber: 'AG0049', voucherStatus: 'open', totalAmount: 409.56, voucherDate: '2026-11-20T00:00:00.000+01:00' }];
w.post({ aktion: 'lexDaten', pw, id: anna });
// Preis im Angebot geändert (größeres Auto): gilt nur für diese Position, Artikel-id bleibt, netto genau auf 4 Stellen
{
  const n0 = w.lexware.anfragen.length;
  const r3 = w.post({ aktion: 'lexAngebot', pw, id: anna, posten: [{ artikel: 'A1', menge: 1, preis: 300 }, { artikel: 'A4', menge: 1 }] });
  assert.ok(r3.ok, r3.fehler);
  const q3 = w.lexware.anfragen.slice(n0).filter((x) => x.pfad === '/v1/quotations?finalize=true').pop().body;
  assert.strictEqual(JSON.stringify(q3.lineItems[0].unitPrice), '{"currency":"EUR","netAmount":252.1008,"taxRatePercentage":19}');
  assert.strictEqual(q3.lineItems[0].id, 'A1');
  assert.strictEqual(q3.lineItems[1].unitPrice.netAmount, 58);   // ohne eigenen Preis: wie in Lexware
  assert.strictEqual(w.post({ aktion: 'lexAngebot', pw, id: anna, posten: [{ artikel: 'A1', menge: 1, preis: -5 }] }).code, 'preis');
}
// Angebot in der App ändern: Positionen und Rabatt aus Lexware laden, neue Fassung ersetzt die alte
w.lexware.angebot = { introduction: 'Fahrzeug: Audi A6\nAls Referenzkunde erhalten Sie 20 % Rabatt.', totalPrice: { totalDiscountPercentage: 20, totalGrossAmount: 409.56 }, lineItems: [
  { id: 'A1', type: 'service', name: 'Interieur Aufbereitung', quantity: 2, unitPrice: { netAmount: 190, grossAmount: 226.1, taxRatePercentage: 19 } },
  { type: 'custom', name: 'Lederpflege', quantity: 1, unitPrice: { netAmount: 50, taxRatePercentage: 19 } },
  { type: 'text', name: 'Hinweis' }] };
const vorlage = w.post({ aktion: 'angebotLaden', pw, id: anna });
assert.ok(vorlage.ok, vorlage.fehler);
assert.strictEqual(JSON.stringify(vorlage.posten), '[{"artikel":"A1","name":"Interieur Aufbereitung","menge":2,"preis":226.1},{"artikel":"","name":"Lederpflege","menge":1,"preis":59.5}]');
assert.strictEqual(vorlage.rabatt, 20); assert.strictEqual(vorlage.referenz, true); assert.strictEqual(vorlage.nr, 'AG0049');
delete w.lexware.angebot;
assert.strictEqual(w.post({ aktion: 'angebotLaden', pw, id: ben }).code, 'weg');
const fassung = w.post({ aktion: 'lexAngebot', pw, wer: 'David', id: anna, ersetzt: true, rabatt: 20, referenz: true, posten: [{ artikel: 'A1', menge: 1 }, { name: 'Lederpflege', menge: 1, preis: 59.5 }] });
assert.ok(fassung.ok, fassung.fehler);
assert.strictEqual(JSON.stringify(fassung.angebot.ersetzt), '["Q-1"]');
assert.match(fassung.lead.notizen, /David: Angebot AG0049 erstellt \(ersetzt AG0049, /);
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

// Verschickt: Vermerk, Status „Angebot abgeschickt“, Datum am Angebot, Nachfassen in 3 Tagen (Anna steht noch auf altem „Zurückrufen“ ohne Termin)
Object.assign(w.lead.find((z) => z[6] === 'Anna Alt'), { 8: 'Zurückrufen', 10: '' });
r = w.post({ aktion: 'gesendet', pw, wer: 'David', id: anna, weg: 'WhatsApp' });
assert.ok(r.ok, r.fehler);
assert.match(r.lead.notizen, /David: Angebot AG0049 per WhatsApp geschickt$/);
assert.strictEqual(r.lead.status, 'Angebot abgeschickt');
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
assert.match(w.pushes[0].body.body, /Anna Alt-Neumann \(Angebot nachfassen\)/);

// Artikel ausblenden (z. B. Bauleistungen), gilt fürs ganze Team
assert.ok(w.post({ aktion: 'artikelAus', pw, aus: ['A2', 'bös<script>'] }).ok);
assert.strictEqual(w.props.ARTIKEL_AUS, '["A2"]');
assert.strictEqual(JSON.stringify(w.post({ aktion: 'lexArtikel', pw }).artikel.map((a) => [a.id, a.aus])), '[["A4",false],["A2",true]]');

// Dubletten: gleicher Nachname UND gleiche Nummer wird verknüpft, nur gleicher Name nicht
w.lexware.vorhanden.push({ id: 'K-ALT', version: 4, person: { lastName: 'Frisch' }, phoneNumbers: { mobile: ['0171 3333333'] } });
// Kundendaten bei einem Lead, den es in Lexware schon gibt: verknüpfen UND Mail und Adresse dort eintragen
r = w.post({ aktion: 'lexDaten', pw, id: A + '~l:3', speichern: true, email: 'cora@example.de', strasse: 'Weg 2', plz: '56305', ort: 'Puderbach' });
assert.ok(r.ok, r.fehler);
assert.strictEqual(r.lex, 'K-ALT');
const coraK = w.lexware.vorhanden.find((c) => c.id === 'K-ALT');
assert.strictEqual(coraK.emailAddresses.private[0], 'cora@example.de');
assert.strictEqual(coraK.addresses.billing[0].street, 'Weg 2');
w.lexware.anfragen.length = 0;
r = w.post({ aktion: 'nachziehen', pw });
assert.ok(r.ok, r.fehler);
assert.strictEqual(JSON.stringify([r.angelegt, r.rest]), '[4,0]');      // Dora, Ben, Eva, Von Hand (Cora ist schon verknüpft)
assert.strictEqual(w.props['LEX_' + A + '~l:3'], 'K-ALT');               // Cora Frisch gab es schon (gleiche Nummer)
assert.strictEqual(w.lexware.anfragen.filter((x) => x.pfad === '/v1/contacts').length, 4);   // Cora nicht neu
assert.strictEqual(JSON.stringify(w.post({ aktion: 'nachziehen', pw })), '{"ok":true,"angelegt":0,"rest":0}');

// Fehler von Lexware lesbar, falscher Schlüssel erklärt
w.lexware.naechste.push(null, null, { code: 406, body: { status: 406, details: [{ field: 'lineItems[0].unitPrice', violation: 'NOTNULL' }] } });
assert.strictEqual(w.post({ aktion: 'lexAngebot', pw, id: anna, posten: [{ name: 'X', menge: 1, preis: 5 }] }).fehler, 'Lexware meldet Fehler 406: lineItems[0].unitPrice NOTNULL.');
w.cache.LEX_PROFIL = undefined;
w.lexware.naechste.push({ code: 401, body: { message: 'Unauthorized' } });
assert.match(w.post({ aktion: 'lexArtikel', pw }).fehler, /lehnt den Schlüssel ab/);

// Anfrageformular der Website: ohne Passwort, landet im Reiter „Website-Anfragen“ der eigenen Tabelle, dann ein Lead wie von Meta
const eva = { aktion: 'anfrage', interesse: 'aufbereitung', fahrzeug: 'VW Golf 8', name: 'Eva Web', telefon: '0171 6666666', email: 'eva@example.de' };
assert.strictEqual(w.post({ ...eva, email: 'kaputt' }).code, 'eingabe');
assert.strictEqual(w.post({ ...eva, interesse: 'quatsch' }).code, 'eingabe');
assert.ok(w.post({ ...eva, web: 'bot' }).ok);              // Bot-Falle: angenommen, aber nichts gespeichert
assert.strictEqual(w.web.length, 0);
assert.strictEqual(w.post({ aktion: 'liste', pw }).tabellen.length, 2); // ohne Anfragen kein Website-Reiter
w.post({ aktion: 'push', pw, abo });
w.ctx.meldeNeueLeads();
r = w.post({ ...eva, name: '=HYPERLINK("x")' });
assert.ok(r.ok, r.fehler);
assert.strictEqual(w.web[0].join(), 'id,created_time,platform,interesse,fahrzeug,full_name,phone_number,email,lead_status,Notiz,Termin');
assert.strictEqual(typeof w.web[1][1], 'number');          // Tabellen-Zahl in deutscher Zeit, wie im Sortier-Skript
w.web[1][0] = 'web-erster01';                               // Nachbildung vergibt sonst zweimal dieselbe id
assert.ok(w.post(eva).ok);
assert.strictEqual(w.web.length, 3);                       // Reiter nur einmal angelegt
assert.strictEqual(w.heim.length, 3);                      // nichts im Reiter „JD Vertrieb“ eingetragen
r = w.post({ aktion: 'liste', pw });
const webTab = r.tabellen.find((t) => t.name === 'Website-Anfragen');
assert.strictEqual(webTab.anzahl, 2);
assert.strictEqual(webTab.url, 'https://heim#gid=7');
assert.ok(r.leads.some((x) => x.tabelle === 'Leads November 2026')); // Meta-Leads weiter dabei
assert.ok(!r.leads.some((x) => x.name === '' && x.telefon === '')); // Kopfzeile ist kein Lead
const l = r.leads.find((x) => x.name === 'Eva Web');
assert.match(l.id, /^HEIM_TABELLE_123456789012#web~web-/);
assert.strictEqual(l.tabelle, 'Website-Anfragen');
assert.strictEqual(l.datum.length, 19);
assert.strictEqual(JSON.stringify(l.antworten), '[["Interesse","Aufbereitung"],["Fahrzeug","VW Golf 8"]]');
assert.strictEqual(l.kunde.email, 'eva@example.de');
assert.strictEqual(l.telefon, '0171 6666666');
assert.strictEqual(l.wa, 'https://wa.me/491716666666');
assert.strictEqual(l.quelle, 'Website');
assert.strictEqual(l.status, 'Neu');
assert.ok(r.leads.some((x) => x.name === '=HYPERLINK("x")'));  // als Text gespeichert, nicht als Formel
// Status, Termin und Notiz landen in der Zeile im Website-Reiter
r = w.post({ aktion: 'speichern', pw, wer: 'David', id: l.id, status: 'Nicht erreicht', naechster: '2026-11-26', notiz: 'Ruft morgen zurück' });
assert.ok(r.ok, r.fehler);
const zeileEva = w.web.find((z) => z[5] === 'Eva Web');
assert.strictEqual(zeileEva[8], 'Nicht erreicht');
assert.ok(zeileEva[10] instanceof Date);
assert.match(zeileEva[9], /David: Ruft morgen zurück$/);
// Neue Website-Anfragen melden sich per Push wie Meta-Leads
w.aendern();
w.ctx.meldeNeueLeads();
assert.ok(w.pushes.some((p) => /neue Leads|neuer Lead/i.test(p.body.title) && /Eva Web/.test(p.body.title + p.body.body)), JSON.stringify(w.pushes.at(-1).body));
w.cache.anfragen = '30';
assert.strictEqual(w.post(eva).code, 'viel');             // höchstens 30 Anfragen pro Stunde

// Statistik: Meta-Ausgaben und Angebotswerte aus Lexware, jedes Teil darf einzeln scheitern
w.lexware.angebote = [
  { id: 'S1', contactId: 'K-1', voucherStatus: 'open', totalAmount: 100.10, voucherDate: '2026-11-03T00:00:00.000+01:00' },
  { id: 'S4', contactId: 'K-4', voucherStatus: 'rejected', totalAmount: 80, voucherDate: '2026-11-05T00:00:00.000+01:00' },
  { id: 'Q-1', contactId: 'K-1', voucherStatus: 'open', totalAmount: 409.56, voucherDate: '2026-11-05T00:00:00.000+01:00' }];   // alte Fassung, in der App ersetzt
w.lexware.positionen = { 'S4-quote': { lineItems: [{ name: 'Lackaufbereitung One-Step-Politur' }] }, 'R2-rechn': { lineItems: [{ name: 'Teilfolierung Dach' }] },
  'R3-rechn': { lineItems: [{ name: 'Montage von Überdachungen' }] } };
w.lexware.angebote[1].id = 'S4-quote';
w.lexware.rechnungen = [
  { id: 'R1', voucherNumber: 'RE1', contactId: 'K-1', contactName: 'Anna Alt', voucherStatus: 'paid', totalAmount: 500, openAmount: 0, voucherDate: '2026-11-02T00:00:00.000+01:00', updatedDate: '2026-11-10T09:00:00.000+01:00' },
  { id: 'R2-rechn', voucherNumber: 'RE2', contactId: 'K-9', contactName: 'Firma X', voucherStatus: 'overdue', totalAmount: 300, openAmount: 300, voucherDate: '2026-11-04T00:00:00.000+01:00', updatedDate: '2026-11-04T00:00:00.000+01:00' },
  { id: 'R3-rechn', voucherNumber: 'RE3', contactId: 'K-8', contactName: 'Mostafa, Majed', voucherStatus: 'paid', totalAmount: 9000, openAmount: 0, voucherDate: '2026-11-06T00:00:00.000+01:00', updatedDate: '2026-11-08T00:00:00.000+01:00' },
  { id: 'R4-rechn', voucherNumber: 'RE4', contactId: 'K-7', contactName: 'meta Trennwandanlagen GmbH & Co. KG', voucherStatus: 'paid', totalAmount: 20000, openAmount: 0, voucherDate: '2026-11-06T00:00:00.000+01:00', updatedDate: '2026-11-08T00:00:00.000+01:00' }];
w.lexware.anfragen.length = 0;
r = w.post({ aktion: 'statistik', pw, von: '2026-11-01', bis: '2026-11-24' });
assert.ok(r.ok, r.fehler);
assert.match(r.meta.fehler, /META_TOKEN fehlt/);
assert.strictEqual(JSON.stringify(r.angebote[0]), '{"id":"S1","nr":"","k":"K-1","name":"","s":"open","b":100.1,"d":"2026-11-03"}');
assert.strictEqual(r.angebote.length, 2);   // S1 (Kunde aus der App) und S4 (Lackaufbereitung)
assert.strictEqual(JSON.stringify(r.rechnungen[0]), '{"id":"R1","nr":"RE1","k":"K-1","name":"Anna Alt","s":"paid","b":500,"o":0,"d":"2026-11-02","u":"2026-11-10"}');
assert.strictEqual(r.rechnungen.map((x) => x.nr).join(), 'RE1,RE2');   // ohne Überdachung und Meta Trennwand; RE1 kommt zweimal, zählt einmal
assert.strictEqual(w.props.FZ_BELEGE, '{"S4-quote":1,"R2-rechn":1,"R3-rechn":0}');   // Meta Trennwand und App-Kunden ohne Anfrage
const belege = w.lexware.anfragen.map((x) => x.pfad);
assert.ok(!belege.includes('/v1/invoices/R4-rechn') && !belege.includes('/v1/invoices/R1'));
assert.ok(belege.some((x) => /voucherType=quotation&voucherStatus=open,accepted,rejected&voucherDateFrom=2026-11-01&voucherDateTo=2026-11-24&size=250&page=0$/.test(x)));
assert.ok(belege.some((x) => /voucherType=invoice&voucherStatus=open,paid,paidoff,voided&voucherDateFrom=2026-11-01&voucherDateTo=2026-11-24&size=250&page=0$/.test(x)));
assert.ok(belege.some((x) => /voucherType=invoice&voucherStatus=paid&updatedDateFrom=2026-11-01&size=250&page=0$/.test(x)));
w.props.META_TOKEN = 'meta-schluessel';
r = w.post({ aktion: 'statistik', pw, von: '2026-11-01', bis: '2026-11-24' });
assert.strictEqual(JSON.stringify(r.meta), '{"ausgaben":312.45,"impressionen":40210,"klicks":812,"waehrung":"EUR"}');
assert.match(w.metaUrls.pop(), /^https:\/\/graph\.facebook\.com\/v24\.0\/act_1240466211369292\/insights\?fields=spend,impressions,clicks,account_currency&time_range=%7B%22since%22%3A%222026-11-01%22%2C%22until%22%3A%222026-11-24%22%7D&access_token=meta-schluessel$/);
const anzahlMeta = w.metaUrls.length;
assert.strictEqual(w.post({ aktion: 'statistik', pw, von: '2026-11-01', bis: '2026-11-24' }).meta.ausgaben, 312.45);
assert.strictEqual(w.metaUrls.length, anzahlMeta);   // 5 Minuten aus dem Cache
w.post({ aktion: 'statistik', pw, von: '', bis: '2026-11-24' });
assert.match(w.metaUrls.pop(), /date_preset=maximum/);   // Alles
w.metaFalsch(() => ({ error: { code: 190, message: 'Session has expired' } }));
assert.match(w.post({ aktion: 'statistik', pw, von: '2026-10-01', bis: '2026-10-31' }).meta.fehler, /abgelaufen oder ungültig/);
w.metaFalsch(null);
// Meta-Schlüssel über die App: erst prüfen, dann speichern
assert.strictEqual(w.post({ aktion: 'metaVerbinden', pw, token: 'kurz' }).code, 'meta');
w.metaFalsch(() => ({ error: { code: 190, message: 'Invalid OAuth access token' } }));
assert.match(w.post({ aktion: 'metaVerbinden', pw, token: 'EAA' + 'x'.repeat(80) }).fehler, /abgelaufen oder ungültig/);
assert.strictEqual(w.props.META_TOKEN, 'meta-schluessel');   // alter bleibt
w.metaFalsch((url) => ({ id: 'act_1240466211369292', name: 'JD Brüder', account_status: 1 }));
r = w.post({ aktion: 'metaVerbinden', pw, token: ' EAA' + 'y'.repeat(80) + ' ' });
assert.ok(r.ok, r.fehler); assert.strictEqual(r.konto, 'JD Brüder');
assert.strictEqual(w.props.META_TOKEN, 'EAA' + 'y'.repeat(80));
assert.match(w.metaUrls.pop(), /\/v24\.0\/act_1240466211369292\?fields=name,account_status&access_token=EAAy+$/);
assert.strictEqual(w.post({ aktion: 'liste', pw }).meta, true);
w.metaFalsch(null);

// Sortier-Skript der Lead-Tabelle: alte Status werden umgeschrieben statt gelöscht, Farben passen zu den neuen
{
  const sx = { console, Date, Math, String, Number, Object, Array, Set, JSON };
  vm.createContext(sx);
  vm.runInContext(fs.readFileSync(__dirname + '/apps-script/sortieren.gs', 'utf8'), sx);
  const werte = [['id', 'created_time', 'full_name', 'lead_status', 'Notiz'], ['1', '', 'A', 'Zurückrufen', ''], ['2', '', 'B', 'Terminiert', ''],
    ['3', '', 'C', 'Auftrag', ''], ['4', '', 'D', 'Offen', ''], ['5', '', 'E', 'Angebot abgeschickt', ''], ['6', '', 'F', 'CREATED', '']];
  const sortiert = sx.bereinigeLeads_(werte);
  assert.strictEqual(sortiert.werte.slice(1).map((z) => z[3]).join(), 'Nicht erreicht,Termin,Termin,Nicht erreicht,Angebot abgeschickt,');
  assert.strictEqual(['Termin', 'Angebot abgeschickt', 'Nicht erreicht', 'Unqualifiziert', ''].map((x) => sx.farbeFuerStatus_(x)).join(), '#93c47d,#9fc5e8,#ffd966,#e06666,#ffffff');
}

// Notiz ohne Verbindung geschrieben und später nachgeschickt: mit Kennung nur einmal im Verlauf, auch wenn sie doppelt ankommt
{
  const vorher = w.post({ aktion: 'liste', pw }).leads.find((l) => l.id === anna).notizen;
  const n = { aktion: 'speichern', pw, wer: 'David', id: anna, notiz: 'Offline geschrieben: will Keramik', zeit: new Date(Date.now() - 36e5).toISOString(), nid: 'abc123' };
  assert.ok(w.post(n).ok);
  const r2 = w.post(n);   // Antwort ging verloren, App schickt nochmal
  assert.ok(r2.ok);
  assert.strictEqual(r2.lead.notizen.split('Offline geschrieben: will Keramik').length - 1, 1);
  assert.ok(r2.lead.notizen.startsWith(vorher));
  assert.ok(w.post({ ...n, nid: 'neu456', zeit: 'Quatsch' }).ok);   // kaputte Zeit: dann eben jetzt
}

// Sperre nach 10 Fehlversuchen
for (let i = 0; i < 10; i++) w.post({ aktion: 'liste', pw: 'falsch' });
assert.match(w.post({ aktion: 'liste', pw }).fehler, /Zu viele Fehlversuche/);

console.log('✓ Alle Tests bestanden');
