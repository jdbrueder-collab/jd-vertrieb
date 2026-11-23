/**
 * JD Vertrieb: Schnittstelle zwischen der App und den Lead-Tabellen von Meta.
 * Liegt in einer eigenen Google-Tabelle oder als zweite Datei neben dem Sortier-Skript in einer Lead-Tabelle.
 * In irgendeinem Reiter dieser Tabelle steht in Spalte A je Zeile der Link zu einer Lead-Tabelle
 * (eine pro Kampagne). Spalte B füllt das Skript mit dem Namen.
 *
 * Die Lead-Tabellen bleiben, wie Meta und das Sortier-Skript sie anlegen. Die App schreibt nur in
 * lead_status, Notiz und Termin. Die KI-Zusammenfassung wird als Eintrag an die Notiz angehängt.
 *
 * Skripteigenschaften (Projekteinstellungen > Skripteigenschaften):
 *   TEAM_PASSWORT      Passwort, mit dem sich das Team in der App anmeldet
 *   ANTHROPIC_API_KEY  Claude-Schlüssel für die KI-Zusammenfassung (beginnt mit sk-ant-api)
 *   PUSH_GEHEIMNIS     Geheimnis für den Push-Dienst (push/worker.js), gleich wie GEHEIMNIS bei Cloudflare
 *   LEXWARE_API_KEY    Schlüssel aus Lexware Office (Einstellungen > Öffentliche API): neue Leads werden Kunden, Angebote mit PDF
 *
 * Nach dem Einfügen einmal die Funktion vertriebEinrichten ausführen: Sie fragt die Berechtigungen ab
 * (Drive für Fotos) und legt die Zeitauslöser für die Benachrichtigungen an.
 *
 * Bereitstellen: Bereitstellen > Neue Bereitstellung > Web-App,
 *   Ausführen als: Ich, Zugriff: Jeder. Die URL kommt in config.js der App.
 */
const STATUS = ['Offen', 'Zurückrufen', 'Terminiert', 'Nicht erreicht', 'Unqualifiziert', 'Auftrag']; // wie das Dropdown in lead_status
const TECHNIK = ['id', 'created_time', 'ad_id', 'ad_name', 'adset_id', 'adset_name', 'campaign_id', 'campaign_name',
  'form_id', 'form_name', 'is_organic', 'platform', 'full_name', 'phone_number', 'lead_status', 'Notiz', 'Notizen', 'Termin'];
const MUELL = new Set(TECHNIK.concat(['CREATED', 'email'])); // was Meta beim Eintragen in falsche Zellen schreibt
// Kundendaten aus dem Meta-Formular (falls abgefragt). Stehen im Kundenbereich der App, nicht bei den Antworten.
const KUNDENFELDER = { email: ['email', 'e-mail', 'e_mail'], strasse: ['street_address', 'straße', 'strasse', 'adresse'],
  plz: ['post_code', 'zip_code', 'zip', 'postleitzahl', 'plz'], ort: ['city', 'stadt', 'ort', 'wohnort'] };
const MAIL_OK = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const KI_EINTRAG = /^\d\d\.\d\d\.\d\d \d\d:\d\d KI: /;
const AKTIV = ['Neu', 'Offen', 'Nicht erreicht', 'Zurückrufen', 'Terminiert']; // wie in der App
const APP_URL = 'https://jdbrueder-collab.github.io/jd-vertrieb/';
const PUSH_URL = 'https://jd-vertrieb-push.stempeluhr.workers.dev/send';
const props = () => PropertiesService.getScriptProperties();
const berlin = (d, f) => Utilities.formatDate(d, 'Europe/Berlin', f);

function doGet() {
  return ContentService.createTextOutput('JD Vertrieb Schnittstelle läuft.');
}

function doPost(e) {
  let out;
  try {
    const d = JSON.parse(e.postData.contents);
    pruefe(d.pw);
    const aktion = { liste, speichern, ki, feedback, push: pushAn, pushTest, foto, fotos, vorlage, lexArtikel, lexDaten, lexAngebot, gesendet, angebotMail, angebotPdf, artikelAus, nachziehen }[d.aktion];
    if (!aktion) throw fehler('aktion', 'Unbekannte Aktion.');
    out = Object.assign({ ok: true }, aktion(d));
  } catch (err) {
    out = { ok: false, code: err.code || 'fehler', fehler: String(err.message || err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

const fehler = (code, text) => Object.assign(new Error(text), { code });
const jetzt = () => Utilities.formatDate(new Date(), 'Europe/Berlin', 'dd.MM.yy HH:mm');
const gross = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// Nach 10 falschen Passwörtern ist 10 Minuten Pause, damit niemand durchprobieren kann.
function pruefe(pw) {
  const cache = CacheService.getScriptCache();
  const fehl = Number(cache.get('fehlversuche') || 0);
  if (fehl >= 10) throw fehler('pw', 'Zu viele Fehlversuche. Probier es in 10 Minuten nochmal.');
  const soll = PropertiesService.getScriptProperties().getProperty('TEAM_PASSWORT');
  if (!soll) throw fehler('setup', 'TEAM_PASSWORT fehlt in den Skripteigenschaften.');
  if (pw !== soll) { cache.put('fehlversuche', String(fehl + 1), 600); throw fehler('pw', 'Falsches Passwort.'); }
}

// Verbundene Lead-Tabellen: Links in Spalte A, egal in welchem Reiter dieser Tabelle. Spalte B = Name.
function verbunden() {
  const liste = [];
  SpreadsheetApp.getActiveSpreadsheet().getSheets().forEach((sh) => {
    if (!sh.getLastRow()) return;
    sh.getRange(1, 1, sh.getLastRow(), 2).getValues().forEach((z, i) => {
      const m = String(z[0]).match(/\/d\/([\w-]{20,})/) || String(z[0]).trim().match(/^([\w-]{20,})$/);
      if (m && !liste.some((v) => v.id === m[1])) liste.push({ id: m[1], name: String(z[1]), namensZelle: sh.getRange(i + 1, 2) });
    });
  });
  return liste;
}

// Eine Lead-Tabelle lesen. Meta schiebt neue Leads über die Kopfzeile, bis das Sortier-Skript sie
// wieder nach oben holt. Deshalb wird die Kopfzeile gesucht und jede andere Zeile ist ein Lead.
// Gelesen wird der erste Reiter mit so einer Kopfzeile, andere Reiter (Links, Feedback) bleiben außen vor.
function oeffne(id) {
  const ss = SpreadsheetApp.openById(id);
  let sheet, werte, k = -1;
  ss.getSheets().some((sh) => {
    sheet = sh;
    werte = sh.getDataRange().getValues();
    k = werte.findIndex((z) => z.includes('id') && z.includes('created_time'));
    return k >= 0;
  });
  if (k < 0) throw fehler('kopf', 'In „' + ss.getName() + '“ fehlt die Kopfzeile mit id und created_time.');
  const kopf = werte[k].map((h) => String(h).trim());
  const sp = (name) => kopf.indexOf(name);
  const anzeige = sheet.getDataRange().getDisplayValues(); // so wie in der Tabelle zu sehen, für Datumswerte
  return { id, ss, sheet, kopf, sp, k, werte, anzeige, name: ss.getName(), notiz: kopf.find((h) => h === 'Notiz' || h === 'Notizen') };
}

// Zeitpunkt als Text in deutscher Uhrzeit ohne Zeitzone, z. B. 2026-11-20T21:49:00.
// Datumszellen werden aus der Anzeige gelesen, weil die Lead-Tabellen keine Zeitzone eingestellt haben.
// shortcut: nur Anzeige im Format dd.MM.yyyy (HH:mm) wird erkannt, bei anderem Zellformat hier erweitern.
function zeit(x, anzeige, nurTag) {
  let s = '';
  const m = String(anzeige).match(/^(\d\d)\.(\d\d)\.(\d{4})(?: (\d\d):(\d\d))?/);
  if (m) s = m[3] + '-' + m[2] + '-' + m[1] + 'T' + (m[4] || '12') + ':' + (m[5] || '00') + ':00';
  else if (typeof x === 'number' && x > 0) s = new Date(Math.round((x - 25569) * 864e5)).toISOString().slice(0, 19); // Tabellen-Zahl
  else if (/^\d{4}-\d\d-\d\dT/.test(x) && !isNaN(new Date(x))) s = Utilities.formatDate(new Date(x), 'Europe/Berlin', "yyyy-MM-dd'T'HH:mm:ss");
  return nurTag ? s.slice(0, 10) : s;
}

function alsLead(t, z, a) {
  const roh = (name) => (t.sp(name) < 0 ? '' : z[t.sp(name)]);
  const zelle = (name) => [roh(name), t.sp(name) < 0 ? '' : a[t.sp(name)]];
  const text = (name) => { const v = String(roh(name)).trim(); return MUELL.has(v) ? '' : v; };
  const tel = text('phone_number').replace(/^p:/, '');
  let ziffern = tel.replace(/\D/g, '');
  if (!tel.startsWith('+')) ziffern = ziffern.replace(/^00/, '').replace(/^0/, '49');
  const eintraege = (t.notiz ? text(t.notiz) : '').split('\n\n').filter((e) => e.trim());
  const ki = eintraege.filter((e) => KI_EINTRAG.test(e)).pop() || '';
  const antworten = [];
  t.kopf.forEach((h, i) => {
    const v = String(a[i]).trim();
    if (h && !TECHNIK.includes(h) && !Object.values(KUNDENFELDER).some((n) => n.includes(h.toLowerCase())) && v && !MUELL.has(v)) antworten.push([gross(h.replace(/_/g, ' ')), gross(v)]);
  });
  const status = text('lead_status');
  const feld = (k) => { const i = t.kopf.findIndex((h) => KUNDENFELDER[k].includes(h.toLowerCase())); const v = i < 0 ? '' : String(z[i]).trim(); return MUELL.has(v) ? '' : v; };
  return {
    id: t.id + '~' + text('id'),
    datum: zeit(...zelle('created_time')),
    name: text('full_name'),
    telefon: tel,
    wa: ziffern.length > 6 ? 'https://wa.me/' + ziffern : '',
    antworten,
    anzeige: text('ad_name'),
    quelle: { ig: 'Instagram', fb: 'Facebook' }[text('platform')] || text('platform'),
    tabelle: t.name,
    status: STATUS.includes(status) ? status : 'Neu', // leer oder CREATED heißt: noch niemand hat sich gekümmert
    naechster: zeit(...zelle('Termin'), true),
    notizen: eintraege.filter((e) => !KI_EINTRAG.test(e)).join('\n\n'),
    ki: ki.replace(KI_EINTRAG, ''),
    kunde: { email: /@/.test(feld('email')) ? feld('email') : '', strasse: feld('strasse'), plz: feld('plz'), ort: feld('ort') },
  };
}

// Alle Leads einer Tabelle. Von Hand eingetragene Leads ohne id bekommen eine.
function leadsAus(t) {
  const sp = t.sp('id');
  return t.werte.map((z, i) => {
    if (i === t.k) return null;
    const l = alsLead(t, z, t.anzeige[i]);
    if (!l.name && !l.telefon) return null;
    if (!String(z[sp]).trim()) {
      z[sp] = 'manuell-' + Utilities.getUuid().slice(0, 8);
      t.sheet.getRange(i + 1, sp + 1).setValue(z[sp]);
      l.id = t.id + '~' + z[sp];
    }
    return l;
  }).filter(Boolean);
}

function liste() {
  const leads = [], tabellen = [];
  verbunden().forEach((v) => {
    try {
      const t = oeffne(v.id);
      if (v.name !== t.name) v.namensZelle.setValue(t.name);
      const ls = leadsAus(t);
      leads.push.apply(leads, ls);
      tabellen.push({ name: t.name, url: t.ss.getUrl(), anzahl: ls.length });
    } catch (err) {
      tabellen.push({ name: v.name || 'Tabelle ' + v.id.slice(0, 6), fehler: err.code === 'kopf' ? err.message
        : 'Kein Zugriff (' + err.message + '). Stimmt der Link, und darf dieses Google-Konto die Tabelle bearbeiten?' });
    }
  });
  leads.sort((a, b) => b.datum.localeCompare(a.datum));
  const alle = props().getProperties();
  leads.forEach((l) => {   // Kontakt in Lexware und letztes Angebot, falls vorhanden
    l.lex = alle['LEX_' + l.id] || '';
    l.angebot = alle['ANGEBOT_' + l.id] ? JSON.parse(alle['ANGEBOT_' + l.id]) : null;
  });
  return { lexware: !!alle.LEXWARE_API_KEY, leads, tabellen, heimUrl: SpreadsheetApp.getActiveSpreadsheet().getUrl(),
    texte: Object.fromEntries(TEXTE.filter((k) => alle[k]).map((k) => [k, alle[k]])) };
}

// Lead über seine id finden, frisch aus der Tabelle, weil Meta und das Sortier-Skript Zeilen verschieben.
function finde(appId) {
  const teil = String(appId || '').split('~');
  if (teil.length !== 2 || !teil[1]) throw fehler('weg', 'Unbekannter Lead.');
  const t = oeffne(teil[0]);
  const zelle = t.sheet.getRange(1, t.sp('id') + 1, t.sheet.getLastRow(), 1)
    .createTextFinder(teil[1]).matchEntireCell(true).findNext();
  if (!zelle) throw fehler('weg', 'Diesen Lead gibt es in der Tabelle nicht mehr.');
  return { t, zeile: zelle.getRow() };
}

// Status, Termin und neue Notiz speichern. Notizen werden mit Zeit und Name angehängt, nie überschrieben.
function leseZeile(t, nr) {
  const r = t.sheet.getRange(nr, 1, 1, t.kopf.length);
  return alsLead(t, r.getValues()[0], r.getDisplayValues()[0]);
}

function speichern(d) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const { t, zeile } = finde(d.id);
    const zelle = (name) => {
      if (!name || t.sp(name) < 0) throw fehler('spalte', 'In „' + t.name + '“ fehlt die Spalte ' + (name || 'Notiz') + '.');
      return t.sheet.getRange(zeile, t.sp(name) + 1);
    };
    if (d.status !== undefined) {
      if (d.status !== 'Neu' && !STATUS.includes(d.status)) throw fehler('status', 'Unbekannter Status.');
      zelle('lead_status').setValue(d.status === 'Neu' ? '' : d.status);
    }
    if (d.naechster !== undefined) {
      if (d.naechster && !/^\d{4}-\d{2}-\d{2}$/.test(d.naechster)) throw fehler('datum', 'Ungültiges Datum.');
      zelle('Termin').setValue(d.naechster ? new Date(d.naechster + 'T12:00:00') : '');
    }
    const wer = String(d.wer || '').trim() || 'Team';
    const eintrag = d.ki ? 'KI: ' + d.ki : String(d.notiz || '').trim() && wer + ': ' + String(d.notiz).trim();
    if (eintrag) {
      const n = zelle(t.notiz);
      const alt = String(n.getValue()).trim();
      n.setValue((alt && !MUELL.has(alt) ? alt + '\n\n' : '') + jetzt() + ' ' + eintrag);
    }
    SpreadsheetApp.flush();
    return { lead: leseZeile(t, zeile) };
  } finally {
    lock.releaseLock();
  }
}

// Claude fasst die Notizen zum Lead zusammen und schlägt Status und nächsten Kontakt vor.
function ki(d) {
  const { t, zeile } = finde(d.id);
  const l = leseZeile(t, zeile);
  if (!l.notizen.trim()) throw fehler('leer', 'Es gibt noch keine Notizen zum Zusammenfassen.');
  const heute = Utilities.formatDate(new Date(), 'Europe/Berlin', 'EEEE, yyyy-MM-dd');
  const text = [
    'Heute ist ' + heute + '.',
    'Lead: ' + (l.name || 'ohne Namen') + '. Anzeige: ' + (l.anzeige || 'unbekannt') + '.',
    'Angaben im Formular: ' + (l.antworten.map((a) => a[0] + ': ' + a[1]).join('; ') || 'keine') + '.',
    'Aktueller Status: ' + l.status + '.',
    '', 'Notizen aus den Telefonaten:', l.notizen,
  ].join('\n');
  const r = claude(
    'Du bist Vertriebsassistent von JD Brüder, Fahrzeugaufbereitung und Detailing in Puderbach im Westerwald. ' +
    'Du fasst Notizen aus Telefonaten mit Interessenten zusammen, die über Meta-Anzeigen gekommen sind. ' +
    'Schreib auf Deutsch, kurz und sachlich, ohne Gedankenstriche. Erfinde nichts, was nicht in den Notizen steht.\n' +
    'stichpunkte: 1 bis 3 Stichpunkte, je höchstens 8 Wörter, nur was in den Telefonaten passiert ist oder neu erfahren wurde ' +
    '(z. B. „Fr. angerufen, nicht erreicht“, „Will Komplettpaket, Budget 500 €“). Nichts aus dem Formular wiederholen, ' +
    'nichts über fehlende Infos schreiben.\n' +
    'naechster_schritt: höchstens 6 Wörter, z. B. „Montag nochmal anrufen“.\n' +
    'status: der passende Status für den Lead.\n' +
    'naechster_kontakt: Datum im Format YYYY-MM-DD, wenn ein Rückruf oder Termin vereinbart oder sinnvoll ist, sonst leer.',
    text,
    {
      type: 'object',
      properties: {
        stichpunkte: { type: 'array', items: { type: 'string' } },
        naechster_schritt: { type: 'string' },
        status: { type: 'string', enum: STATUS },
        naechster_kontakt: { type: 'string' },
      },
      required: ['stichpunkte', 'naechster_schritt', 'status', 'naechster_kontakt'],
      additionalProperties: false,
    }
  );
  const kurz = (t) => String(t).replace(/\s+/g, ' ').trim(); // keine Leerzeilen, die würden den KI-Eintrag in der Notiz zerteilen
  const kiText = r.stichpunkte.slice(0, 3).map((p) => '• ' + kurz(p)).concat('Nächster Schritt: ' + kurz(r.naechster_schritt)).join('\n');
  const lead = speichern({ id: d.id, ki: kiText }).lead;
  const datum = /^\d{4}-\d{2}-\d{2}$/.test(r.naechster_kontakt) ? r.naechster_kontakt : '';
  return { lead, vorschlag: { status: r.status, naechster: datum } };
}

function claude(system, text, schema) {
  const key = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY');
  if (!key) throw fehler('ki', 'Die KI ist noch nicht eingerichtet (ANTHROPIC_API_KEY fehlt).');
  const res = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'post',
    contentType: 'application/json',
    muteHttpExceptions: true,
    headers: { 'x-api-key': key, 'anthropic-version': '2026-10-21', 'anthropic-beta': 'server-side-fallback-2026-07-01' },
    payload: JSON.stringify({
      model: 'claude-opus-5-5',
      max_tokens: 16000,
      fallbacks: 'default',
      output_config: { effort: 'low', format: { type: 'json_schema', schema } },
      system,
      messages: [{ role: 'user', content: text }],
    }),
  });
  const body = JSON.parse(res.getContentText());
  if (res.getResponseCode() !== 200) throw fehler('ki', 'KI-Fehler: ' + ((body.error && body.error.message) || res.getResponseCode()));
  if (body.stop_reason === 'refusal') throw fehler('ki', 'Die KI hat die Anfrage abgelehnt.');
  const block = (body.content || []).find((b) => b.type === 'text');
  if (!block || body.stop_reason === 'max_tokens') throw fehler('ki', 'Die KI hat keine vollständige Antwort geliefert.');
  return JSON.parse(block.text);
}

// Texte an Kunden (Setup), gelten fürs ganze Team. Die App setzt {Name}, {Wunsch}, {Nr}, {Ich} ein.
// Leer = Standardtext der App. Bei „Nicht erreicht“ müssen {Name} und {Wunsch} bleiben.
const TEXTE = ['WA_VORLAGE', 'TEXT_ANGEBOT_WA', 'TEXT_MAIL_BETREFF', 'TEXT_MAIL'];
function vorlage(d) {
  const k = d.art || 'WA_VORLAGE', t = String(d.text != null ? d.text : d.vorlage || '').trim();
  if (!TEXTE.includes(k)) throw fehler('vorlage', 'Unbekannter Text.');
  if (t.length > 2000) throw fehler('vorlage', 'Höchstens 2000 Zeichen.');
  if (k === 'WA_VORLAGE' && t && (!t.includes('{Name}') || !t.includes('{Wunsch}'))) throw fehler('vorlage', '{Name} und {Wunsch} müssen in der Nachricht bleiben.');
  if (t) props().setProperty(k, t); else props().deleteProperty(k);
  return {};
}

// Feedback-Lampe: landet in dieser Tabelle im Reiter "Feedback".
function feedback(d) {
  const text = String(d.text || '').trim();
  if (!text) throw fehler('leer', 'Schreib erst etwas.');
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName('Feedback');
  if (!sh) { sh = ss.insertSheet('Feedback', ss.getSheets().length); sh.appendRow(['Datum', 'Wer', 'Art', 'Text']); }
  sh.appendRow([new Date(), String(d.wer || ''), String(d.art || ''), text]);
  return {};
}

// ---------- Benachrichtigungen ----------
// Einmal im Editor ausführen: fragt die Berechtigungen ab und legt die Zeitauslöser an.
function vertriebEinrichten() {
  ScriptApp.getProjectTriggers().filter((t) => ['meldeNeueLeads', 'meldeFaellige'].includes(t.getHandlerFunction()))
    .forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('meldeNeueLeads').timeBased().everyMinutes(1).create();
  ScriptApp.newTrigger('meldeFaellige').timeBased().atHour(8).nearMinute(0).everyDays(1).inTimezone('Europe/Berlin').create();
  DriveApp.getRootFolder(); // damit Google die Drive-Berechtigung für die Fotos gleich mit abfragt
  MailApp.getRemainingDailyQuota(); // und das Senden von Angeboten per Mail aus diesem Google-Konto
  meldeNeueLeads();
}

// Gerät für Benachrichtigungen anmelden (Push-Abo aus dem Browser).
// shortcut: Abos liegen in einer Skripteigenschaft (max. 9 KB, reicht für etwa 15 Geräte), bei mehr in einen Reiter umziehen.
function pushAn(d) {
  const a = d.abo || {}, k = a.keys || {};
  if (!/^https:\/\/[\w.-]+\.(push\.apple\.com|googleapis\.com|mozilla\.com|windows\.com)\//.test(a.endpoint) || !k.p256dh || !k.auth) throw fehler('push', 'Dieses Gerät kann keine Benachrichtigungen empfangen.');
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const abos = JSON.parse(props().getProperty('PUSH_ABOS') || '[]').filter((x) => x.endpoint !== a.endpoint);
    abos.push({ endpoint: a.endpoint, keys: { p256dh: String(k.p256dh), auth: String(k.auth) }, wer: String(d.wer || '') });
    props().setProperty('PUSH_ABOS', JSON.stringify(abos));
  } finally {
    lock.releaseLock();
  }
  return {};
}

// Gerät anmelden und gleich eine Testnachricht nur an dieses Gerät schicken.
function pushTest(d) {
  pushAn(d);
  sende('🔔 Test von JD Vertrieb', 'So sehen eure Benachrichtigungen aus. Ein Tipp öffnet die App.', APP_URL, [d.abo]);
  return {};
}

function sende(title, body, url, nur) {
  const abos = nur || JSON.parse(props().getProperty('PUSH_ABOS') || '[]');
  const geheim = props().getProperty('PUSH_GEHEIMNIS');
  if (!abos.length || !geheim) return;
  const res = UrlFetchApp.fetch(PUSH_URL, {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + geheim }, payload: JSON.stringify({ abos, title, body, url }),
  });
  if (res.getResponseCode() !== 200) throw new Error('Push-Dienst antwortet mit ' + res.getResponseCode());
  const weg = JSON.parse(res.getContentText()).weg || [];
  if (weg.length) props().setProperty('PUSH_ABOS', JSON.stringify(JSON.parse(props().getProperty('PUSH_ABOS') || '[]').filter((x) => !weg.includes(x.endpoint))));
}

// Zeitauslöser jede Minute. Gelesen wird nur, wenn sich eine Lead-Tabelle geändert hat. Gemerkt werden die
// ids der Leads der letzten zwei Tage, alles, was dort neu auftaucht, wird gemeldet.
function meldeNeueLeads() {
  const stand = verbunden().map((v) => { try { return DriveApp.getFileById(v.id).getLastUpdated().getTime(); } catch (e) { return 0; } }).join();
  if (stand === props().getProperty('PUSH_STAND')) return;
  const grenze = berlin(new Date(Date.now() - 2 * 864e5), "yyyy-MM-dd'T'HH:mm:ss");
  const frisch = liste().leads.filter((l) => l.datum >= grenze);
  const alt = props().getProperty('PUSH_BEKANNT');
  props().setProperties({ PUSH_STAND: stand, PUSH_BEKANNT: JSON.stringify(frisch.map((l) => l.id.split('~')[1])) });
  if (alt === null) return; // erster Lauf: nur merken
  const neu = frisch.filter((l) => !JSON.parse(alt).includes(l.id.split('~')[1]));
  try {
    if (neu.length === 1) sende('🔔 Neuer Lead: ' + (neu[0].name || 'ohne Namen'), neu[0].antworten.map((a) => a[1]).join(' · ') || neu[0].telefon,
      APP_URL + '#lead=' + encodeURIComponent(neu[0].id));
    else if (neu.length) sende('🔔 ' + neu.length + ' neue Leads', neu.map((l) => l.name || l.telefon).join(', '), APP_URL);
  } finally {
    // Jede neue Anfrage wird gleich Kunde in Lexware. Klappt es nicht, passiert es beim ersten Angebot oder bei den Kundendaten.
    if (props().getProperty('LEXWARE_API_KEY')) neu.forEach((l) => { try { lexKontakt(l.id, l); } catch (e) { console.warn('Lexware: ' + e.message); } });
  }
}

// Zeitauslöser morgens um 8: alle Leads, bei denen heute oder früher ein Rückruf oder Termin ansteht.
function meldeFaellige() {
  const heute = berlin(new Date(), 'yyyy-MM-dd');
  const f = liste().leads.filter((l) => AKTIV.includes(l.status) && l.naechster && l.naechster <= heute);
  if (f.length) sende('☎️ Heute fällig: ' + f.length, f.map((l) => (l.name || l.telefon) + (l.angebot && l.angebot.gesendet ? ' (Angebot nachfassen)' : '')).join(', '), APP_URL);
}

// ---------- Fotos ----------
// Pro Lead ein Ordner in „JD Vertrieb Fotos“ (in Drive des Skript-Kontos). Welcher Ordner zu welchem Lead gehört,
// steht in den Skripteigenschaften (FOTOS_<Lead>), damit der Ordnername für den Kunden schön bleiben kann.
// Der Ordner ist gleich für jeden mit dem Link sichtbar, damit der Link an den Kunden immer funktioniert.
function fotoOrdner(appId, anlegen) {
  const key = 'FOTOS_' + appId, id = props().getProperty(key);
  if (id || !anlegen) return id ? DriveApp.getFolderById(id) : null;
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    if (props().getProperty(key)) return DriveApp.getFolderById(props().getProperty(key));
    let wurzelId = props().getProperty('FOTOS_WURZEL');
    if (!wurzelId) { wurzelId = DriveApp.createFolder('JD Vertrieb Fotos').getId(); props().setProperty('FOTOS_WURZEL', wurzelId); }
    const { t, zeile } = finde(appId);
    const l = leseZeile(t, zeile), auto = (l.antworten.find((a) => a[0] === 'Fahrzeug') || [])[1] || '';
    const ordner = DriveApp.getFolderById(wurzelId).createFolder([l.name || 'Ohne Namen', auto.slice(0, 40)].filter(Boolean).join(', '));
    try { ordner.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) { } // manche Konten verbieten das, Fotos gehen trotzdem
    props().setProperty(key, ordner.getId());
    return ordner;
  } finally {
    lock.releaseLock();
  }
}

// Ein Foto in voller Auflösung ablegen (die App schickt eins nach dem anderen).
function foto(d) {
  const typ = String(d.typ || '');
  if (!/^image\/(jpeg|png|heic|heif|webp)$/.test(typ) || !d.daten) throw fehler('foto', 'Das ist kein Foto.');
  const ordner = fotoOrdner(d.id, true);
  const name = berlin(new Date(), 'yyyy-MM-dd HH-mm-ss') + ' ' + (Number(d.nr) || 1) + '.' + typ.split('/')[1].replace('jpeg', 'jpg');
  ordner.createFile(Utilities.newBlob(Utilities.base64Decode(String(d.daten)), typ, name));
  return {};
}

// Fotos eines Leads mit kleinen Vorschaubildern für die App.
function fotos(d) {
  const ordner = fotoOrdner(d.id, false);
  if (!ordner) return { fotos: [], ordner: '' };
  const liste = [], it = ordner.getFiles();
  while (it.hasNext()) {
    const f = it.next();
    let bild = '';
    try { const b = f.getThumbnail(); if (b) bild = 'data:' + b.getContentType() + ';base64,' + Utilities.base64Encode(b.getBytes()); } catch (e) { }
    liste.push({ name: f.getName(), url: f.getUrl(), bild });
  }
  liste.sort((a, b) => a.name.localeCompare(b.name));
  return { fotos: liste, ordner: ordner.getUrl() };
}

// ---------- Lexware Office: Kunden und Angebote ----------
// Die Schnittstelle gibt es ab Tarif XL. Jede neue Anfrage wird sofort Kunde (meldeNeueLeads). Pro Lead merkt sich
// das Skript die Kontakt-id (LEX_<Lead-id>) und das letzte Angebot (ANGEBOT_<Lead-id>). Angebote werden fertig
// angelegt, mit Nummer und PDF. Das PDF liegt im Drive-Ordner des Kunden, die App schickt den Link per WhatsApp oder Mail.
const LEX_APP = 'https://app.lexware.de/permalink/';
const LEX_EINLEITUNG = 'Gerne bieten wir Ihnen an:';   // eure Standardtexte aus Lexware
const LEX_SCHLUSS = 'Wir freuen uns auf Ihre Auftragserteilung und sichern eine einwandfreie Ausführung zu.';
let lexZuletzt = 0;

function lex(pfad, body, methode, pdf) {
  const key = String(props().getProperty('LEXWARE_API_KEY') || '').trim();
  if (!key) throw fehler('lexware', 'Lexware ist noch nicht verbunden (LEXWARE_API_KEY fehlt in den Skripteigenschaften).');
  const opt = { method: methode || (body ? 'post' : 'get'), headers: { Authorization: 'Bearer ' + key, Accept: pdf ? 'application/pdf' : 'application/json' }, muteHttpExceptions: true };
  if (body) Object.assign(opt, { contentType: 'application/json', payload: JSON.stringify(body) });
  for (let versuch = 0; ; versuch++) {
    const warte = lexZuletzt + 550 - Date.now();   // Lexware erlaubt 2 Anfragen pro Sekunde
    if (warte > 0) Utilities.sleep(warte);
    lexZuletzt = Date.now();
    const res = UrlFetchApp.fetch('https://api.lexware.io' + pfad, opt), code = res.getResponseCode();
    if ((code === 429 || (pdf && (code === 404 || code === 409))) && versuch < 3) { Utilities.sleep(1500); continue; }   // zu schnell, oder PDF noch nicht fertig
    if (pdf && code < 300) return res.getBlob();
    let j = {};
    try { j = JSON.parse(res.getContentText() || '{}'); } catch (e) { }
    if (code < 300) return j;
    if (code === 401 || code === 403) throw fehler('lexware', 'Lexware lehnt den Schlüssel ab. Stimmt LEXWARE_API_KEY, und hat euer Tarif die Öffentliche API (ab XL)?');
    const was = (j.details || []).map((x) => x.field + ' ' + x.violation).concat((j.IssueList || []).map((x) => x.source + ' ' + x.i18nKey));
    throw fehler('lexware', 'Lexware meldet Fehler ' + code + (was.length ? ': ' + was.join(', ') : j.message ? ': ' + j.message : '') + '.');
  }
}

// Firmendaten einmal holen und 6 Stunden merken: Name fürs Setup und wie Preise gerechnet werden (netto, brutto, ohne Steuer)
function lexProfil() {
  const c = CacheService.getScriptCache(), z = c.get('LEX_PROFIL');
  if (z) return JSON.parse(z);
  const p = lex('/v1/profile');
  const kurz = { firma: p.companyName || '', ohneSteuer: !!p.smallBusiness || p.taxType === 'vatfree', brutto: p.taxType === 'gross' };
  c.put('LEX_PROFIL', JSON.stringify(kurz), 21600);
  return kurz;
}

// shortcut: höchstens 250 Artikel (eine Seite), JD Brüder hat gut 80
const lexArtikelRoh = () => (lex('/v1/articles?size=250').content || []).filter((a) => !a.archived);
const lexBrutto = (pr) => (pr.grossPrice != null ? pr.grossPrice : Math.round((pr.netPrice || 0) * (100 + (Number(pr.taxRate) || 0))) / 100);
const euro = (n) => (Number(n) || 0).toFixed(2).replace('.', ',') + ' €';

// Artikel für die App, mit Endpreis (so wie der Kunde zahlt)
function lexArtikel() {
  const p = lexProfil(), aus = new Set(JSON.parse(props().getProperty('ARTIKEL_AUS') || '[]'));
  const artikel = lexArtikelRoh().map((a) => ({ id: a.id, name: String(a.title || '').trim(), einheit: a.unitName || 'Stück', preis: p.ohneSteuer ? (a.price || {}).netPrice || 0 : lexBrutto(a.price || {}), aus: aus.has(a.id) }));
  artikel.sort((a, b) => a.name.localeCompare(b.name, 'de'));
  return { firma: p.firma, artikel };
}

// Welche Artikel in der App nicht erscheinen (z. B. Bauleistungen). Gilt fürs ganze Team, neue Artikel sind erst mal sichtbar.
function artikelAus(d) {
  const aus = (Array.isArray(d.aus) ? d.aus : []).map(String).filter((x) => /^[\w-]{1,64}$/.test(x)).slice(0, 1000);
  props().setProperty('ARTIKEL_AUS', JSON.stringify(aus));
  return { aus };
}

// E-Mail und Adresse prüfen. Leere Felder ändern in Lexware nichts.
function kundeAus(d) {
  const f = (k, n) => String(d[k] || '').trim().slice(0, n);
  const k = { email: f('email', 100), strasse: f('strasse', 100), plz: f('plz', 10), ort: f('ort', 100) };
  if (k.email && !MAIL_OK.test(k.email)) throw fehler('email', 'Die E-Mail-Adresse sieht nicht richtig aus.');
  return k;
}
// Kundendaten in einen Lexware-Kontakt schreiben (Lexware erlaubt je Liste nur einen Eintrag)
function lexKontaktDaten(c, k) {
  if (k.email) {
    const art = ['business', 'private', 'office', 'other'].find((a) => ((c.emailAddresses || {})[a] || []).length) || 'private';
    c.emailAddresses = Object.assign(c.emailAddresses || {}, { [art]: [k.email] });
  }
  const adr = { street: k.strasse, zip: k.plz, city: k.ort };
  Object.keys(adr).forEach((x) => { if (!adr[x]) delete adr[x]; });
  if (Object.keys(adr).length) {
    const alt = ((c.addresses || {}).billing || [])[0] || {};
    c.addresses = Object.assign(c.addresses || {}, { billing: [Object.assign(alt, adr, { countryCode: alt.countryCode || 'DE' })] });
  }
  return c;
}
const lexKundeAus = (c) => {
  const a = ((c.addresses || {}).billing || [])[0] || {}, m = c.emailAddresses || {};
  return { email: ['business', 'private', 'office', 'other'].map((x) => (m[x] || [])[0]).find(Boolean) || '', strasse: a.street || '', plz: a.zip || '', ort: a.city || '' };
};

function lexKontakt(appId, l, k) {
  const key = 'LEX_' + appId;
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    if (props().getProperty(key)) return props().getProperty(key);
    const teile = (l.name || 'Ohne Namen').trim().split(/\s+/), nachname = teile.pop();
    const da = lexSuche(nachname, l.telefon, (k || l.kunde || {}).email);   // gibt es den Kunden schon? Dann verknüpfen statt doppelt anlegen
    if (da) { props().setProperty(key, da); return da; }
    const kontakt = { version: 0, roles: { customer: {} }, person: { firstName: teile.join(' ') || undefined, lastName: nachname },
      note: ('Aus JD Vertrieb. ' + l.antworten.map((a) => a.join(': ')).join(', ')).slice(0, 1000) };
    if (l.telefon) kontakt.phoneNumbers = { mobile: [l.telefon] };
    lexKontaktDaten(kontakt, k || l.kunde || {});
    if (!kontakt.addresses) kontakt.addresses = { billing: [{ countryCode: 'DE' }] };   // ohne Rechnungsadresse nimmt Lexware kein Angebot an
    const id = lex('/v1/contacts', kontakt).id;
    props().setProperty(key, id);
    return id;
  } finally {
    lock.releaseLock();
  }
}

// Bestehender Kunde mit gleichem Nachnamen UND gleicher Handynummer oder E-Mail. Nur der Name reicht nicht,
// sonst landet ein Angebot beim falschen Thomas Müller.
function lexSuche(nachname, telefon, email) {
  if (nachname.length < 3) return '';
  const ziffern = (x) => String(x || '').replace(/\D/g, '').slice(-9), tel = ziffern(telefon), mail = String(email || '').toLowerCase();
  const treffer = (lex('/v1/contacts?customer=true&size=100&name=' + encodeURIComponent(nachname)).content || []).find((c) =>
    (tel.length === 9 && Object.values(c.phoneNumbers || {}).flat().some((n) => ziffern(n) === tel))
    || (mail && Object.values(c.emailAddresses || {}).flat().some((m) => String(m).toLowerCase() === mail)));
  return treffer ? treffer.id : '';
}

// Lexware nimmt ein fertiges Angebot nur mit genau einer Rechnungsadresse beim Kunden an. Fehlt sie (ältere oder
// verknüpfte Kunden), wird mindestens das Land eingetragen. Straße und Ort kommen über die Kundendaten dazu.
function lexAdresseSicher(id) {
  const c = lex('/v1/contacts/' + id);
  if (((c.addresses || {}).billing || []).length) return;
  c.addresses = Object.assign(c.addresses || {}, { billing: [{ countryCode: 'DE' }] });
  lex('/v1/contacts/' + id, c, 'put');
}

// Kundendaten lesen (ohne speichern) oder in Lexware speichern. Gibt es den Kunden noch nicht, wird er angelegt.
function lexDaten(d) {
  const id = props().getProperty('LEX_' + d.id);
  if (!d.speichern) {
    if (id) return { lex: id, kunde: lexKundeAus(lex('/v1/contacts/' + id)) };
    const { t, zeile } = finde(d.id);
    return { lex: '', kunde: leseZeile(t, zeile).kunde };
  }
  const k = kundeAus(d);
  if (!id) { const { t, zeile } = finde(d.id); return { lex: lexKontakt(d.id, leseZeile(t, zeile), k), kunde: k }; }
  for (let versuch = 0; ; versuch++) {
    const c = lexKontaktDaten(lex('/v1/contacts/' + id), k);
    try { lex('/v1/contacts/' + id, c, 'put'); return { lex: id, kunde: lexKundeAus(c) }; }
    catch (e) { if (versuch || !/ 409/.test(e.message)) throw e; }   // gerade woanders geändert: neu lesen und nochmal
  }
}

// Angebot mit Nummer und PDF. Artikelpreise kommen frisch aus Lexware, eigene Positionen sind Endpreise.
function lexAngebot(d) {
  const p = lexProfil(), artikel = {};
  lexArtikelRoh().forEach((a) => { artikel[a.id] = a; });
  const posten = (Array.isArray(d.posten) ? d.posten : []).slice(0, 50).map((x) => {
    const menge = Number(x.menge);
    if (!(menge > 0 && menge <= 1000)) return null;
    const a = x.artikel && artikel[x.artikel];
    if (x.artikel && !a) throw fehler('artikel', 'Ein Artikel ist in Lexware nicht mehr da. Öffne das Angebot neu.');
    if (a) {
      const pr = a.price || {};
      return { a, name: String(a.title || '').trim().slice(0, 255), menge, einheit: a.unitName || 'Stück', steuer: p.ohneSteuer ? 0 : Number(pr.taxRate) || 0,
        netto: pr.netPrice || 0, brutto: p.ohneSteuer ? pr.netPrice || 0 : lexBrutto(pr) };
    }
    const name = String(x.name || '').trim().slice(0, 255), brutto = Math.round(Number(x.preis) * 100) / 100, steuer = p.ohneSteuer ? 0 : 19;
    if (!name || !(brutto >= 0 && brutto < 1e6)) return null;
    return { name, menge, einheit: 'Pauschal', steuer, brutto, netto: Math.round(brutto / (1 + steuer / 100) * 100) / 100 };
  }).filter(Boolean);
  if (!posten.length) throw fehler('leer', 'Wähl mindestens eine Leistung aus.');
  const rabatt = Math.round(Math.min(100, Math.max(0, Number(d.rabatt) || 0)) * 100) / 100, rabattText = String(rabatt).replace('.', ',') + ' %';
  const { t, zeile } = finde(d.id), l = leseZeile(t, zeile);
  const kontakt = lexKontakt(d.id, l), auto = (l.antworten.find((a) => a[0] === 'Fahrzeug') || [])[1] || '';
  lexAdresseSicher(kontakt);
  const datum = (tage) => berlin(new Date(Date.now() + tage * 864e5), "yyyy-MM-dd'T'HH:mm:ss.SSSXXX");
  const id = lex('/v1/quotations?finalize=true', {
    voucherDate: datum(0), expirationDate: datum(30),
    address: { contactId: kontakt },
    lineItems: posten.map((x) => Object.assign(x.a ? { id: x.a.id, type: x.a.type === 'PRODUCT' ? 'material' : 'service' } : { type: 'custom' }, {
      name: x.name, quantity: x.menge, unitName: x.einheit,
      unitPrice: p.brutto ? { currency: 'EUR', grossAmount: x.brutto, taxRatePercentage: x.steuer } : { currency: 'EUR', netAmount: x.netto, taxRatePercentage: x.steuer },
    }, x.a && x.a.description ? { description: String(x.a.description).slice(0, 2000) } : {})),
    totalPrice: Object.assign({ currency: 'EUR' }, rabatt ? { totalDiscountPercentage: rabatt } : {}),
    taxConditions: { taxType: p.ohneSteuer ? 'vatfree' : p.brutto ? 'gross' : 'net' },
    title: 'Angebot',
    introduction: [auto && 'Fahrzeug: ' + auto, d.referenz && rabatt ? 'Als Referenzkunde erhalten Sie ' + rabattText + ' Rabatt.' : '', LEX_EINLEITUNG].filter(Boolean).join('\n'),
    remark: LEX_SCHLUSS,
  }).id;
  // Nummer, Summe und PDF. Das Angebot gibt es ab hier, deshalb geht ein Fehler danach nicht mehr verloren.
  const summe = posten.reduce((s, x) => s + x.menge * x.brutto, 0) * (1 - rabatt / 100);
  const angebot = { nr: '', summe: Math.round(summe * 100) / 100, pdf: '', link: LEX_APP + 'quotations/view/' + id, datum: berlin(new Date(), 'yyyy-MM-dd') };
  let pdf64 = '';   // das PDF selbst, damit die App es gleich per WhatsApp teilen kann
  try {
    const q = lex('/v1/quotations/' + id);
    angebot.nr = q.voucherNumber || '';
    angebot.version = q.version;   // ändert sich, sobald jemand das Angebot in Lexware bearbeitet
    if ((q.totalPrice || {}).totalGrossAmount != null) angebot.summe = q.totalPrice.totalGrossAmount;
    const blob = lex('/v1/quotations/' + id + '/file', null, 'get', true).setName('Angebot ' + (angebot.nr || id) + '.pdf');
    pdf64 = Utilities.base64Encode(blob.getBytes());
    const datei = fotoOrdner(d.id, true).createFile(blob);
    try { datei.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) { }
    angebot.pdf = datei.getUrl();
  } catch (e) { console.warn('Angebot ' + id + ': ' + e.message); }
  props().setProperty('ANGEBOT_' + d.id, JSON.stringify(angebot));
  const notiz = 'Angebot ' + (angebot.nr || '') + ' erstellt (' + euro(angebot.summe) + (rabatt ? ', ' + rabattText + ' Rabatt' : '') + '): '
    + posten.map((x) => (x.menge === 1 ? '' : String(x.menge).replace('.', ',') + '× ') + x.name).join(', ');
  return Object.assign(speichern({ id: d.id, wer: d.wer, notiz: notiz.replace('Angebot  ', 'Angebot ') }), { lex: kontakt, angebot, pdf64 });
}

// Angebot verschickt: vermerken und, falls noch kein Rückruf geplant ist, in 3 Tagen nachfassen.
// Dann steht der Lead an dem Tag unter „Fällig“, und die 8-Uhr-Nachricht erinnert daran.
function gesendet(d) {
  const key = 'ANGEBOT_' + d.id, a = JSON.parse(props().getProperty(key) || 'null');
  if (!a) throw fehler('weg', 'Zu diesem Lead gibt es noch kein Angebot.');
  const weg = d.weg === 'Mail' ? 'Mail' : 'WhatsApp', heute = berlin(new Date(), 'yyyy-MM-dd');
  a.gesendet = heute;
  props().setProperty(key, JSON.stringify(a));
  const { t, zeile } = finde(d.id), l = leseZeile(t, zeile);
  const nach = ['Neu', 'Offen', 'Nicht erreicht', 'Zurückrufen'].includes(l.status) && (!l.naechster || l.naechster < heute)
    ? berlin(new Date(Date.now() + 3 * 864e5), 'yyyy-MM-dd') : undefined;
  const notiz = 'Angebot ' + a.nr + ' per ' + weg + (d.an ? ' an ' + d.an : '') + ' geschickt';
  return Object.assign(speichern({ id: d.id, wer: d.wer, notiz, naechster: nach }), { angebot: a, nachfassen: nach || '' });
}

// Offene Leads, die noch kein Kunde in Lexware sind, nachträglich anlegen. Pro Aufruf höchstens 25 Sekunden,
// die App ruft so lange nach, bis nichts mehr übrig ist.
function nachziehen() {
  const offen = liste().leads.filter((l) => AKTIV.includes(l.status) && !l.lex), start = Date.now();
  let n = 0;
  for (const l of offen) {
    if (Date.now() - start > 25000) break;
    lexKontakt(l.id, l);
    n++;
  }
  return { angelegt: n, rest: offen.length - n };
}

// Angebot per Mail aus dem Google-Konto, unter dem das Skript läuft (jd.brueder@gmail.com), mit dem PDF im Anhang.
// Gmail erlaubt so rund 100 Empfänger am Tag.
function angebotMail(d) {
  const a = JSON.parse(props().getProperty('ANGEBOT_' + d.id) || 'null');
  if (!a) throw fehler('weg', 'Zu diesem Lead gibt es noch kein Angebot.');
  const email = String(d.email || '').trim();
  if (!MAIL_OK.test(email)) throw fehler('email', 'Trag erst eine gültige E-Mail-Adresse ein.');
  const { t, zeile } = finde(d.id), vorname = (leseZeile(t, zeile).name || '').split(' ')[0];
  const pdf = lex('/v1/quotations/' + a.link.split('/').pop() + '/file', null, 'get', true).setName('Angebot ' + a.nr + '.pdf');
  // Betreff und Text kommen fertig aus der App (Setup → Mail: Angebot), sonst der Standard
  MailApp.sendEmail({
    to: email, name: 'JD Brüder', attachments: [pdf],
    subject: String(d.betreff || '').trim().slice(0, 200) || 'Dein Angebot ' + a.nr + ' von JD Brüder',
    body: String(d.text || '').trim().slice(0, 5000) || 'Hallo' + (vorname ? ' ' + vorname : '') + ',\n\nim Anhang findest du dein Angebot ' + a.nr + '.\n\nMeld dich gern, wenn du Fragen hast.\n\nViele Grüße\n'
      + (String(d.wer || '').trim() || 'Dein Team') + '\nJD Brüder',
  });
  return gesendet(Object.assign({}, d, { weg: 'Mail', an: email }));
}

// Das PDF des letzten Angebots für die App (base64), jedes Mal frisch aus Lexware. Sie teilt es per Teilen-Menü direkt
// in den WhatsApp-Chat. Wurde das Angebot in Lexware bearbeitet (neue Version), ziehen Summe und PDF-Kopie im Drive nach.
function angebotPdf(d) {
  const key = 'ANGEBOT_' + d.id, a = JSON.parse(props().getProperty(key) || 'null');
  if (!a) throw fehler('weg', 'Zu diesem Lead gibt es noch kein Angebot.');
  const id = a.link.split('/').pop(), q = lex('/v1/quotations/' + id);
  a.nr = q.voucherNumber || a.nr;
  const blob = lex('/v1/quotations/' + id + '/file', null, 'get', true).setName('Angebot ' + a.nr + '.pdf');
  if (q.version !== a.version) {
    if (a.version != null) a.geaendert = berlin(new Date(q.updatedDate || Date.now()), 'yyyy-MM-dd');
    a.version = q.version;
    if ((q.totalPrice || {}).totalGrossAmount != null) a.summe = q.totalPrice.totalGrossAmount;
    try {
      const datei = fotoOrdner(d.id, true).createFile(blob), alt = (String(a.pdf).match(/\/d\/([\w-]+)/) || [])[1];
      try { datei.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) { }
      if (alt) try { DriveApp.getFileById(alt).setTrashed(true); } catch (e) { }   // alte Fassung in den Papierkorb
      a.pdf = datei.getUrl();
    } catch (e) { console.warn('Angebot ' + id + ': ' + e.message); }
    props().setProperty(key, JSON.stringify(a));
  }
  return { nr: a.nr, daten: Utilities.base64Encode(blob.getBytes()), angebot: a };
}
