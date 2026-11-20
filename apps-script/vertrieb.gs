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
 *
 * Bereitstellen: Bereitstellen > Neue Bereitstellung > Web-App,
 *   Ausführen als: Ich, Zugriff: Jeder. Die URL kommt in config.js der App.
 */
const STATUS = ['Offen', 'Zurückrufen', 'Terminiert', 'Nicht erreicht', 'Unqualifiziert', 'Auftrag']; // wie das Dropdown in lead_status
const TECHNIK = ['id', 'created_time', 'ad_id', 'ad_name', 'adset_id', 'adset_name', 'campaign_id', 'campaign_name',
  'form_id', 'form_name', 'is_organic', 'platform', 'full_name', 'phone_number', 'lead_status', 'Notiz', 'Notizen', 'Termin'];
const MUELL = new Set(TECHNIK.concat(['CREATED', 'email'])); // was Meta beim Eintragen in falsche Zellen schreibt
const KI_EINTRAG = /^\d\d\.\d\d\.\d\d \d\d:\d\d KI: /;

function doGet() {
  return ContentService.createTextOutput('JD Vertrieb Schnittstelle läuft.');
}

function doPost(e) {
  let out;
  try {
    const d = JSON.parse(e.postData.contents);
    pruefe(d.pw);
    const aktion = { liste, speichern, ki, feedback }[d.aktion];
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
    if (h && !TECHNIK.includes(h) && v && !MUELL.has(v)) antworten.push([gross(h.replace(/_/g, ' ')), gross(v)]);
  });
  const status = text('lead_status');
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
  return { leads, tabellen, heimUrl: SpreadsheetApp.getActiveSpreadsheet().getUrl() };
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
    'zusammenfassung: 2 bis 4 kurze Sätze. Was will der Kunde, welches Fahrzeug, Budget oder Paket, wie ist die Stimmung.\n' +
    'naechster_schritt: ein Satz, was das Team als Nächstes tun soll.\n' +
    'status: der passende Status für den Lead.\n' +
    'naechster_kontakt: Datum im Format YYYY-MM-DD, wenn ein Rückruf oder Termin vereinbart oder sinnvoll ist, sonst leer.',
    text,
    {
      type: 'object',
      properties: {
        zusammenfassung: { type: 'string' },
        naechster_schritt: { type: 'string' },
        status: { type: 'string', enum: STATUS },
        naechster_kontakt: { type: 'string' },
      },
      required: ['zusammenfassung', 'naechster_schritt', 'status', 'naechster_kontakt'],
      additionalProperties: false,
    }
  );
  const lead = speichern({ id: d.id, ki: r.zusammenfassung + '\nNächster Schritt: ' + r.naechster_schritt }).lead;
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
