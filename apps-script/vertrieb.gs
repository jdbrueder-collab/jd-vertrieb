/**
 * JD Vertrieb: Schnittstelle zwischen der App und dem Sheet "JD Brüder Leads".
 * Liegt als zweite Datei im selben Apps-Script-Projekt wie leads-google-sheet.gs.
 *
 * Skripteigenschaften (Projekteinstellungen > Skripteigenschaften):
 *   TEAM_PASSWORT      Passwort, mit dem sich das Team in der App anmeldet
 *   ANTHROPIC_API_KEY  Claude-Schlüssel für die KI-Zusammenfassung (beginnt mit sk-ant-api)
 *
 * Bereitstellen: Bereitstellen > Neue Bereitstellung > Web-App,
 *   Ausführen als: Ich, Zugriff: Jeder. Die URL kommt in config.js der App.
 */
const STATUS = ['Neu', 'Nicht erreicht', 'Rückruf', 'Termin', 'Kunde', 'Kein Interesse'];
const ZUSATZ = ['Notizen', 'KI-Zusammenfassung', 'Nächster Kontakt', 'Zuletzt bearbeitet'];
const FELD = { // Spaltenname im Sheet → Feld in der App
  'Lead-ID': 'id', 'Datum': 'datum', 'Name': 'name', 'Telefon': 'telefon', 'Interesse': 'interesse',
  'Fahrzeug': 'fahrzeug', 'Anzeige': 'anzeige', 'WhatsApp-Link': 'wa', 'Status': 'status',
  'Notizen': 'notizen', 'KI-Zusammenfassung': 'ki', 'Nächster Kontakt': 'naechster', 'Zuletzt bearbeitet': 'bearbeitet',
};

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
const tz = () => Session.getScriptTimeZone();
const jetzt = () => Utilities.formatDate(new Date(), tz(), 'dd.MM.yy HH:mm');

// Nach 10 falschen Passwörtern ist 10 Minuten Pause, damit niemand durchprobieren kann.
function pruefe(pw) {
  const cache = CacheService.getScriptCache();
  const fehl = Number(cache.get('fehlversuche') || 0);
  if (fehl >= 10) throw fehler('pw', 'Zu viele Fehlversuche. Probier es in 10 Minuten nochmal.');
  const soll = PropertiesService.getScriptProperties().getProperty('TEAM_PASSWORT');
  if (!soll) throw fehler('setup', 'TEAM_PASSWORT fehlt in den Skripteigenschaften.');
  if (pw !== soll) { cache.put('fehlversuche', String(fehl + 1), 600); throw fehler('pw', 'Falsches Passwort.'); }
}

// Tabelle lesen. Fehlende Zusatzspalten und Lead-IDs (z. B. von Hand eingetragene Leads) werden ergänzt.
function tabelle() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
  let kopf = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  const fehlt = ZUSATZ.filter((s) => !kopf.includes(s));
  if (fehlt.length) {
    sheet.getRange(1, kopf.length + 1, 1, fehlt.length).setValues([fehlt]);
    kopf = kopf.concat(fehlt);
  }
  const werte = sheet.getLastRow() > 1 ? sheet.getRange(2, 1, sheet.getLastRow() - 1, kopf.length).getValues() : [];
  const sp = (name) => kopf.indexOf(name);
  werte.forEach((z, i) => {
    if (sp('Lead-ID') < 0 || z[sp('Lead-ID')] || !(z[sp('Name')] || z[sp('Telefon')])) return;
    z[sp('Lead-ID')] = 'manuell-' + Utilities.getUuid().slice(0, 8);
    sheet.getRange(i + 2, sp('Lead-ID') + 1).setValue(z[sp('Lead-ID')]);
  });
  return { sheet, kopf, werte, sp };
}

function alsLead(kopf, z) {
  const l = {};
  kopf.forEach((name, i) => {
    const f = FELD[name]; if (!f) return;
    let v = z[i];
    if (v instanceof Date) v = f === 'naechster' ? Utilities.formatDate(v, tz(), 'yyyy-MM-dd') : v.toISOString();
    l[f] = String(v === null || v === undefined ? '' : v);
  });
  if (!l.status) l.status = 'Neu';
  return l;
}

function liste() {
  const t = tabelle();
  const leads = t.werte.map((z) => alsLead(t.kopf, z)).filter((l) => l.id);
  leads.sort((a, b) => String(b.datum).localeCompare(String(a.datum)));
  return { leads, sheetUrl: SpreadsheetApp.getActiveSpreadsheet().getUrl() };
}

// Status, nächsten Kontakt und neue Notiz speichern. Notizen werden mit Zeit und Name angehängt, nie überschrieben.
function speichern(d) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const t = tabelle();
    const i = t.werte.findIndex((z) => String(z[t.sp('Lead-ID')]) === String(d.id));
    if (i < 0) throw fehler('weg', 'Diesen Lead gibt es im Sheet nicht mehr.');
    const z = t.werte[i];
    const wer = String(d.wer || '').trim() || 'Team';
    // Nur die geänderten Zellen schreiben, damit Formeln und Spalten, die die App nicht kennt, unberührt bleiben.
    const setze = (spalte, wert) => { z[t.sp(spalte)] = wert; t.sheet.getRange(i + 2, t.sp(spalte) + 1).setValue(wert); };
    if (d.status !== undefined) {
      if (!STATUS.includes(d.status)) throw fehler('status', 'Unbekannter Status.');
      setze('Status', d.status);
    }
    if (d.naechster !== undefined) {
      if (d.naechster && !/^\d{4}-\d{2}-\d{2}$/.test(d.naechster)) throw fehler('datum', 'Ungültiges Datum.');
      setze('Nächster Kontakt', d.naechster ? new Date(d.naechster + 'T12:00:00') : '');
    }
    if (d.ki !== undefined) setze('KI-Zusammenfassung', String(d.ki));
    const notiz = String(d.notiz || '').trim();
    if (notiz) {
      const alt = String(z[t.sp('Notizen')] || '');
      setze('Notizen', (alt ? alt + '\n\n' : '') + jetzt() + ' ' + wer + ': ' + notiz);
    }
    setze('Zuletzt bearbeitet', jetzt() + ' ' + wer);
    return { lead: alsLead(t.kopf, z) };
  } finally {
    lock.releaseLock();
  }
}

// Claude fasst alle Notizen zum Lead zusammen und schlägt Status und nächsten Kontakt vor.
function ki(d) {
  const t = tabelle();
  const z = t.werte.find((r) => String(r[t.sp('Lead-ID')]) === String(d.id));
  if (!z) throw fehler('weg', 'Diesen Lead gibt es im Sheet nicht mehr.');
  const l = alsLead(t.kopf, z);
  if (!l.notizen.trim()) throw fehler('leer', 'Es gibt noch keine Notizen zum Zusammenfassen.');
  const heute = Utilities.formatDate(new Date(), tz(), "EEEE, yyyy-MM-dd");
  const text = [
    'Heute ist ' + heute + '.',
    'Lead: ' + l.name + ', Fahrzeug: ' + (l.fahrzeug || 'unbekannt') + ', Interesse laut Formular: ' + (l.interesse || 'unbekannt') + '.',
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
  const kiText = r.zusammenfassung + '\nNächster Schritt: ' + r.naechster_schritt;
  const lead = speichern({ id: d.id, wer: d.wer, ki: kiText }).lead;
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

// Feedback-Lampe: landet im Reiter "Feedback".
function feedback(d) {
  const text = String(d.text || '').trim();
  if (!text) throw fehler('leer', 'Schreib erst etwas.');
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName('Feedback');
  if (!sh) { sh = ss.insertSheet('Feedback'); sh.appendRow(['Datum', 'Wer', 'Art', 'Text']); }
  sh.appendRow([new Date(), String(d.wer || ''), String(d.art || ''), text]);
  return {};
}
