// Prüft das Aufräumen der Meta-Reste. Aufruf: node sortieren.test.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Nachbau von Utilities.formatDate, nur für das Format, das berlinSerial_ nutzt
const ctx = {
  Utilities: {
    formatDate(datum, tz) {
      const teile = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
        timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
      }).formatToParts(datum).map(p => [p.type, p.value]));
      return `${teile.year}-${teile.month}-${teile.day}-${teile.hour}-${teile.minute}-${teile.second}`;
    },
  },
};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, 'apps-script', 'sortieren.gs'), 'utf8') +
  '\n;this.bereinigeLeads_ = bereinigeLeads_; this.spalten_ = spalten_; this.berlinSerial_ = berlinSerial_;', ctx);

const BREITE = 35; // A..AI wie im echten Sheet
const pad = arr => arr.concat(new Array(BREITE - arr.length).fill(''));
const HEADER = ['id', 'created_time', 'ad_id', 'ad_name', 'adset_id', 'adset_name', 'campaign_id',
  'campaign_name', 'form_id', 'form_name', 'is_organic', 'platform', 'interesse', 'fahrzeug',
  'full_name', 'phone_number', 'lead_status', 'Notiz'];
const lead = (id, zeit) => [id, zeit, 'ag:1', 'Ad', 'as:1', 'Set', 'c:1', 'Kampagne', 'f:1', 'Form',
  false, 'ig', 'referenzauto', 'Testauto', 'Max Test', 'p:+490000000'];
const metaHeaderBlock = HEADER.slice(0, 16).concat(['', 'lead_status']);

const werte = [
  pad(HEADER),
  // wie "Kevin": Status leer, CREATED in Notiz, echte Notiz eine Spalte zu weit rechts
  pad(lead('l:1', '2026-11-20T09:14:03-05:00').concat(['', 'CREATED', 'nicht erreichbar'])),
  // wie "David": CREATED im Status, danach kompletter Meta-Header als Müll
  pad(lead('l:2', '2026-11-20T09:11:49-05:00').concat(['CREATED'], metaHeaderBlock)),
  // bearbeiteter Lead bleibt unangetastet
  pad(lead('l:3', '2026-11-18T10:18:47-05:00').concat(['Terminiert', 'kommt Montag'])),
];

const sp = ctx.spalten_(werte[0]);
assert.deepEqual({ ...sp }, { status: 17, notiz: 18, datum: 2, breite: 18 });

const { werte: out, geaendert } = ctx.bereinigeLeads_(werte);
assert.equal(geaendert, true);

// Kevin: Notiz gerettet, Müll weg
assert.equal(out[1][16], '');
assert.equal(out[1][17], 'nicht erreichbar');
assert.ok(out[1].slice(18).every(v => v === ''));

// David: CREATED raus, Header-Müll komplett weg, Notiz leer
assert.equal(out[2][16], '');
assert.equal(out[2][17], '');
assert.ok(out[2].slice(18).every(v => v === ''));

// Bearbeiteter Lead unverändert
assert.equal(out[3][16], 'Terminiert');
assert.equal(out[3][17], 'kommt Montag');

// ISO-Zeit wird Tabellen-Zahl in deutscher Uhrzeit: 09:14 New York = 15:14 in Deutschland
const alsUhrzeit = serial => new Date(Math.round((serial - 25569) * 86400000)).toISOString().slice(0, 19);
assert.equal(typeof out[1][1], 'number');
assert.equal(alsUhrzeit(out[1][1]), '2026-11-20T15:14:03');
// Sommerzeit wird mitgerechnet (New York -04:00, Berlin +02:00)
assert.equal(alsUhrzeit(ctx.berlinSerial_(new Date('2026-07-01T09:00:00-04:00'))), '2026-07-01T15:00:00');

// Zweiter Lauf ändert nichts mehr
assert.equal(ctx.bereinigeLeads_(out).geaendert, false);

// Mit Kalenderspalte "Termin" in S: Datum bleibt stehen, Meta-Müll in S fliegt raus
const termin = new Date(Date.UTC(2026, 10, 25));
const werte2 = [
  pad(HEADER.concat(['Termin'])),
  pad(lead('l:4', 47000).concat(['Terminiert', 'kommt Montag', termin])),
  pad(lead('l:5', 47000).concat(['CREATED', 'id', 'created_time', 'ad_id'])),
];
assert.equal(ctx.spalten_(werte2[0]).breite, 19);
const out2 = ctx.bereinigeLeads_(werte2).werte;
assert.equal(out2[1][18], termin);
assert.equal(out2[1][17], 'kommt Montag');
assert.ok(out2[2].slice(16).every(v => v === ''));

console.log('Alle Tests grün');
