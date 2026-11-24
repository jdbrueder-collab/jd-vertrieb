// Oberfläche von JD Vertrieb. Die Daten liegen im Google Sheet, apps-script/vertrieb.gs liefert und speichert sie.
// Aufbau wie Dayliner: render() zeichnet die Seite des aktiven Tabs, sheet() öffnet ein Bottom-Sheet.
const VERSION = '35';
const PUSH_KEY = 'BBwu63Ow659Pf2usYbfTzsyorECngHUxD1P_Z8TrggWHDYfXmY3ivuQW8CFvfs83cd7pRvfmwgalEz1mcWpnlIM'; // öffentlicher Schlüssel des Push-Dienstes (push/)
// Wie das Dropdown lead_status in den Lead-Tabellen. Neu = Status leer, da hat sich noch niemand gekümmert.
const STATUS = { 'Neu': 'var(--accent)', 'Offen': 'var(--blue)', 'Nicht erreicht': 'var(--near)', 'Zurückrufen': 'var(--pink)', 'Terminiert': 'var(--teal)', 'Auftrag': 'var(--ok)', 'Unqualifiziert': 'var(--grau)' };
const AKTIV = ['Neu', 'Offen', 'Nicht erreicht', 'Zurückrufen', 'Terminiert'];
const WD = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const ICON = {
  phone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 1.6 4.2 2 2 0 0 1 3.6 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L7.5 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.8 2z"/></svg>',
  wa: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22z"/></svg>',
  refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-9-9c2.5 0 4.8 1 6.5 2.6L21 8"/><path d="M21 3v5h-5"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
};
const $ = s => document.querySelector(s);
const view = $('#view');
const pad = n => String(n).padStart(2, '0');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const js = v => esc(JSON.stringify(v));   // Wert sicher in onclick="…" einsetzen
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const heute = () => ymd(new Date());
const morgen = () => ymd(new Date(Date.now() + 864e5));
const DEMO = !window.JD_API || new URLSearchParams(location.search).has('demo');
const lies = (k, f) => { try { return JSON.parse(localStorage.getItem(k)) ?? f; } catch (e) { return f; } };
const merke = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } };

let konto = lies('jdv-konto', { name: '', pw: '' });
let leads = [], tabellen = [], heimUrl = '', stand = null, laedt = false, fehlerText = '';
let tab = 'anrufen', filter = 'Aktiv', suche = '';
let offen = null;            // Lead, der gerade im Sheet offen ist
const vorschlag = {};        // KI-Vorschläge je Lead
const fotoCache = {}, fotoStand = {}, fotoRest = {};   // Fotos je Lead, laufender Upload, nicht hochgeladene Fotos
// Texte an Kunden (Setup → Nachrichten an Kunden). Gelten fürs ganze Team und liegen im Google-Skript, sonst gilt der Standard.
const TEXT_STANDARD = {
  WA_VORLAGE: 'Hallo {Name}, hier ist {Ich} von JD Brüder. Ich habe gerade versucht, dich wegen deiner Anfrage zum Thema {Wunsch} anzurufen. Wann passt es dir am besten für einen kurzen Rückruf?',
  TEXT_ANGEBOT_WA: 'Hallo {Name}, hier ist dein Angebot {Nr} von JD Brüder. Meld dich gern, wenn du Fragen hast.',
  TEXT_MAIL_BETREFF: 'Dein Angebot {Nr} von JD Brüder',
  TEXT_MAIL: 'Hallo {Name},\n\nim Anhang findest du dein Angebot {Nr}.\n\nMeld dich gern, wenn du Fragen hast.\n\nViele Grüße\n{Ich}\nJD Brüder',
};
let texte = { ...TEXT_STANDARD }, skriptAlt = false;   // skriptAlt: Google-Skript ohne „texte“, kann nur den Nicht-erreicht-Text
// Lexware: Angebot und Kundendaten (nur sichtbar, wenn im Google-Skript ein Schlüssel hinterlegt ist)
const LEX_APP = 'https://app.lexware.de/permalink/';
let lexAn = false, lexArtikelCache = null, angebot = null;   // angebot: gerade offene Angebotsseite
// E-Mail und Adresse je Lead (aus Lexware oder gerade eingetippt), Speichern mit kurzer Pause; PDF des letzten Angebots fertig zum Teilen
const kundeCache = {}, kundeUhr = {}, kundeStand = {}, pdfCache = {};   // kundeStand: zuletzt aus Lexware geladen oder dorthin gespeichert
const waFrage = {};          // Leads, bei denen gerade die Frage „Jetzt per WhatsApp schreiben?“ steht
let ziel = decodeURIComponent((location.hash.match(/^#lead=(.+)$/) || [])[1] || '');   // Tipp auf eine Benachrichtigung
if (ziel) history.replaceState(null, '', location.pathname + location.search);
const angemeldet = () => DEMO || !!konto.pw;

// ---------- Server ----------
async function api(aktion, daten = {}) {
  if (DEMO) return demoApi(aktion, daten);
  let r;
  try { r = await fetch(window.JD_API, { method: 'POST', body: JSON.stringify({ aktion, pw: konto.pw, wer: konto.name, ...daten }) }); }
  catch (e) { throw new Error('Keine Verbindung. Bist du online?'); }
  const j = await r.json().catch(() => ({ ok: false, fehler: 'Unerwartete Antwort vom Server.' }));
  if (!j.ok) throw Object.assign(new Error(j.fehler || 'Fehler'), { code: j.code });
  return j;
}
function uebernimm(j) { leads = j.leads; tabellen = j.tabellen || []; heimUrl = j.heimUrl || ''; texte = { ...TEXT_STANDARD, ...j.texte }; skriptAlt = !DEMO && !j.texte; lexAn = DEMO || !!j.lexware; stand = new Date(); }
async function laden(still) {
  if (!angemeldet() || laedt) return;
  if (!still) for (const k in statCache) delete statCache[k];   // Aktualisieren holt auch Meta und Lexware neu
  laedt = true; $('.roundbtn')?.classList.add('spin');
  try {
    const j = await api('liste');
    const vorher = new Set(leads.map(l => l.id));
    const neu = j.leads.filter(l => !vorher.has(l.id));
    if (stand && neu.length) { toast(neu.length === 1 ? `🔔 Neuer Lead: ${neu[0].name}` : `🔔 ${neu.length} neue Leads`); haptic(); }
    uebernimm(j); fehlerText = '';
  } catch (e) {
    if (e.code === 'pw') return abmelden(e.message);
    fehlerText = e.message; if (!still) toast(e.message);
  } finally { laedt = false; }
  // Wer gerade tippt (Suche, Name), verliert durch das Nachladen nicht den Cursor
  if (view.contains(document.activeElement) && document.activeElement.matches('input,textarea')) { if ($('#liste')) $('#liste').innerHTML = listeHtml(); }
  else render();
  if (ziel && leads.some(l => l.id === ziel)) { const z = ziel; ziel = ''; openLead(z); }
}

// ---------- Navigation ----------
function render() {
  const an = angemeldet();
  $('.tabs').hidden = !an; $('#fbbtn').hidden = !an;
  if (!an) return renderLogin();
  document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  requestAnimationFrame(moveTabInd);
  ({ anrufen: renderAnrufen, alle: renderAlle, statistik: renderStatistik, setup: renderSetup })[tab]();
  const th = $('#thema');   // offenes Setup-Fenster mitziehen, außer man tippt gerade darin
  if (th && !th.querySelector('input:focus')) th.outerHTML = themaHtml(th.dataset.id);
  if (DEMO) view.insertAdjacentHTML('afterbegin', '<div class="demo">Demo mit Beispiel-Leads. Noch nicht mit dem Sheet verbunden.</div>');
  const n = leads.filter(l => faellig(l) || l.status === 'Neu').length, b = $('[data-tab=anrufen]');
  b.querySelector('.badge')?.remove();
  if (n) b.insertAdjacentHTML('beforeend', `<span class="badge">${n > 99 ? '99+' : n}</span>`);
}
function go(t) { tab = t; render(); view.scrollTop = 0; }

// ---------- Hilfen für Leads ----------
const faellig = l => AKTIV.includes(l.status) && l.naechster && l.naechster <= heute();
const telLink = l => 'tel:' + String(l.telefon).replace(/[^\d+]/g, '');
const datumKurz = s => { const d = new Date(s + 'T12:00'); return `${WD[d.getDay()]} ${pad(d.getDate())}.${pad(d.getMonth() + 1)}.`; };
function wann(l) {
  if (AKTIV.includes(l.status) && l.naechster) {
    const h = heute();
    if (l.naechster < h) return `<span class="when due">seit ${datumKurz(l.naechster).slice(3)}</span>`;
    if (l.naechster === h) return '<span class="when due">Heute</span>';
    return `<span class="when">${l.naechster === morgen() ? 'Morgen' : datumKurz(l.naechster)}</span>`;
  }
  return `<span class="when">${relativ(l.datum)}</span>`;
}
function relativ(iso) {
  const d = new Date(iso); if (isNaN(d)) return '';
  const min = Math.round((Date.now() - d) / 6e4);
  if (min < 1) return 'gerade';
  if (min < 60) return `vor ${min} Min`;
  if (ymd(d) === heute()) return `vor ${Math.round(min / 60)} Std`;
  if (ymd(d) === ymd(new Date(Date.now() - 864e5))) return 'Gestern';
  return min < 6 * 1440 ? datumKurz(ymd(d)) : `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.`;
}
// Was der Kunde will, z. B. Referenzauto (Formularfrage „Interesse“, sonst die erste Antwort)
// WhatsApp über whatsapp:// statt wa.me: Auf Davids iPhone (privates WhatsApp und WhatsApp Business) öffnet nur so
// WhatsApp Business mit der JD-Brüder-Nummer, wa.me nimmt dort das private WhatsApp (getestet 21.11.2026).
const waLink = (l, text) => `whatsapp://send?${l?.wa ? 'phone=' + l.wa.replace(/\D/g, '') + (text ? '&' : '') : ''}${text ? 'text=' + encodeURIComponent(text) : ''}`;
const wunsch = l => (l.antworten.find(a => a[0] === 'Interesse') || l.antworten[0] || [])[1] || '';
const auto = l => (l.antworten.find(a => a[0] === 'Fahrzeug') || [])[1] || '';   // Formularfrage „Fahrzeug“
// Platzhalter in den Texten an Kunden: {Name} Vorname, {Wunsch} Formularantwort, {Nr} letztes Angebot, {Ich} wer die App nutzt
const fuelle = (t, l) => t.replaceAll('{Name}', (l.name || '').split(' ')[0]).replaceAll('{Wunsch}', wunsch(l) || 'Fahrzeugaufbereitung')
  .replaceAll('{Nr}', l.angebot?.nr || '').replaceAll('{Ich}', konto.name || 'das Team').replace(/ +,/g, ',');
const waText = l => fuelle(texte.WA_VORLAGE, l);
function leadZeile(l) {
  const info = faellig(l) && l.angebot?.gesendet ? `Angebot ${l.angebot.nr} nachfassen` : auto(l) || wunsch(l) || l.telefon;   // in der Liste das Auto, der Wunsch steht im Lead
  return `<div class="lead">
    <button class="open" onclick="openLead(${js(l.id)})"><span class="dot" style="--c:${STATUS[l.status] || STATUS.Neu}"></span>
      <span class="tt"><b>${esc(l.name || 'Ohne Namen')}</b><span>${esc(info)}</span></span>${wann(l)}</button>
    ${l.wa ? `<a class="callbtn wa" href="${esc(waLink(l))}" aria-label="${esc(l.name)} auf WhatsApp schreiben">${ICON.wa}</a>` : ''}
    ${l.telefon ? `<a class="callbtn" href="${esc(telLink(l))}" onclick="anruf(event, ${js(l.id)})" aria-label="${esc(l.name)} anrufen">${ICON.phone}</a>` : ''}
  </div>`;
}
const block = (titel, liste) => liste.length ? `<div class="label">${titel}</div><div class="group">${liste.map(leadZeile).join('')}</div>` : '';
function kopf(titel) {
  return `<div class="phead"><h1>${titel}</h1><button class="roundbtn pill ${laedt ? 'spin' : ''}" onclick="laden()" aria-label="Aktualisieren">${ICON.refresh}</button></div>
  <p class="stand">${fehlerText ? `<span style="color:var(--minus)">${esc(fehlerText)}</span>` : stand ? `Stand ${pad(stand.getHours())}:${pad(stand.getMinutes())} Uhr` : 'Lädt…'}${tabellen.some(t => t.fehler) ? ' · <span style="color:var(--minus)">Eine Tabelle klemmt, siehe Setup</span>' : ''}</p>`;
}

// ---------- Tab: Anrufen ----------
function renderAnrufen() {
  const faell = leads.filter(faellig).sort((a, b) => a.naechster.localeCompare(b.naechster));
  const neu = leads.filter(l => l.status === 'Neu' && !faellig(l));
  const nochmal = leads.filter(l => !faellig(l) && (['Offen', 'Nicht erreicht'].includes(l.status) || (l.status === 'Zurückrufen' && !l.naechster)));
  const woche = leads.filter(l => Date.now() - new Date(l.datum) < 7 * 864e5).length;
  view.innerHTML = kopf('Anrufen') + (!stand && laedt ? '<p class="loading">Leads werden geladen…</p>' : `
    <div class="tiles">
      <div class="tile"><b>${woche}</b><span>Diese Woche</span></div>
      <div class="tile"><b>${leads.filter(l => AKTIV.includes(l.status)).length}</b><span>Aktiv</span></div>
      <div class="tile"><b>${leads.filter(l => l.status === 'Terminiert').length}</b><span>Termine</span></div>
    </div>
    ${block('Fällig', faell)}${block('Neu', neu)}${block('Nochmal versuchen', nochmal)}
    ${stand && !DEMO && !tabellen.length ? `<div class="card empty"><b>📊</b>Noch keine Lead-Tabelle verbunden. <button class="pill wide" style="margin-top:var(--gap)" onclick="go('setup')">Zum Setup</button></div>`
      : faell.length + neu.length + nochmal.length ? '' : '<div class="card empty"><b>🎉</b>Alles erledigt. Gerade wartet niemand auf einen Anruf.</div>'}`);
}

// ---------- Tab: Alle ----------
function gefiltert() {
  const q = suche.trim().toLowerCase();
  return leads.filter(l => (filter === 'Alle' || (filter === 'Aktiv' ? AKTIV.includes(l.status) : l.status === filter))
    && (!q || [l.name, l.telefon, l.notizen, ...l.antworten.map(a => a[1])].join(' ').toLowerCase().includes(q)));
}
function listeHtml() {
  const l = gefiltert();
  return l.length ? `<div class="group">${l.map(leadZeile).join('')}</div>` : '<div class="card empty">Keine Leads gefunden.</div>';
}
function renderAlle() {
  const anzahl = f => leads.filter(l => f === 'Alle' || (f === 'Aktiv' ? AKTIV.includes(l.status) : l.status === f)).length;
  view.innerHTML = kopf('Alle Leads') + `
    <label class="search">${ICON.search}<input type="search" placeholder="Name, Nummer, Fahrzeug" value="${esc(suche)}" oninput="suche=this.value;$('#liste').innerHTML=listeHtml()" aria-label="Leads durchsuchen"></label>
    <div class="scroller">${['Aktiv', 'Alle', ...Object.keys(STATUS)].map(f => `<button class="pill ${f === filter ? 'sel' : ''}" onclick="filter=${js(f)};render()">${f} <span class="n">${anzahl(f)}</span></button>`).join('')}</div>
    <div id="liste">${listeHtml()}</div>`;
}

// ---------- Tab: Setup ----------
// Aufbau wie in der Stempeluhr: Themenliste, jedes Thema öffnet ein eigenes Fenster
const NACHRICHTEN = {
  WA_VORLAGE: { titel: 'WhatsApp: Nicht erreicht', kurz: 'Nicht erreicht', icon: '💬', sub: 'Wenn du jemanden nicht erreichst', felder: ['{Name}', '{Wunsch}', '{Ich}'] },
  TEXT_ANGEBOT_WA: { titel: 'WhatsApp: Angebot', kurz: 'Angebot', icon: '📄', sub: 'Text zum PDF im Chat', felder: ['{Name}', '{Nr}', '{Ich}'], pdf: true },
  TEXT_MAIL: { titel: 'Mail: Angebot', kurz: 'Angebotsmail', icon: '✉️', sub: 'Betreff und Text, PDF im Anhang', felder: ['{Name}', '{Nr}', '{Ich}'], mail: true },
};
function setupThemen() {
  const klemmt = tabellen.filter(t => t.fehler).length;
  return [
    [['du', '👤', 'Du', konto.name ? esc(konto.name) + ' · steht bei deinen Notizen' : 'Dein Name für die Notizen']],
    [
      ['tabellen', '📊', 'Lead-Tabellen', klemmt ? `<span style="color:var(--minus)">${klemmt === 1 ? 'Eine Tabelle klemmt' : klemmt + ' Tabellen klemmen'}</span>` : `${tabellen.length} verbunden · neue Kampagne verbinden`],
      ['lexware', '🧾', 'Lexware', lexAn ? 'Artikel im Angebot, Kunden, Verbindung' : 'Nicht verbunden'],
    ],
    Object.entries(NACHRICHTEN).map(([k, n]) => [k, n.icon, n.titel, n.sub]),
    [
      ['design', '🎨', 'Design', 'Dunkel oder hell, Gold im Hintergrund'],
      ['app', '📲', 'App', 'Startbildschirm, Benachrichtigungen · Version ' + VERSION],
    ],
  ];
}
// ---------- Tab: Statistik ----------
// Leads, Quellen und Status zählt die App selbst. Meta-Ausgaben, Angebote und Rechnungen (Lexware) holt das Skript.
// ROAS rechnet die App, weil nur sie weiß, welche Lexware-Kunden über einen Meta-Lead kamen (l.lex).
let statZeit = 'monat';
const statCache = {};   // "von_bis" → { laedt, meta, angebote, rechnungen, fehler }
const ZEITEN = { tage7: '7 Tage', monat: 'Monat', vormonat: 'Vormonat', alles: 'Alles' };
const QUELLEN = { Instagram: 'var(--pink)', Facebook: 'var(--blue)', Website: 'var(--accent)', Sonstige: 'var(--grau)' };
const quelleVon = l => QUELLEN[l.quelle] && l.quelle !== 'Sonstige' ? l.quelle : 'Sonstige';
const istMeta = l => l.quelle === 'Instagram' || l.quelle === 'Facebook';
const euro0 = n => Math.round(Number(n) || 0).toLocaleString('de-DE') + ' €';
const proz = (a, b) => b ? Math.round(a / b * 100) + ' %' : '–';
const tag10 = l => String(l.datum).slice(0, 10);
function statZeitraum(z) {
  const d = new Date(), j = d.getFullYear(), m = d.getMonth();
  if (z === 'tage7') return { von: ymd(new Date(j, m, d.getDate() - 6)), bis: ymd(d) };
  if (z === 'monat') return { von: ymd(new Date(j, m, 1)), bis: ymd(d) };
  if (z === 'vormonat') return { von: ymd(new Date(j, m - 1, 1)), bis: ymd(new Date(j, m, 0)) };
  return { von: leads.map(tag10).filter(Boolean).sort()[0] || '', bis: ymd(d) };   // Alles = seit dem ersten Lead
}
// Kreisdiagramm: Teile mit etwas Luft dazwischen, in der Mitte die Summe. Die Zahlen stehen immer auch in der Legende.
function torte(teile, mitte, unter, breit) {   // breit: Legende braucht Platz (Beträge), auf dem Handy dann unter dem Kreis
  const summe = teile.reduce((s, t) => s + t.wert, 0), luft = teile.filter(t => t.wert).length > 1 ? 1.2 : 0;
  let ab = 25;   // oben anfangen
  const ringe = teile.filter(t => t.wert).map(t => {
    const anteil = t.wert / summe * 100, r = `<circle cx="21" cy="21" r="15.915" fill="none" stroke="${t.farbe}" stroke-width="5.5" stroke-dasharray="${Math.max(anteil - luft, .5)} ${100 - Math.max(anteil - luft, .5)}" stroke-dashoffset="${ab}"><title>${esc(t.name)}: ${esc(t.text)} (${proz(t.wert, summe)})</title></circle>`;
    ab -= anteil; return r;
  }).join('');
  return `<div class="torte"><svg viewBox="0 0 42 42" role="img" aria-label="${esc(teile.map(t => `${t.name} ${t.text}`).join(', '))}">
      <circle cx="21" cy="21" r="15.915" fill="none" stroke="var(--line)" stroke-width="5.5"/>${ringe}
      <text x="21" y="${unter ? 21 : 22.6}" text-anchor="middle" class="t-mitte" style="font-size:${mitte.length > 5 ? 4.6 : 6.5}px">${esc(mitte)}</text>${unter ? `<text x="21" y="26" text-anchor="middle" class="t-unter">${esc(unter)}</text>` : ''}</svg>
    <ul class="legende"${breit ? ' style="min-width:220px"' : ''}>${teile.map(t => `<li><span class="dot" style="--c:${t.farbe}"></span><span>${esc(t.name)}</span><b>${esc(t.text)}</b><span class="muted">${proz(t.wert, summe)}</span></li>`).join('')}</ul></div>`;
}
// Säulen pro Tag (bis 31 Tage) oder pro Woche, gestapelt nach Gruppe. eintraege: [{ t: 'yyyy-mm-dd', g: Gruppe, w: Wert }]
function saeulen(titel, eintraege, von, bis, farben, zahl, zusatz = '') {
  if (!eintraege.length) return '';
  const start = new Date((von || eintraege.map(e => e.t).sort()[0]) + 'T12:00'), ende = new Date(bis + 'T12:00');
  const woche = Math.round((ende - start) / 864e5) + 1 > 31;
  const schluessel = d => { const x = new Date(d); if (woche) x.setDate(x.getDate() - (x.getDay() + 6) % 7); return ymd(x); };
  const toepfe = new Map();
  for (let d = new Date(start); d <= ende; d.setDate(d.getDate() + 1)) toepfe.set(schluessel(d), {});
  eintraege.forEach(e => { const t = toepfe.get(schluessel(new Date(e.t + 'T12:00'))); if (t) t[e.g] = (t[e.g] || 0) + e.w; });
  const liste = [...toepfe].slice(-26), summe = t => Object.values(t).reduce((a, b) => a + b, 0), max = Math.max(...liste.map(([, t]) => summe(t))) || 1;
  const name = k => woche ? 'Woche ab ' + datumKurz(k) : datumKurz(k);
  return `<div class="card"><p class="kartenkopf"><b>${titel} pro ${woche ? 'Woche' : 'Tag'}${zusatz}</b><span class="muted">höchstens ${zahl(max)}</span></p>
    <div class="saeulen">${liste.map(([k, t]) => `<span title="${esc(name(k))}: ${esc(zahl(summe(t)))}" aria-label="${esc(name(k))}: ${esc(zahl(summe(t)))}">${Object.keys(farben).filter(g => t[g]).map(g => `<i style="height:${t[g] / max * 100}%;background:${farben[g]}"></i>`).join('')}</span>`).join('')}</div>
    <p class="achse muted"><span>${esc(datumKurz(liste[0][0]))}</span><span>${esc(datumKurz(liste[liste.length - 1][0]))}</span></p></div>`;
}
function renderStatistik() {
  const { von, bis } = statZeitraum(statZeit), key = von + '_' + bis, imZeitraum = t => (!von || t >= von) && t <= bis;
  const ls = leads.filter(l => imZeitraum(tag10(l)));
  let s = statCache[key];
  if (!s) {
    s = statCache[key] = { laedt: true };
    api('statistik', { von, bis }).then(j => Object.assign(s, j)).catch(e => { s.fehler = e.message; })
      .finally(() => { s.laedt = false; if (tab === 'statistik') render(); });
  }
  const meta = ls.filter(istMeta), web = ls.filter(l => l.quelle === 'Website');
  const termin = l => l.status === 'Terminiert' || l.status === 'Auftrag', erreicht = l => !['Neu', 'Nicht erreicht'].includes(l.status);
  const m = s.meta && !s.meta.fehler ? s.meta : null, ausgaben = m ? m.ausgaben : null;
  // Angebote und Rechnungen: nur Fahrzeug-Geschäft (Aufbereitung, Veredelung, Folie, Trockeneis), das sortiert das Skript aus
  const ang = Array.isArray(s.angebote) ? s.angebote : null, re = Array.isArray(s.rechnungen) ? s.rechnungen : null;
  const summe = (liste, f = () => true) => liste.filter(f).reduce((x, y) => x + y.b, 0);
  const je = (liste, st) => ({ anzahl: liste.filter(x => x.s === st).length, summe: summe(liste, x => x.s === st) });
  const wert = ang ? summe(ang) : null;
  // Rechnungen: im Zeitraum geschrieben (ohne storniert), und im Zeitraum bezahlt (Tag der Zuordnung in Lexware)
  const geschrieben = re ? re.filter(x => imZeitraum(x.d) && x.s !== 'voided' && x.s !== 'paidoff') : null;
  const bezahlt = re ? re.filter(x => x.s === 'paid' && imZeitraum(x.u)).sort((a, b) => b.u.localeCompare(a.u)) : null;
  const metaKunden = new Set(leads.filter(istMeta).map(l => l.lex).filter(Boolean)), vonMeta = x => metaKunden.has(x.k);
  const roas = x => ausgaben && x != null ? (x / ausgaben).toLocaleString('de-DE', { maximumFractionDigits: 1 }) + '×' : '–';
  const reMeta = geschrieben ? summe(geschrieben, vonMeta) : null;
  const geld = (x, fehlt) => x == null ? (s.laedt ? '…' : fehlt || '–') : euro(x);
  const pro = n => ausgaben != null && n ? euro(ausgaben / n) : '–';
  const leer = text => `<p class="muted" style="margin:0">${s.laedt ? 'Lädt…' : text}</p>`;
  const hinweis = (teil, was) => !s.laedt && (s.fehler || s[teil]?.fehler) ? `<p class="hint">${esc(was)}: ${esc(s.fehler || s[teil].fehler)}</p>` : '';
  const zeile = (name, farbe, f) => `<tr><td>${farbe ? `<span class="dot" style="--c:${farbe}"></span>` : ''}${esc(name)}</td><td>${meta.filter(f).length}</td><td>${web.filter(f).length}</td><td><b>${ls.filter(f).length}</b></td></tr>`;
  const weg = [['Leads', ls.length], ['Erreicht', ls.filter(erreicht).length], ['Termin', ls.filter(termin).length], ['Auftrag', ls.filter(l => l.status === 'Auftrag').length]];
  view.innerHTML = kopf('Statistik') + `
    <div class="zeitwahl" role="group" aria-label="Zeitraum">${Object.entries(ZEITEN).map(([k, n]) => `<button class="pill${k === statZeit ? ' sel' : ''}" aria-pressed="${k === statZeit}" onclick="statZeit='${k}';render()">${n}</button>`).join('')}</div>
    <div class="kpis">
      <div class="tile"><b>${geld(ausgaben, 'fehlt')}</b><span>Ausgaben Meta</span></div>
      <div class="tile"><b>${ls.length}</b><span>Leads · Meta ${meta.length}, Web ${web.length}</span></div>
      <div class="tile"><b>${ausgaben == null ? geld(null) : pro(meta.length)}</b><span>Kosten pro Lead</span></div>
      <div class="tile"><b>${s.laedt && !m ? '…' : roas(reMeta)}</b><span>ROAS (Rechnungen)</span></div>
      <div class="tile"><b>${geld(wert)}</b><span>Angebotswert${ang ? ` · ${ang.length} Stück` : ''}</span></div>
      <div class="tile"><b>${geld(bezahlt && summe(bezahlt))}</b><span>Eingenommen</span></div>
    </div>
    ${hinweis('meta', 'Meta')}${hinweis('angebote', 'Lexware Angebote')}${hinweis('rechnungen', 'Lexware Rechnungen')}
    ${!ls.length ? '<div class="card empty">In diesem Zeitraum sind keine Leads gekommen.</div>' : `
    <div class="card"><p class="kartenkopf"><b>Woher die Leads kommen</b></p>
      ${torte(Object.entries(QUELLEN).map(([q, farbe]) => ({ name: q, farbe, wert: ls.filter(l => quelleVon(l) === q).length })).filter(t => t.wert || t.name !== 'Sonstige').map(t => ({ ...t, text: String(t.wert) })), String(ls.length), ls.length === 1 ? 'Lead' : 'Leads')}</div>
    <div class="card"><p class="kartenkopf"><b>Was aus den Leads wurde</b></p>
      <table class="stab"><thead><tr><th>Status</th><th>Meta</th><th>Web</th><th>Gesamt</th></tr></thead><tbody>
        ${Object.entries(STATUS).map(([st, farbe]) => zeile(st, farbe, l => l.status === st)).join('')}
      </tbody><tfoot>${zeile('Alle', '', () => true)}</tfoot></table></div>
    <div class="card"><p class="kartenkopf"><b>Vom Lead zum Auftrag</b></p>
      <div class="weg">${weg.map(([n, z]) => `<div><span>${n}</span><span class="spur"><i style="width:${ls.length ? z / ls.length * 100 : 0}%"></i></span><b>${z}</b><span class="muted">${proz(z, ls.length)}</span></div>`).join('')}</div>
      <p class="hint" style="margin:var(--gap) 0 0">Erreicht heißt: nicht mehr Neu und nicht „Nicht erreicht“. Termin zählt Terminiert und Auftrag.</p></div>
    ${saeulen('Leads', ls.map(l => ({ t: tag10(l), g: quelleVon(l), w: 1 })), von, bis, QUELLEN, String)}`}
    <div class="card"><p class="kartenkopf"><b>ROAS</b><span class="muted">Return on Ad Spend</span></p>
      ${m && ang && re ? `<table class="stab"><thead><tr><th>Aus Meta-Leads</th><th>Betrag</th><th>ROAS</th></tr></thead><tbody>
        <tr><td>Angebote offen und angenommen</td><td>${euro0(summe(ang, x => vonMeta(x) && x.s !== 'rejected'))}</td><td><b>${roas(summe(ang, x => vonMeta(x) && x.s !== 'rejected'))}</b></td></tr>
        <tr><td>Rechnungen geschrieben</td><td>${euro0(reMeta)}</td><td><b>${roas(reMeta)}</b></td></tr>
        <tr><td>Rechnungen bezahlt</td><td>${euro0(summe(bezahlt, vonMeta))}</td><td><b>${roas(summe(bezahlt, vonMeta))}</b></td></tr></tbody></table>
        <p class="hint" style="margin:var(--gap) 0 0">ROAS 4× heißt: Aus 1 € Werbung wurden 4 € Umsatz (brutto). Gezählt werden nur Kunden, die über einen Meta-Lead kamen und in Lexware verknüpft sind (${metaKunden.size}). Werbung im Zeitraum: ${euro(ausgaben)}.</p>`
        : leer(m ? 'Lexware ist gerade nicht erreichbar.' : 'Dafür braucht die App die Meta-Ausgaben. Das Google-Skript braucht einen Meta-Zugriffsschlüssel (META_TOKEN).')}</div>
    <div class="card"><p class="kartenkopf"><b>Was Meta kostet</b>${m ? `<span class="muted">${m.klicks.toLocaleString('de-DE')} Klicks</span>` : ''}</p>
      ${m ? `<table class="stab"><tbody>
        <tr><td>Ausgaben</td><td><b>${euro(ausgaben)}</b></td></tr>
        <tr><td>pro Lead (${meta.length})</td><td>${pro(meta.length)}</td></tr>
        <tr><td>pro Termin (${meta.filter(termin).length})</td><td>${pro(meta.filter(termin).length)}</td></tr>
        <tr><td>pro Auftrag (${meta.filter(l => l.status === 'Auftrag').length})</td><td>${pro(meta.filter(l => l.status === 'Auftrag').length)}</td></tr>
        <tr><td>pro Klick</td><td>${pro(m.klicks)}</td></tr>
        <tr><td>Gesehen (Impressionen)</td><td>${m.impressionen.toLocaleString('de-DE')}</td></tr></tbody></table>`
        : leer('Meta ist noch nicht verbunden. Dafür braucht das Google-Skript einen Meta-Zugriffsschlüssel (META_TOKEN).')}</div>
    <div class="card"><p class="kartenkopf"><b>Rechnungen</b><span class="muted">brutto</span></p>
      ${geschrieben ? (geschrieben.length ? torte([['Bezahlt', 'var(--ok)', 'paid'], ['Offen', 'var(--blue)', 'open'], ['Überfällig', 'var(--near)', 'overdue']].map(([name, farbe, st]) => { const x = je(geschrieben, st); return { name: `${name} (${x.anzahl})`, farbe, wert: x.summe, text: euro0(x.summe) }; }), euro0(summe(geschrieben)), 'geschrieben', true)
        : leer('In diesem Zeitraum gibt es keine Rechnungen.')) : leer('Nicht verfügbar.')}
      <p class="hint" style="margin:var(--gap) 0 0">Rechnungen mit Rechnungsdatum im Zeitraum, ohne stornierte. Nur Fahrzeug (Aufbereitung, Veredelung, Folie, Trockeneis), ohne Meta Trennwand und andere Bauleistungen.${s.pruefen ? ` ${s.pruefen} Belege prüft das Skript noch, tipp gleich auf Aktualisieren.` : ''}</p></div>
    ${bezahlt ? saeulen('Eingenommen', bezahlt.map(x => ({ t: x.u, g: 'Bezahlt', w: x.b })), von, bis, { Bezahlt: 'var(--ok)' }, euro0) : ''}
    ${bezahlt?.length ? `<div class="card"><p class="kartenkopf"><b>Zuletzt bezahlt</b><span class="muted">${bezahlt.length} · ${euro0(summe(bezahlt))}</span></p>
      <table class="stab"><tbody>${bezahlt.slice(0, 8).map(x => `<tr><td><span class="muted">${esc(datumKurz(x.u))}</span>${esc(x.name || x.nr)}</td><td><b>${euro(x.b)}</b></td></tr>`).join('')}</tbody></table>
      <p class="hint" style="margin:var(--gap) 0 0">Datum: der Tag, an dem Lexware die Zahlung der Rechnung zugeordnet hat.</p></div>` : ''}
    <div class="card"><p class="kartenkopf"><b>Angebote</b><span class="muted">brutto</span></p>
      ${ang ? (wert ? torte([['Angenommen', 'var(--ok)', 'accepted'], ['Offen', 'var(--blue)', 'open'], ['Abgelehnt', 'var(--grau)', 'rejected']].map(([name, farbe, st]) => { const x = je(ang, st); return { name: `${name} (${x.anzahl})`, farbe, wert: x.summe, text: euro0(x.summe) }; }), euro0(wert), 'gesamt', true)
        : leer('In diesem Zeitraum gibt es keine Angebote.')) : leer('Nicht verfügbar.')}
      <p class="hint" style="margin:var(--gap) 0 0">Fertige Angebote mit Angebotsdatum im Zeitraum, auch die nicht über die App geschriebenen. Nur Fahrzeug, ohne Bauleistungen.</p></div>`;
}

function renderSetup() {
  view.innerHTML = `<div class="phead"><h1>Setup</h1></div>
    ${setupThemen().map((g, i) => `${i === 2 ? '<div class="label">Nachrichten an Kunden</div>' : ''}<div class="group">${g.map(([id, icon, titel, sub]) => `<button class="row thema" onclick="thema('${id}')">
      <span class="ti">${icon}</span><span class="tt"><b>${titel}</b><span class="muted small">${sub}</span></span><span>›</span></button>`).join('')}</div>`).join('')}`;
}
function thema(id) {
  if (NACHRICHTEN[id]) return textFenster(id);
  sheet(themaHtml(id));
}
function themaHtml(id) {
  const titel = { du: 'Du', tabellen: 'Lead-Tabellen', lexware: 'Lexware', design: 'Design', app: 'App' }[id];
  const inhalt = {
    du: () => `<div class="group"><label class="row"><span>Dein Name</span><input value="${esc(konto.name)}" placeholder="z. B. David" onchange="konto.name=this.value.trim();merke('jdv-konto',konto);toast('Gespeichert');this.blur();render()" autocomplete="given-name"></label></div>
      <p class="hint">Steht bei jeder Notiz dabei, damit ihr wisst, wer telefoniert hat. In den Nachrichten an Kunden wird daraus {Ich}.</p>
      ${DEMO ? '' : '<button class="pill wide" style="color:var(--minus);margin-top:var(--gap-l)" onclick="abmelden()">Abmelden</button>'}`,
    tabellen: () => `<div class="group">
      ${tabellen.map(t => t.fehler ? `<div class="row"><span>⚠️ ${esc(t.name)}</span><span style="color:var(--minus)">klemmt</span></div>`
        : t.url ? `<a class="row" href="${esc(t.url)}" target="_blank" rel="noopener"><span>📊 ${esc(t.name)}</span><span>${t.anzahl} ›</span></a>`
        : `<div class="row"><span>📊 ${esc(t.name)}</span><span>${t.anzahl}</span></div>`).join('')}
      ${heimUrl ? `<a class="row" href="${esc(heimUrl)}" target="_blank" rel="noopener"><span>➕ Tabelle verbinden</span><span>›</span></a>` : ''}
    </div>
    ${tabellen.filter(t => t.fehler).map(t => `<p class="hint" style="color:var(--minus)">${esc(t.name)}: ${esc(t.fehler)}</p>`).join('')}
    <p class="hint">Neue Kampagne? Tipp auf „Tabelle verbinden“ und setz den Link zur neuen Lead-Tabelle in die nächste freie Zeile in Spalte A.</p>`,
    lexware: () => lexAn ? `<div class="group"><button class="row" onclick="artikelWahl()"><span>Artikel im Angebot</span><span>Auswählen ›</span></button>
      ${ohneKunde().length ? `<button class="row" onclick="nachziehen(this)"><span>Offene Leads ohne Kunde</span><span>${ohneKunde().length} anlegen ›</span></button>` : ''}
      <button class="row" onclick="lexPruefen()"><span>Verbindung</span><span>Prüfen ›</span></button></div>
      <p class="hint">Neue Leads werden automatisch Kunden in Lexware. Die Auswahl der Artikel gilt fürs ganze Team.</p>`
      : '<div class="group"><div class="row"><span>🧾 Lexware</span><span>Nicht verbunden</span></div></div><p class="hint">Der Schlüssel gehört ins Google-Skript (LEXWARE_API_KEY), siehe README.</p>',
    design: () => `<div class="two">${[['dunkel', '🌙 Dunkel'], ['hell', '☀️ Hell']].map(([k, t]) => `<button class="pill ${lies('jdv-design', 'dunkel') === k ? 'sel' : ''}" aria-pressed="${lies('jdv-design', 'dunkel') === k}" onclick="designSetzen('design', '${k}')">${t}</button>`).join('')}</div>
      <div class="group"><label class="row"><span>✨ Gold im Hintergrund</span><input type="checkbox" switch ${lies('jdv-gold', true) ? 'checked' : ''} onchange="designSetzen('gold', this.checked)"></label></div>
      <p class="hint">Gilt nur für dieses Handy.</p>`,
    app: () => `<div class="group">
      <button class="row" onclick="installHilfe()"><span>📲 Auf den Startbildschirm</span><span>›</span></button>
      ${pushOk() ? `<button class="row" onclick="pushEin()"><span>🔔 Benachrichtigungen</span><span>${Notification.permission === 'granted' ? 'An' : 'Einschalten ›'}</span></button>`
        : '<div class="row"><span>🔔 Benachrichtigungen</span><span>Erst auf den Startbildschirm</span></div>'}
      <div class="row"><span>Version</span><span>${VERSION}</span></div>
    </div>`,
  }[id];
  return `<div id="thema" data-id="${id}"><div class="sheet-head"><span></span><h2>${titel}</h2><button class="pill" onclick="closeSheet()">Fertig</button></div>${inhalt()}</div>`;
}

// Setup → Nachrichten an Kunden: Text bearbeiten, darüber live, wie es beim Kunden ankommt (Beispielkunde Kevin)
const BEISPIEL = { name: 'Kevin Becker', antworten: [['Interesse', 'Referenzauto']], angebot: { nr: 'AG0052' } };
let textFeld = null;   // Betreff oder Text, je nachdem wo zuletzt getippt wurde: dort landen die Bausteine
function textFenster(k) {
  const n = NACHRICHTEN[k];
  sheet(`<div class="sheet-head"><button class="pill" onclick="closeSheet()">Abbrechen</button><h2>${n.kurz}</h2><button class="pill sel" onclick="textSpeichern('${k}', this)">Sichern</button></div>
    <div class="label">So sieht Kevin es ${n.mail ? 'im Postfach' : 'in WhatsApp'}</div>
    <div id="tvorschau"></div>
    ${n.mail ? `<div class="label">Betreff</div><input class="full" id="tbetreff" value="${esc(texte.TEXT_MAIL_BETREFF)}" oninput="textVorschau('${k}')" onfocus="textFeld=this" aria-label="Betreff">` : ''}
    <div class="label">Text</div>
    <textarea id="ttext" rows="${n.mail ? 11 : 6}" oninput="textVorschau('${k}')" onfocus="textFeld=this" aria-label="Text">${esc(texte[k])}</textarea>
    <div class="seg">${n.felder.map(f => `<button class="pill sm" onmousedown="event.preventDefault()" onclick="baustein('${f}', '${k}')">${f}</button>`).join('')}</div>
    <p class="hint">Tipp auf einen Baustein, dann steht er im Text. {Name} wird zum Vornamen, ${n.felder.includes('{Wunsch}') ? '{Wunsch} zu dem, was der Kunde will' : '{Nr} zur Angebotsnummer'}, {Ich} zu deinem Namen.${k === 'WA_VORLAGE' ? ' {Name} und {Wunsch} müssen drinbleiben.' : ''}${n.mail ? '' : ' *fett* und _schräg_ zeigt WhatsApp fett und schräg.'} Gilt fürs ganze Team.</p>
    <button class="pill wide" onclick="textStandard('${k}')">Standardtext einsetzen</button>`);
  textFeld = $('#ttext'); textVorschau(k);
}
const waFormat = t => esc(t).replace(/\*([^*\n]+)\*/g, '<b>$1</b>').replace(/_([^_\n]+)_/g, '<i>$1</i>').replace(/~([^~\n]+)~/g, '<s>$1</s>');
function textVorschau(k) {
  const n = NACHRICHTEN[k], text = fuelle($('#ttext').value.trim(), BEISPIEL), d = new Date(), pdf = `Angebot ${BEISPIEL.angebot.nr}.pdf`;
  $('#tvorschau').innerHTML = n.mail
    ? `<div class="mailvorschau"><p><span>Von</span>JD Brüder &lt;jd.brueder@gmail.com&gt;</p><p><span>An</span>kevin@beispiel.de</p>
      <div class="betreff">${esc(fuelle($('#tbetreff').value.trim(), BEISPIEL)) || '<i>Kein Betreff</i>'}</div>
      <div class="mailtext">${esc(text)}</div><span class="anhang">📄 ${pdf}</span></div>`
    : `<div class="wachat"><div class="wakopf"><span class="ava">K</span><b>Kevin Becker</b></div>
      <div class="blase">${n.pdf ? `<div class="wadok"><span class="pdf">PDF</span><span><b>${pdf}</b><small>1 Seite · PDF</small></span></div>` : ''}<span class="watext">${waFormat(text)}</span><span class="zeit">${pad(d.getHours())}:${pad(d.getMinutes())} <span class="haken">✓✓</span></span></div></div>`;
}
function baustein(f, k) {
  const t = textFeld || $('#ttext');
  t.setRangeText(f, t.selectionStart, t.selectionEnd, 'end'); t.focus(); textVorschau(k);
}
function textStandard(k) {
  $('#ttext').value = TEXT_STANDARD[k];
  if ($('#tbetreff')) $('#tbetreff').value = TEXT_STANDARD.TEXT_MAIL_BETREFF;
  textVorschau(k); toast('Standardtext steht drin. Sichern nicht vergessen.');
}
async function textSpeichern(k, knopf) {
  const neu = { [k]: $('#ttext').value.trim() };
  if ($('#tbetreff')) neu.TEXT_MAIL_BETREFF = $('#tbetreff').value.trim();
  if (Object.values(neu).some(t => !t)) return toast('Leer geht nicht. Für den Standard tipp auf „Standardtext einsetzen“.');
  if (k === 'WA_VORLAGE' && (!neu[k].includes('{Name}') || !neu[k].includes('{Wunsch}'))) return toast('{Name} und {Wunsch} müssen in der Nachricht bleiben.');
  if (skriptAlt) return toast('Bei Google läuft noch das alte Skript. Erst Code.gs ersetzen und eine neue Version bereitstellen, dann klappt das Sichern.');
  knopf.disabled = true;
  try {
    // Gleich wie der Standard: leer speichern, dann gilt auch ein später verbesserter Standard
    await Promise.all(Object.entries(neu).map(([art, t]) => api('vorlage', { art, text: t === TEXT_STANDARD[art] ? '' : t })));
    Object.assign(texte, neu); closeSheet(); toast('Gespeichert, gilt jetzt fürs ganze Team');
  } catch (e) { toast(e.message); knopf.disabled = false; }
}

// Dunkel/Hell und Gold im Hintergrund, gilt nur für dieses Handy. Beim Start setzt index.html das schon vor dem ersten Bild.
function designSetzen(art, wert) {
  merke('jdv-' + art, wert);
  const h = document.documentElement;
  h.classList.toggle('hell', lies('jdv-design', 'dunkel') === 'hell');
  h.classList.toggle('ohnegold', lies('jdv-gold', true) === false);
  $('meta[name=theme-color]').content = getComputedStyle(h).getPropertyValue('--bg').trim();
  render();
}

// ---------- Anmelden ----------
function renderLogin(msg = '') {
  view.innerHTML = `<div class="login">
    <img class="appicon" src="icon-192.png" alt="">
    <h1>JD Vertrieb</h1>
    <p class="sub">Leads anrufen, Notizen festhalten.</p>
    <p class="err" id="lerr">${esc(msg)}</p>
    <div class="seg" style="justify-content:center">${['Jonathan', 'David'].map(n => `<button class="pill sm" onclick="$('#lname').value=${js(n)}">${n}</button>`).join('')}</div>
    <input class="full" id="lname" placeholder="Dein Name" value="${esc(konto.name)}" autocomplete="given-name">
    <input class="full" id="lpw" type="password" placeholder="Team-Passwort" autocomplete="current-password" onkeydown="if(event.key==='Enter')anmelden()">
    <button class="big gold" id="lbtn" onclick="anmelden()">Anmelden</button>
  </div>`;
}
async function anmelden() {
  const name = $('#lname').value.trim(), pw = $('#lpw').value;
  if (!name || !pw) { $('#lerr').textContent = 'Bitte Name und Passwort eingeben.'; return; }
  $('#lbtn').disabled = true; $('#lbtn').textContent = 'Einen Moment…';
  konto = { name, pw };
  try {
    const j = await api('liste');
    merke('jdv-konto', konto);
    uebernimm(j);
    go('anrufen');
    if (!istApp() && !lies('jdv-install', false)) { merke('jdv-install', true); installHilfe(); }
  } catch (e) {
    konto = { name, pw: '' };
    renderLogin(e.message);
  }
}
function abmelden(msg = '') {
  konto.pw = ''; merke('jdv-konto', konto); leads = []; stand = null; closeSheet(); render();
  if (msg) $('#lerr').textContent = msg;
}

// ---------- Lead-Fenster ----------
function openLead(id, fokus) {
  const l = leads.find(x => x.id === id); if (!l) return;
  offen = id; angebot = null;
  sheet(leadHtml(l));
  if (!fotoCache[id]) fotosLaden(id);
  if (lexAn) {   // jedes Mal frisch aus Lexware, danach das PDF (es kann dort ein neues Angebot geben)
    const frisch = Date.now() - pdfCache[id]?.zeit < 60000;   // gerade erst geholt, z. B. direkt nach dem Erstellen
    if (l.angebot && !frisch) pdfCache[id] = { zeit: Date.now() };   // lädt gleich: die alte Fassung nicht mehr verschicken
    kundeLaden(id).then(() => { const a = leads.find(x => x.id === id)?.angebot; if (a && (!frisch || pdfCache[id]?.nr !== a.nr)) pdfLaden(id); });
  }
  const entwurf = lies('jdv-entwurf', {});
  if (entwurf[id]) { $('#notiz').value = entwurf[id]; delete entwurf[id]; merke('jdv-entwurf', entwurf); }
  if (fokus) setTimeout(() => $('#notiz')?.focus(), 300);
}
// Fenster neu zeichnen, ohne angefangene Notiz und Scrollposition zu verlieren
function leadNeu(id) {
  const l = leads.find(x => x.id === id), p = $('.panel');
  if (offen !== id || !l || !p) return;
  const txt = $('#notiz')?.value || '', top = p.scrollTop;
  kundeSichern(id, 'still');   // beim Neuzeichnen feuert kein change mehr, also vorher sichern
  p.innerHTML = '<div class="grab"></div>' + leadHtml(l);
  $('#notiz').value = txt; p.scrollTop = top;
}
function leadHtml(l) {
  const v = vorschlag[l.id];
  const vor = v && (v.status !== l.status || (v.naechster && v.naechster !== l.naechster)) ? `<div class="vorschlag"><span>Vorschlag: <b>${esc(v.status)}</b>${v.naechster ? `, melden am ${datumKurz(v.naechster)}` : ''}</span><button class="pill sm sel" onclick="uebernehmen(${js(l.id)})">Übernehmen</button></div>` : '';
  const zeile = (k, w) => w ? `<div class="row"><span>${k}</span><span>${esc(w)}</span></div>` : '';
  const eingang = new Date(l.datum);
  const id = js(l.id);
  return `<div class="sheet-head"><span></span><h2>${esc(l.name || 'Ohne Namen')}</h2><button class="pill" onclick="closeSheet()">Fertig</button></div>
    <div class="label">Details</div>
    <div class="group">${zeile('Telefon', l.telefon)}${zeile('Eingang', isNaN(eingang) ? '' : eingang.toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' }))}${l.antworten.map(a => zeile(a[0], a[1])).join('')}${zeile('Anzeige', l.anzeige)}${zeile('Quelle', l.quelle)}${zeile('Tabelle', l.tabelle)}</div>
    <div class="group"><div class="row"><label for="termin">Termin oder Rückruf</label><span class="datum"><input id="termin" type="date" value="${esc(l.naechster)}" onchange="terminSetzen(${id}, this.value)"><button class="pill sm" onclick="terminSetzen(${id}, '')" aria-label="Termin entfernen"${l.naechster ? '' : ' hidden'}>✕</button></span></div></div>
    ${lexAn ? kundeBlock(l) : ''}
    <div class="label">Neue Notiz</div>
    <textarea id="notiz" placeholder="Wie lief das Gespräch? Was will der Kunde?"></textarea>
    <p class="hint">🎙️ Tipp aufs Mikrofon der Tastatur und erzähl einfach. Beim Schließen wird die Notiz automatisch gespeichert.</p>
    <button class="pill wide" id="nbtn" onclick="notizSpeichern(${id})">Notiz speichern</button>
    <div class="label">KI-Zusammenfassung</div>
    <div class="card"><div class="ki" id="ki">${l.ki ? esc(l.ki) : '<span class="muted">Noch keine. Sobald du eine Notiz speicherst, fasst Claude zusammen.</span>'}</div>${vor}
      ${l.notizen ? `<button class="pill wide" id="kbtn" style="margin:var(--gap) 0 0" onclick="kiStarten(${id})">✨ ${l.ki ? 'Neu zusammenfassen' : 'Zusammenfassen'}</button>` : ''}</div>
    <div class="label">Verlauf</div>
    <div class="card verlauf">${l.notizen ? esc(l.notizen) : '<span class="muted">Noch keine Notizen.</span>'}</div>
    <div class="label">Fotos</div>
    <div class="card" id="fotos">${fotosHtml(l)}</div>
    <div class="leadfuss">
      <div class="group statusmenu" id="statusmenu" hidden>${Object.keys(STATUS).map(s => `<button class="row" aria-pressed="${s === l.status}" onclick="statusSetzen(${id}, ${js(s)})"><span><span class="dot" style="--c:${STATUS[s]}"></span>${s}</span>${s === l.status ? '<span aria-hidden="true">✓</span>' : ''}</button>`).join('')}</div>
      ${waFrage[l.id] && l.wa ? `<div class="vorschlag"><span>Per WhatsApp schreiben?</span><a class="pill sm sel" href="${esc(waLink(l, waText(l)))}" onclick="waGeschickt(${id})">WhatsApp</a><button class="pill sm" onclick="delete waFrage[${id}];leadNeu(${id})">Nein</button></div>` : ''}
      <div class="fussoben"><button class="pill statuswahl" aria-expanded="false" aria-controls="statusmenu" onclick="statusMenu()"><span class="dot" style="--c:${STATUS[l.status] || STATUS.Neu}"></span><b>${esc(l.status)}</b><span class="muted" aria-hidden="true">▴</span></button>${lexAn ? `<button class="pill sel" onclick="angebotOeffnen(${id})">🧾 Angebot</button>` : ''}</div>
      <div class="two">
        ${l.telefon ? `<a class="big" href="${esc(telLink(l))}" onclick="anruf(event, ${id})">${ICON.phone}Anrufen</a>` : '<button class="big" disabled>Keine Nummer</button>'}
        ${l.wa ? `<a class="big wa" href="${esc(waLink(l))}">${ICON.wa}WhatsApp</a>` : ''}
      </div>
    </div>`;
}
// Status-Menü über der unteren Leiste: klappt nach oben auf, Tipp daneben oder Escape schließt es
function statusMenu(auf = $('#statusmenu')?.hidden) {
  const m = $('#statusmenu'); if (!m) return;
  m.hidden = !auf; $('.statuswahl').setAttribute('aria-expanded', auf);
}
function statusSetzen(id, s) {
  statusMenu(false);
  if (leads.find(x => x.id === id)?.status !== s) setze(id, { status: s });
}
document.addEventListener('pointerdown', e => { if (!e.target.closest('#statusmenu, .statuswahl')) statusMenu(false); }, true);
document.addEventListener('keydown', e => { if (e.key === 'Escape') statusMenu(false); });
async function setze(id, aend) {
  const l = leads.find(x => x.id === id); if (!l) return;
  const alt = { ...l };
  if (aend.naechster !== undefined) { clearTimeout(termin[id]?.uhr); delete termin[id]; }
  Object.assign(l, aend); leadNeu(id); render();
  try {
    Object.assign(l, (await api('speichern', { id, ...aend })).lead);
    if (aend.status) aend.status === 'Nicht erreicht' ? waFrage[id] = true : delete waFrage[id];
    toast(aend.status ? `Status: ${aend.status}` : 'Gespeichert');
  } catch (e) { Object.assign(l, alt); toast(e.message); }
  leadNeu(id); render();
}
// Termin: iOS meldet schon beim Tippen im Kalender jede Änderung. Deshalb das Fenster nicht neu zeichnen
// (sonst klappt der Kalender weg und Tipps gehen verloren) und erst speichern, wenn eine Sekunde nichts mehr kommt.
const termin = {};
function terminSetzen(id, wert) {
  const l = leads.find(x => x.id === id); if (!l) return;
  const t = termin[id] ||= { alt: l.naechster }, el = offen === id && $('#termin');
  if (el) { el.value = wert; el.nextElementSibling.hidden = !wert; }
  l.naechster = wert; render();
  clearTimeout(t.uhr);
  t.uhr = setTimeout(async () => {
    delete termin[id];
    const jetzt = () => leads.find(x => x.id === id);   // Liste kann inzwischen neu geladen sein
    try {
      const neu = (await api('speichern', { id, naechster: wert })).lead;
      if (jetzt()?.naechster === wert) Object.assign(jetzt(), neu);
      toast(wert ? `Melden am ${datumKurz(wert)}` : 'Termin entfernt');
    } catch (e) {
      if (jetzt()?.naechster === wert) { jetzt().naechster = t.alt; leadNeu(id); }
      toast(e.message);
    }
    render();
  }, 1000);
}
// Tipp auf „WhatsApp“ in der Frage: WhatsApp geht mit dem fertigen Text auf, im Verlauf landet ein Vermerk
function waGeschickt(id) {
  delete waFrage[id]; leadNeu(id);
  api('speichern', { id, notiz: 'Nicht erreicht, per WhatsApp angeschrieben' })
    .then(j => { Object.assign(leads.find(x => x.id === id) || {}, j.lead); leadNeu(id); }).catch(e => toast(e.message));
}
function uebernehmen(id) {
  const v = vorschlag[id]; delete vorschlag[id];
  setze(id, v.naechster ? { status: v.status, naechster: v.naechster } : { status: v.status });
}
async function notizSenden(id, notiz) {
  const l = leads.find(x => x.id === id);
  try {
    Object.assign(l, (await api('speichern', { id, notiz })).lead);
    toast('Notiz gespeichert'); leadNeu(id); render();
    kiStarten(id);
  } catch (e) {
    // Text nicht verlieren: zurück ins Feld oder als Entwurf am Lead merken
    if (offen === id && !$('#notiz').value) { $('#notiz').value = notiz; toast(e.message); }
    else { merke('jdv-entwurf', { ...lies('jdv-entwurf', {}), [id]: notiz }); toast('Notiz nicht gespeichert. Sie liegt als Entwurf im Lead.'); }
  }
}
function notizSpeichern(id) {
  const t = $('#notiz'), notiz = t.value.trim();
  if (!notiz) { toast('Schreib oder sprich erst eine Notiz.'); return t.focus(); }
  t.value = ''; t.blur(); notizSenden(id, notiz);
}
async function kiStarten(id) {
  const l = leads.find(x => x.id === id);
  if (offen === id) { $('#ki').innerHTML = '<span class="wait">✨ Claude fasst zusammen…</span>'; $('#kbtn')?.setAttribute('disabled', ''); }
  try {
    const j = await api('ki', { id });
    Object.assign(l, j.lead); vorschlag[id] = j.vorschlag;
  } catch (e) {
    if (offen === id) { leadNeu(id); $('#ki').innerHTML = `<span style="color:var(--minus)">${esc(e.message)}</span>`; }
    return;
  }
  leadNeu(id); render();
}
// Anrufen: Wer nach dem Telefonat zurück in die App kommt, landet direkt im Notizfeld dieses Leads.
// Als Anruf zählt nur, wenn die App gleich nach dem Tipp verlassen wird und länger als 5 Sekunden weg ist.
// Abbrechen in der Rückfrage des iPhones öffnet so später nichts.
function anruf(e, id) {
  merke('jdv-anruf', { id, t: Date.now(), weg: false });
  if (DEMO) {
    e.preventDefault(); toast('Demo: Jetzt würde das Telefon wählen.');
    setTimeout(() => { merke('jdv-anruf', null); openLead(id, true); toast('Wie lief das Gespräch?'); }, 1800);
  }
}
document.addEventListener('visibilitychange', () => {
  const a = lies('jdv-anruf', null);
  if (document.hidden) { if (a) merke('jdv-anruf', !a.weg && Date.now() - a.t < 10000 ? { ...a, weg: Date.now() } : null); return; }
  laden(true);
  if (!a?.weg) return;
  merke('jdv-anruf', null);
  const l = leads.find(x => x.id === a.id);
  if (l && Date.now() - a.weg > 5000 && Date.now() - a.t < 3600e3) { openLead(a.id, true); toast(`Wie lief es mit ${l.name}?`); }
});

// ---------- Fotos ----------
// Volle Auflösung, eins nach dem anderen ins Drive des Skript-Kontos. Was nicht hochgeht, bleibt zum Nochmal-Senden da.
function fotosHtml(l) {
  const f = fotoCache[l.id], st = fotoStand[l.id], rest = fotoRest[l.id] || [];
  const vorname = (l.name || '').split(' ')[0];
  const wa = waLink(l, `Hallo${vorname ? ' ' + vorname : ''}, hier sind die Fotos von deinem Auto: ${f?.ordner}`);
  return `${f?.fotos.length ? `<div class="fotos">${f.fotos.map(x => `<a href="${esc(x.url)}" target="_blank" rel="noopener">${x.bild ? `<img src="${esc(x.bild)}" alt="${esc(x.name)}" loading="lazy">` : '<span>🖼️</span>'}</a>`).join('')}</div>` : ''}
    <p class="muted" style="margin:0 0 var(--gap)">${esc(st || (!f ? 'Fotos werden geladen…' : f.fotos.length ? `${f.fotos.length} ${f.fotos.length === 1 ? 'Foto' : 'Fotos'}` : 'Noch keine Fotos. Mach sie, wenn das Auto bei euch steht.'))}</p>
    <label class="pill wide">📷 Fotos hinzufügen<input type="file" accept="image/*" multiple hidden onchange="fotosHoch(${js(l.id)}, this.files)"></label>
    ${rest.length && !st ? `<button class="pill wide" onclick="fotosHoch(${js(l.id)}, fotoRest[${js(l.id)}])">↻ ${rest.length} nicht hochgeladene Fotos nochmal senden</button>` : ''}
    ${f?.fotos.length ? `<div class="two" style="margin:0"><a class="pill" href="${esc(f.ordner)}" target="_blank" rel="noopener">📁 Ordner</a><a class="pill" href="${esc(wa)}">📤 An Kunden</a></div>` : ''}`;
}
const zeigeFotos = id => { const l = leads.find(x => x.id === id); if (offen === id && l && $('#fotos')) $('#fotos').innerHTML = fotosHtml(l); };
async function fotosLaden(id) {
  try { fotoCache[id] = await api('fotos', { id }); } catch (e) { fotoCache[id] ||= { fotos: [], ordner: '' }; toast(e.message); }
  zeigeFotos(id);
}
async function fotosHoch(id, dateien) {
  const liste = [...dateien]; if (!liste.length || fotoStand[id]) return;
  delete fotoRest[id];
  for (let i = 0; i < liste.length; i++) {
    fotoStand[id] = `Lade Foto ${i + 1} von ${liste.length} hoch…`; zeigeFotos(id);
    try {
      const daten = await new Promise((ok, nein) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1]); r.onerror = () => nein(new Error('Foto ließ sich nicht lesen.')); r.readAsDataURL(liste[i]); });
      await api('foto', { id, typ: liste[i].type || 'image/jpeg', nr: i + 1, daten });
    } catch (e) { fotoRest[id] = liste.slice(i); toast(`Foto ${i + 1} ging nicht hoch: ${e.message}`); break; }
  }
  delete fotoStand[id];
  if (!fotoRest[id]) toast(`📷 ${liste.length === 1 ? '1 Foto' : liste.length + ' Fotos'} gespeichert`);
  await fotosLaden(id);
}

// ---------- Lexware: Angebot und Kundendaten ----------
const euro = n => (Number(n) || 0).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
const MAIL_OK = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Im Kundenfenster oben: Angebot erstellen, letztes Angebot verschicken, E-Mail und Adresse (gehen direkt nach Lexware)
function kundeBlock(l) {
  const id = js(l.id), a = l.angebot, k = kundeCache[l.id] || l.kunde || {};
  const feld = (f, name, extra = '') => `<div class="row"><label for="k-${f}">${name}</label><input id="k-${f}" value="${esc(k[f] || '')}" autocomplete="off" onchange="kundeSichern(${id}, 'warten')"${extra}></div>`;
  // Neues Angebot: Knopf „Angebot“ in der festen Leiste unten, auch mitten im Telefonat ohne Scrollen
  return `${a ? `<div class="label">Letztes Angebot</div>${angebotKarte(l)}` : ''}
    <div class="label">Kundendaten</div>
    <div class="group" id="kunde">${feld('email', 'E-Mail', ' type="email" inputmode="email" autocapitalize="off"')}${feld('strasse', 'Straße')}${feld('plz', 'PLZ', ' inputmode="numeric" maxlength="10"')}${feld('ort', 'Ort')}</div>
    <p class="hint">Wird direkt in Lexware gespeichert.${l.lex ? ` <a href="${esc(LEX_APP + 'contacts/view/' + l.lex)}" target="_blank" rel="noopener">Kunde in Lexware ↗</a>` : ''}</p>`;
}
// Summe und PDF kommen beim Öffnen frisch aus Lexware, auch wenn dort jemand das Angebot bearbeitet hat
function angebotKarte(l) {
  const id = js(l.id), a = l.angebot;
  return `<div class="card" id="angebotkarte">
      <p class="angebotzeile"><span><b>${esc(a.nr || 'Angebot')}</b> · ${euro(a.summe)}</span><span class="muted">${{ accepted: 'angenommen', rejected: 'abgelehnt' }[a.status] || (a.geaendert ? 'geändert ' + datumKurz(a.geaendert) : a.datum ? 'vom ' + datumKurz(a.datum) : '')}</span></p>
      ${a.pdf ? `<div class="drei"><button class="pill" onclick="angebotWhatsApp(${id})">${ICON.wa}WhatsApp</button><button class="pill" onclick="angebotMail(${id}, this)">✉️ Mail</button><a class="pill" href="${esc(a.pdf)}" target="_blank" rel="noopener">📄 PDF</a></div>
      <p class="hint" style="margin:var(--gap) 0 0">WhatsApp: im Teilen-Menü WhatsApp Business und dann den Kunden wählen. Taucht er nicht auf, erst unten über WhatsApp den Chat öffnen.</p>`
        : `<a class="pill wide" style="margin:0" href="${esc(a.link)}" target="_blank" rel="noopener">Das PDF fehlt noch. In Lexware öffnen ↗</a>`}
    </div>`;
}
const kundeFelder = () => Object.fromEntries(['email', 'strasse', 'plz', 'ort'].map(f => [f, $('#k-' + f)?.value.trim() || '']));
// Was in Lexware geändert wurde, gilt auch hier: Name, Telefon, Mail, Adresse und das neueste Angebot mit Status.
// Felder, in denen gerade jemand tippt oder ungesicherte Änderungen stehen, bleiben, wie sie sind.
async function kundeLaden(id) {
  try {
    const j = await api('lexDaten', { id }), l = leads.find(x => x.id === id);
    if (!l) return;
    if (j.lex) l.lex = j.lex;
    const vorher = JSON.parse(kundeStand[id] || 'null') || kundeCache[id] || l.kunde || {};
    if (offen === id) for (const [f, v] of Object.entries(j.kunde)) { const el = $('#k-' + f); if (el && document.activeElement !== el && el.value.trim() === (vorher[f] || '')) el.value = v; }
    kundeStand[id] = JSON.stringify(j.kunde);
    kundeCache[id] = offen === id && $('#kunde') ? kundeFelder() : j.kunde;
    let neu = false;
    if (j.name && j.name !== l.name) { l.name = j.name; neu = true; }
    if (j.telefon && j.telefon !== l.telefon) { Object.assign(l, { telefon: j.telefon, wa: j.wa }); neu = true; }
    if (j.angebot && j.angebot.link !== l.angebot?.link) {
      l.angebot = j.angebot; neu = true;
      if (offen === id) toast(`Angebot ${j.angebot.nr} aus Lexware übernommen`);
    } else if (j.angebot && l.angebot && j.angebot.status !== l.angebot.status) {
      l.angebot.status = j.angebot.status;
      const karte = offen === id && $('#angebotkarte');
      if (karte) karte.outerHTML = angebotKarte(l);
    }
    if (neu) { leadNeu(id); render(); }
  } catch (e) { if (offen === id) toast(e.message); }
}
// Kundendaten nach Lexware, sobald sie sich geändert haben: kurz nach dem Verlassen eines Feldes ('warten'), sonst sofort.
// Sofort auch, bevor das Fenster zugeht oder neu gezeichnet wird: Verschwindet ein Feld beim Tippen, feuert iOS kein change mehr.
function kundeSichern(id, wie) {
  if (!$('#kunde')) return;
  const k = kundeCache[id] = kundeFelder(), stand = JSON.stringify(k);
  clearTimeout(kundeUhr[id]);
  if (stand === kundeStand[id] || !Object.values(k).some(Boolean)) return;
  if (k.email && !MAIL_OK.test(k.email)) return wie === 'still' ? null : toast('Die E-Mail-Adresse sieht nicht richtig aus.');
  const los = async () => {
    kundeStand[id] = stand;
    try {
      const j = await api('lexDaten', { id, speichern: true, ...k }), l = leads.find(x => x.id === id);
      if (l) l.lex = j.lex;
      toast('In Lexware gespeichert');
    } catch (e) { delete kundeStand[id]; toast('Kundendaten nicht gespeichert: ' + e.message); }   // beim nächsten Mal nochmal
  };
  if (wie === 'warten') kundeUhr[id] = setTimeout(los, 800); else los();
}
// Verschickt: Vermerk im Verlauf, und ohne geplanten Rückruf trägt das Skript Nachfassen in 3 Tagen ein
// PDF des letzten Angebots holen und als Datei bereithalten. Teilen muss direkt beim Tippen passieren,
// sonst blockt iOS, deshalb wird vorgeladen.
const alsPdf = (b64, nr) => ({ nr, zeit: Date.now(), datei: new File([Uint8Array.from(atob(b64), c => c.charCodeAt(0))], `Angebot ${nr}.pdf`, { type: 'application/pdf' }) });
async function pdfLaden(id) {
  pdfCache[id] = { zeit: Date.now() };   // lädt: die alte Fassung nicht mehr verschicken
  try {
    const j = await api('angebotPdf', { id }), l = leads.find(x => x.id === id);
    pdfCache[id] = alsPdf(j.daten, j.nr);
    if (!l || !j.angebot) return;
    const neu = l.angebot?.version != null && l.angebot.version !== j.angebot.version;
    l.angebot = j.angebot;
    const karte = offen === id && $('#angebotkarte');
    if (karte) karte.outerHTML = angebotKarte(l);
    if (neu && offen === id) toast(`Angebot ${j.nr} wurde in Lexware geändert. Die neue Fassung ist geladen.`);
  } catch (e) { delete pdfCache[id]; if (offen === id) toast(e.message); }
}
// WhatsApp: das PDF selbst geht über das Teilen-Menü in den Chat (kein Link)
async function angebotWhatsApp(id) {
  const l = leads.find(x => x.id === id), a = l?.angebot, p = pdfCache[id];
  if (!a) return;
  if (!p?.datei || p.nr !== a.nr) { toast('Das PDF lädt noch. Tipp gleich nochmal.'); return p && !p.datei ? null : pdfLaden(id); }
  if (!navigator.canShare?.({ files: [p.datei] })) return toast('Dieses Gerät kann keine Dateien teilen. Nimm das iPhone.');
  try { await navigator.share({ files: [p.datei], text: fuelle(texte.TEXT_ANGEBOT_WA, l) }); }
  catch (e) { return e.name === 'AbortError' ? null : toast('Teilen hat nicht geklappt.'); }
  angebotGeschickt(id, 'WhatsApp');
}
function angebotGeschickt(id, weg) {
  api('gesendet', { id, weg }).then(j => {
    Object.assign(leads.find(x => x.id === id) || {}, j.lead, { angebot: j.angebot });
    toast(j.nachfassen ? `Vermerkt. Nachfassen am ${datumKurz(j.nachfassen)} steht drin.` : 'Versand vermerkt');
    leadNeu(id); render();
  }).catch(e => toast(e.message));
}
// Mail geht direkt aus dem Gmail-Konto von JD Brüder raus (das Google-Skript sendet), mit dem PDF im Anhang
async function angebotMail(id, knopf) {
  const l = leads.find(x => x.id === id), a = l?.angebot, email = ($('#k-email')?.value || kundeCache[id]?.email || '').trim();
  if (!a) return;
  if (!MAIL_OK.test(email)) { toast('Trag erst die E-Mail-Adresse ein.'); return $('#k-email')?.focus(); }
  if (!confirm(`Angebot ${a.nr} jetzt per Mail an ${email} senden? Das PDF hängt an.`)) return;
  knopf.disabled = true; knopf.textContent = 'Sendet…';
  try {
    const j = await api('angebotMail', { id, email, betreff: fuelle(texte.TEXT_MAIL_BETREFF, l), text: fuelle(texte.TEXT_MAIL, l) });
    Object.assign(l, j.lead, { angebot: j.angebot });
    toast(`Angebot ${a.nr} an ${email} gesendet.${j.nachfassen ? ` Nachfassen am ${datumKurz(j.nachfassen)} steht drin.` : ''}`);
  } catch (e) { toast(e.message); }
  leadNeu(id); render();
}
async function lexPruefen() {
  try { const j = await api('lexArtikel'); lexArtikelCache = j.artikel.filter(x => !x.aus); toast(`Lexware verbunden: ${j.firma}, ${j.artikel.length} Artikel`); }
  catch (e) { toast(e.message); }
}
// Setup: welche Lexware-Artikel im Angebot erscheinen (gilt fürs ganze Team). Schalter speichern sofort.
let artikelAlle = [];
async function artikelWahl() {
  sheet(`<div class="sheet-head"><span></span><h2>Artikel</h2><button class="pill" onclick="closeSheet()">Fertig</button></div><div class="card muted" id="awahl">Artikel werden aus Lexware geladen…</div>`);
  try { artikelAlle = (await api('lexArtikel')).artikel; } catch (e) { return $('#awahl') && ($('#awahl').textContent = e.message); }
  if (!$('#awahl')) return;
  $('.panel').innerHTML = `<div class="grab"></div><div class="sheet-head"><span></span><h2>Artikel</h2><button class="pill" onclick="closeSheet()">Fertig</button></div>
    <p class="hint">Nur eingeschaltete Artikel erscheinen beim Angebot. Gilt fürs ganze Team.</p>
    <div class="two"><button class="pill" onclick="artikelAlle.forEach(a => a.aus = false); artikelSpeichern(true)">Alle an</button><button class="pill" onclick="artikelAlle.forEach(a => a.aus = true); artikelSpeichern(true)">Alle aus</button></div>
    <label class="search">${ICON.search}<input type="search" placeholder="Artikel suchen" oninput="const q = this.value.trim().toLowerCase(); document.querySelectorAll('#awahl .row').forEach((r, i) => r.classList.toggle('weg', !!q && !artikelAlle[i].name.toLowerCase().includes(q)))" aria-label="Artikel suchen"></label>
    <div class="group" id="awahl">${artikelAlle.map((a, i) => `<label class="row"><span>${esc(a.name)}<br><span class="muted small">${euro(a.preis)}</span></span><input type="checkbox" switch ${a.aus ? '' : 'checked'} onchange="artikelAlle[${i}].aus = !this.checked; artikelSpeichern()"></label>`).join('')}</div>`;
}
let artikelUhr;
function artikelSpeichern(neu) {
  if (neu) document.querySelectorAll('#awahl input').forEach((c, i) => { c.checked = !artikelAlle[i].aus; });
  lexArtikelCache = null; clearTimeout(artikelUhr);
  artikelUhr = setTimeout(() => api('artikelAus', { aus: artikelAlle.filter(a => a.aus).map(a => a.id) })
    .then(() => toast(`${artikelAlle.filter(a => !a.aus).length} von ${artikelAlle.length} Artikeln im Angebot`)).catch(e => toast(e.message)), 700);
}
// Offene Leads, die noch kein Kunde in Lexware sind, nachträglich anlegen (bestehende Kunden werden verknüpft)
const ohneKunde = () => leads.filter(l => AKTIV.includes(l.status) && !l.lex);
async function nachziehen(knopf) {
  const n = ohneKunde().length;
  if (!confirm(`${n} offene Leads als Kunden in Lexware anlegen? Wer schon Kunde ist (gleicher Nachname und gleiche Nummer oder E-Mail), wird nur verknüpft.`)) return;
  knopf.disabled = true; knopf.lastElementChild.textContent = 'Läuft…';
  try {
    let j, summe = 0;
    do { j = await api('nachziehen'); summe += j.angelegt; knopf.lastElementChild.textContent = `${summe} von ${n}…`; } while (j.rest && j.angelegt);
    toast(`${summe} Leads sind jetzt Kunden in Lexware`);
  } catch (e) { toast(e.message); }
  await laden(true); render();
}

// Angebotsseite im selben Fenster, gedacht fürs Telefonat: oben was im Angebot ist, darunter alle Artikel zum Suchen
const angebotSumme = a => [...(a.artikel || []).filter(x => a.menge[x.id]).map(x => x.preis * a.menge[x.id]), ...a.eigene.map(x => x.preis)].reduce((s, x) => s + x, 0);
async function angebotOeffnen(id) {
  const notiz = $('#notiz')?.value.trim();   // angefangene Notiz bleibt als Entwurf am Lead
  if (notiz) merke('jdv-entwurf', { ...lies('jdv-entwurf', {}), [id]: notiz });
  kundeSichern(id);
  const l = leads.find(x => x.id === id), ref = /referenz/i.test(wunsch(l));   // Aktion: 20 % für Referenzkunden
  offen = null;
  const a = angebot = { id, artikel: lexArtikelCache, menge: {}, eigene: [], rabatt: ref ? 20 : 0, referenz: ref, suche: '' };
  angebotZeichnen(); $('.panel').scrollTop = 0;
  try { lexArtikelCache = (await api('lexArtikel')).artikel.filter(x => !x.aus); } catch (e) { a.fehler = e.message; }
  if (angebot === a) { a.artikel = lexArtikelCache; angebotZeichnen(); }
}
function angebotZeichnen() {
  const p = $('.panel'); if (!p || !angebot) return;
  const name = $('#ep-name')?.value || '', preis = $('#ep-preis')?.value || '', top = p.scrollTop;
  p.innerHTML = '<div class="grab"></div>' + angebotHtml(angebot);
  $('#ep-name').value = name; $('#ep-preis').value = preis; p.scrollTop = top;
}
function angebotHtml(a) {
  const l = leads.find(x => x.id === a.id) || {}, summe = angebotSumme(a), gewaehlt = (a.artikel || []).filter(x => a.menge[x.id]);
  const einheit = x => ['Pauschal', 'Stück', 'Aufwand'].includes(x.einheit) ? '' : ' / ' + esc(x.einheit);
  const zeile = (x, i, liste) => `<div class="row${liste && a.suche && !x.name.toLowerCase().includes(a.suche) ? ' weg' : ''}"><span>${esc(x.name)}<br><span class="muted small">${euro(x.preis)}${einheit(x)}</span></span><span class="menge">${a.menge[x.id] ? `<button class="pill sm" aria-label="${esc(x.name)} weniger" onclick="angebotMenge(${i}, -1)">−</button><b>${a.menge[x.id]}</b>` : ''}<button class="pill sm" aria-label="${esc(x.name)} dazu" onclick="angebotMenge(${i}, 1)">+</button></span></div>`;
  const artikel = !a.artikel ? `<div class="card muted">${esc(a.fehler || 'Artikel werden aus Lexware geladen…')}</div>`
    : !a.artikel.length ? '<div class="card muted">In Lexware sind noch keine Artikel angelegt. Bis dahin gehen eigene Positionen.</div>'
    : `<label class="search">${ICON.search}<input id="a-suche" type="search" placeholder="Artikel suchen" value="${esc(a.suche)}" oninput="angebotFilter(this.value)" aria-label="Artikel suchen"></label>
      <div class="group" id="artikelliste">${a.artikel.map((x, i) => zeile(x, i, true)).join('')}</div>`;
  const leer = !gewaehlt.length && !a.eigene.length;
  return `<div class="sheet-head"><button class="pill" onclick="openLead(${js(a.id)})">Zurück</button><h2>Angebot</h2><span></span></div>
    <p class="hint">Für ${esc(l.name || 'den Kunden')}. Es bekommt eine Nummer und ein PDF, danach schickst du es per WhatsApp oder Mail.</p>
    <div class="label">Im Angebot</div>
    <div class="group">${leer ? '<div class="row muted">Noch nichts. Tipp unten bei den Artikeln auf +.</div>' : ''}
      ${gewaehlt.map(x => zeile(x, a.artikel.indexOf(x))).join('')}
      ${a.eigene.map((x, i) => `<div class="row"><span>${esc(x.name)}<br><span class="muted small">${euro(x.preis)}</span></span><span class="menge"><button class="pill sm" aria-label="${esc(x.name)} entfernen" onclick="angebot.eigene.splice(${i}, 1); angebotZeichnen()">✕</button></span></div>`).join('')}
      <div class="row"><span>Rabatt</span><span class="menge"><button class="pill sm${a.referenz ? ' sel' : ''}" aria-pressed="${a.referenz}" onclick="angebotRabatt(${a.referenz ? 0 : 20}, ${!a.referenz})">Referenz 20 %</button><input id="a-rabatt" class="prozent" inputmode="decimal" value="${a.rabatt ? String(a.rabatt).replace('.', ',') : ''}" placeholder="0" onchange="angebotRabatt(this.value, false)" aria-label="Rabatt in Prozent">%</span></div>
      ${a.rabatt && !leer ? `<div class="row muted"><span>Ohne Rabatt</span><span>${euro(summe)}</span></div>` : ''}
      <div class="row"><b>Gesamt inkl. MwSt.</b><b>${euro(summe * (1 - a.rabatt / 100))}</b></div></div>
    <div class="label">Artikel aus Lexware</div>${artikel}
    <div class="label">Eigene Position</div>
    <div class="group"><div class="row eigene"><input id="ep-name" placeholder="z. B. Lederpflege" maxlength="255" aria-label="Bezeichnung"><input id="ep-preis" inputmode="decimal" placeholder="€" aria-label="Preis in Euro"><button class="pill sm" aria-label="Position hinzufügen" onclick="eigeneDazu()">+</button></div></div>
    <p class="hint">Preise sind Endpreise, so wie der Kunde sie zahlt.</p>
    <div class="leadfuss"><button class="big gold" id="abtn" onclick="angebotAnlegen()">Angebot erstellen${leer ? '' : ' · ' + euro(summe * (1 - a.rabatt / 100))}</button></div>`;
}
// Suche ohne Neuzeichnen, damit die Tastatur offen bleibt
function angebotFilter(v) {
  angebot.suche = v.trim().toLowerCase();
  document.querySelectorAll('#artikelliste .row').forEach((r, i) => r.classList.toggle('weg', !!angebot.suche && !angebot.artikel[i].name.toLowerCase().includes(angebot.suche)));
}
function angebotMenge(i, d) {
  const x = angebot.artikel[i];
  angebot.menge[x.id] = Math.max(0, (angebot.menge[x.id] || 0) + d); angebotZeichnen();
}
const zahl = t => Number(String(t).trim().includes(',') ? String(t).trim().replace(/\./g, '').replace(',', '.') : String(t).trim());   // 1.299,50 oder 54.5
function angebotRabatt(v, referenz) {
  const n = zahl(v || 0);
  if (!(n >= 0 && n <= 100)) { toast('Rabatt zwischen 0 und 100 %.'); return angebotZeichnen(); }
  angebot.rabatt = Math.round(n * 100) / 100; angebot.referenz = referenz && n > 0; angebotZeichnen();
}
function eigeneDazu() {
  const n = $('#ep-name').value.trim(), t = $('#ep-preis').value.trim(), preis = zahl(t);
  if (!n || !t || !(preis >= 0)) { toast('Gib eine Bezeichnung und einen Preis ein.'); return false; }
  angebot.eigene.push({ name: n, menge: 1, preis: Math.round(preis * 100) / 100 });
  $('#ep-name').value = $('#ep-preis').value = ''; angebotZeichnen(); return true;
}
async function angebotAnlegen() {
  if (($('#ep-name').value.trim() || $('#ep-preis').value.trim()) && !eigeneDazu()) return;   // getippte Position nicht vergessen
  const a = angebot, knopf = $('#abtn');
  const posten = [...(a.artikel || []).filter(x => a.menge[x.id]).map(x => ({ artikel: x.id, menge: a.menge[x.id] })), ...a.eigene];
  if (!posten.length) return toast('Wähl mindestens eine Leistung aus.');
  knopf.disabled = true; knopf.textContent = 'Wird erstellt, dauert ein paar Sekunden…';
  try {
    const j = await api('lexAngebot', { id: a.id, posten, rabatt: a.rabatt, referenz: a.referenz });
    Object.assign(leads.find(x => x.id === a.id) || {}, j.lead, { lex: j.lex, angebot: j.angebot });
    if (j.pdf64) pdfCache[a.id] = alsPdf(j.pdf64, j.angebot.nr);
    if (angebot === a) { openLead(a.id); $('#angebotkarte')?.scrollIntoView({ block: 'center' }); }
    toast(`Angebot ${j.angebot.nr} erstellt. Jetzt per WhatsApp oder Mail schicken.`); render();
  } catch (e) { toast(e.message); if (angebot === a) angebotZeichnen(); }
}

// ---------- Benachrichtigungen ----------
// Versand über den kleinen Dienst bei Cloudflare (push/), ausgelöst vom Google-Skript. Auf dem iPhone geht Push
// nur in der installierten App (ab iOS 16.4) und erst, nachdem man es einmal erlaubt hat.
const pushOk = () => 'PushManager' in window && 'serviceWorker' in navigator && 'Notification' in window;
async function pushEin(still) {
  if (DEMO) return still || toast('Demo: Benachrichtigungen gehen nur in der echten App.');
  if (!pushOk()) return still || toast('Benachrichtigungen gehen erst, wenn die App auf dem Startbildschirm liegt.');
  try {
    if (!still && await Notification.requestPermission() !== 'granted') return toast('Benachrichtigungen sind nicht erlaubt. Du kannst sie in den iPhone-Einstellungen unter Mitteilungen einschalten.');
    if (Notification.permission !== 'granted') return;
    const reg = await navigator.serviceWorker.ready;
    const abo = await reg.pushManager.getSubscription()
      || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: Uint8Array.from(atob(PUSH_KEY.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)) });
    await api(still ? 'push' : 'pushTest', { abo: abo.toJSON() });   // beim Einschalten kommt gleich eine Testnachricht
    if (!still) { toast('🔔 Benachrichtigungen sind an, eine Testnachricht ist unterwegs'); render(); }
  } catch (e) { if (!still) toast('Benachrichtigungen gingen nicht an: ' + e.message); }
}
// Tipp auf eine Benachrichtigung, während die App schon offen ist
navigator.serviceWorker?.addEventListener('message', e => {
  const m = String(e.data?.open || '').match(/#lead=(.+)$/);
  if (!m) return laden();
  ziel = decodeURIComponent(m[1]);
  if (leads.some(l => l.id === ziel)) { const z = ziel; ziel = ''; openLead(z); } else laden();
});

// ---------- Fenster, Meldungen ----------
function sheet(html) {
  $('#sheet').innerHTML = `<div class="backdrop" onclick="closeSheet()"></div><div class="panel"><div class="grab"></div>${html}</div>`;
  $('#sheet').hidden = false;
}
function closeSheet() {
  const id = offen, notiz = $('#notiz')?.value.trim();
  if (id) kundeSichern(id);
  $('#sheet').hidden = true; $('#sheet').innerHTML = ''; offen = null; angebot = null;
  if (id && notiz) notizSenden(id, notiz);
}
function toast(msg) {
  document.querySelectorAll('.toast').forEach(t => t.remove());
  const t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); t.textContent = msg;
  document.body.appendChild(t); setTimeout(() => t.classList.add('out'), 3200); setTimeout(() => t.remove(), 3700);
}

// ---------- Feedback-Lampe ----------
let fbArt = 'Idee';
function openFeedback() {
  sheet(`<div class="sheet-head"><span></span><h2>Feedback</h2><button class="pill" onclick="closeSheet()">Schließen</button></div>
    <p class="sub">Idee, Fehler oder Frage zur App? Schreib es hier rein, es landet im Sheet.</p>
    <div class="seg" style="justify-content:center">${[['💡', 'Idee'], ['🐞', 'Fehler'], ['❓', 'Frage']].map(([i, a]) => `<button class="pill ${a === fbArt ? 'sel' : ''}" onclick="fbArt=${js(a)};this.parentNode.querySelectorAll('.pill').forEach(p=>p.classList.toggle('sel',p===this))">${i} ${a}</button>`).join('')}</div>
    <textarea id="fbtext" placeholder="Was fällt dir auf?"></textarea>
    <button class="big gold" id="fbsend" onclick="fbSenden()">Senden</button>`);
}
async function fbSenden() {
  const text = $('#fbtext').value.trim();
  if (!text) return toast('Schreib erst etwas.');
  $('#fbsend').disabled = true;
  try { await api('feedback', { art: fbArt, text }); closeSheet(); toast('Danke, ist angekommen!'); }
  catch (e) { toast(e.message); $('#fbsend').disabled = false; }
}

// ---------- App auf den Startbildschirm ----------
let installEvent = null;
addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvent = e; });
const istApp = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
function installHilfe() {
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const schritte = ios
    ? ['Diese Seite in <b>Safari</b> öffnen.', 'Unten auf <b>Teilen</b> tippen (Viereck mit Pfeil).', '<b>Zum Home-Bildschirm</b> wählen.', 'Oben rechts <b>Hinzufügen</b>. Fertig!']
    : ['Diese Seite in <b>Chrome</b> öffnen.', 'Oben rechts auf <b>⋮</b> tippen.', '<b>App installieren</b> oder <b>Zum Startbildschirm hinzufügen</b> wählen.', '<b>Installieren</b> bestätigen. Fertig!'];
  sheet(`<div class="sheet-head"><span></span><h2>App installieren</h2><button class="pill" onclick="closeSheet()">Später</button></div>
    <img class="appicon" src="icon-192.png" alt="">
    <p class="sub">Dann öffnest du JD Vertrieb mit einem Tipp wie jede andere App.</p>
    ${installEvent ? '<button class="big gold" style="margin-bottom:var(--gap)" onclick="installEvent.prompt();closeSheet()">Jetzt installieren</button>' : ''}
    <ol class="isteps">${schritte.map((s, i) => `<li class="istep"><span class="inum">${i + 1}</span><span>${s}</span></li>`).join('')}</ol>`);
}

// ---------- Glas-Tab-Leiste (aus Dayliner) ----------
// Goldene Kopie der Icons über der Leiste, nur innerhalb der Pille sichtbar.
function tabHi() {
  const nav = $('.tabs'); if (!nav) return null;
  let hi = nav.querySelector('.tab-hi');
  const btns = [...nav.querySelectorAll('button')];
  if (!hi) {
    hi = document.createElement('div'); hi.className = 'tab-hi'; hi.setAttribute('aria-hidden', 'true');
    btns.forEach(b => { const sp = document.createElement('span'); sp.innerHTML = b.querySelector('svg').outerHTML; hi.appendChild(sp); });
    nav.appendChild(hi);
  }
  btns.forEach((b, i) => hi.children[i].classList.toggle('hover', b.classList.contains('hover')));
  return hi;
}
function placeInd(x, w, k = 1) {
  const ind = $('.tab-ind'), hi = tabHi();
  ind.style.transform = `translateX(${x}px)${k !== 1 ? ` scale(${k},1)` : ''}`; ind.style.width = w + 'px';
  const g = w * (k - 1) / 2;
  if (hi) hi.style.clipPath = `inset(0 calc(100% - ${x + w + g}px) 0 ${x - g}px round 27px)`;
}
function moveTabInd() {
  const nav = $('.tabs'), ind = $('.tab-ind'), b = $('.tabs button.on');
  if (!nav || !ind || nav.hidden || !b) return;
  const x = b.offsetLeft, w = b.offsetWidth, from = parseFloat(ind.dataset.x);
  ind.style.opacity = 1;
  placeInd(x, w);
  if (!isNaN(from) && from !== x && ind.animate && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const k = Math.min(1.45, 1 + Math.abs(x - from) / 500);
    const a = ind.animate([{ scale: '1 1' }, { scale: `${k} .86`, offset: .35 }, { scale: '.96 1.04', offset: .7 }, { scale: '1 1' }], { duration: 500, easing: 'ease-out' });
    setTimeout(() => a.finish(), 650);
    nav.classList.add('press'); setTimeout(() => nav.classList.remove('press'), 180);
  }
  ind.dataset.x = x;
}
// Leichtes Antippen-Gefühl. Android: Vibration. iPhone (ab iOS 18): verstecktes Schalter-Feld löst System-Haptik aus.
const haptic = (() => {
  let lab;
  return () => {
    try {
      if (navigator.vibrate) return navigator.vibrate(8);
      if (!lab) {
        lab = document.createElement('label'); lab.setAttribute('aria-hidden', 'true');
        lab.style.cssText = 'position:absolute;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none;left:-9px;top:-9px';
        const inp = document.createElement('input'); inp.type = 'checkbox'; inp.setAttribute('switch', ''); inp.tabIndex = -1;
        lab.appendChild(inp); document.body.appendChild(lab);
      }
      lab.click();
    } catch (e) { }
  };
})();
// Wischen über die Menüleiste: Die Pille folgt dem Finger, beim Loslassen öffnet sich das Feld darunter.
(function tabSwipe() {
  const nav = $('.tabs'), ind = $('.tab-ind');
  let start = null, dragging = false, eatClick = false, hoverBtn = null, lastTouch = -1e9;
  const btns = () => [...nav.querySelectorAll('button')];
  const under = x => btns().reduce((best, b) => { const d = Math.abs(b.offsetLeft + b.offsetWidth / 2 - x); return !best || d < best.d ? { b, d } : best; }, null)?.b;
  const local = x => { const r = nav.getBoundingClientRect(); return (x - r.left) * nav.offsetWidth / r.width; };
  const down = (x, t) => { start = { x, t }; dragging = false; hoverBtn = null; if (under(local(x))?.dataset.tab === tab) nav.classList.add('press'); };
  const move = x => {
    if (!start) return false;
    if (!dragging && Math.abs(x - start.x) < 8) return false;
    if (!dragging) { dragging = true; nav.classList.add('press', 'drag'); ind.style.transition = 'width .2s,top .25s,bottom .25s,background .25s,box-shadow .25s'; }
    const w = ind.offsetWidth, rx = local(x);
    const left = Math.max(5, Math.min(nav.offsetWidth - 5 - w, rx - w / 2));
    const u = under(rx);
    if (u !== hoverBtn) { if (hoverBtn) haptic(); hoverBtn = u; }
    btns().forEach(b => b.classList.toggle('hover', b === u));
    placeInd(left, w, 1.1); ind.dataset.x = left;
    return true;
  };
  const up = (x, t, cancel) => {
    const s = start; start = null;
    if (!s || !dragging) { nav.classList.remove('press'); return; }
    dragging = false; eatClick = true; setTimeout(() => { eatClick = false; }, 400);
    nav.classList.remove('press', 'drag'); ind.style.transition = '';
    btns().forEach(b => b.classList.remove('hover')); tabHi();
    const list = btns(), cur = list.findIndex(b => b.dataset.tab === tab);
    let target = under(local(x));
    const dx = x - s.x, v = Math.abs(dx) / Math.max(1, t - s.t);
    if (!cancel && target === list[cur] && v > 0.5) target = list[Math.max(0, Math.min(list.length - 1, cur + Math.sign(dx)))];
    if (cancel || !target || target.dataset.tab === tab) { moveTabInd(); return; }
    haptic(); target.click();
  };
  nav.addEventListener('touchstart', e => { lastTouch = e.timeStamp; down(e.touches[0].clientX, e.timeStamp); }, { passive: true });
  nav.addEventListener('touchmove', e => { if (move(e.touches[0].clientX)) e.preventDefault(); }, { passive: false });
  nav.addEventListener('touchend', e => up(e.changedTouches[0].clientX, e.timeStamp, false));
  nav.addEventListener('touchcancel', e => up(e.changedTouches[0]?.clientX ?? 0, e.timeStamp, true));
  document.addEventListener('visibilitychange', () => { if (start) up(0, 0, true); nav.classList.remove('press', 'drag'); });
  nav.addEventListener('mousedown', e => { if (e.button === 0 && e.timeStamp - lastTouch > 1000) down(e.clientX, e.timeStamp); });
  addEventListener('mousemove', e => { if (start) move(e.clientX); });
  addEventListener('mouseup', e => { if (start) up(e.clientX, e.timeStamp, false); });
  nav.addEventListener('click', e => { if (eatClick && e.isTrusted) { e.stopPropagation(); e.preventDefault(); } }, true);
})();
addEventListener('resize', () => { const i = $('.tab-ind'); if (i) { i.style.transition = 'none'; moveTabInd(); i.offsetWidth; i.style.transition = ''; } });
// Kein Zoomen (iOS ignoriert user-scalable=no)
['gesturestart', 'gesturechange', 'gestureend'].forEach(t => document.addEventListener(t, e => e.preventDefault(), { passive: false }));
document.addEventListener('touchmove', e => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });
// iOS: nach dem Schließen der Tastatur bleibt die Seite manchmal verschoben
document.addEventListener('focusout', () => setTimeout(() => {
  const a = document.activeElement;
  if (!a || !/^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName)) window.scrollTo(0, 0);
}, 60));

// ---------- Demo-Modus (ohne Sheet) ----------
function demoApi(aktion, d) {
  const vor = (min) => new Date(Date.now() - min * 6e4).toISOString();
  const lead = (id, min, name, nr, interesse, fahrzeug, status, notizen = '', ki = '', naechster = '') => ({
    id, datum: vor(min), name, telefon: '+49 170 000000' + nr, wa: 'https://wa.me/49170000000' + nr, antworten: [['Interesse', interesse], ['Fahrzeug', fahrzeug]],
    anzeige: 'Referenzautos (Video)', quelle: 'Instagram', tabelle: 'Leads November 2026', status, notizen, ki, naechster });
  window.DEMO_LEADS ||= [
    lead('d1', 12, 'Lena Becker', 1, 'Referenzauto', 'VW Golf 8', 'Neu'),
    { ...lead('d2', 95, 'Markus Schmidt', 2, 'Aufbereitung', 'BMW X5', 'Neu'), quelle: 'Facebook' },
    lead('d3', 1500, 'Sabine Klein', 3, 'Referenzauto', 'Audi A4 Avant', 'Zurückrufen', '19.11.26 10:12 David: Will den Preis mit ihrem Mann besprechen und meldet sich. Heute nochmal anrufen.', 'Interessiert an einer Aufbereitung als Referenzauto, will den Preis erst mit ihrem Mann besprechen.\nNächster Schritt: Heute zurückrufen und den Termin festmachen.', heute()),
    { ...lead('d4', 2900, 'Tobias Wagner', 4, 'Aufbereitung', 'Mercedes C-Klasse', 'Nicht erreicht', '18.11.26 16:40 Jonathan: Mailbox, nichts drauf gesprochen.'), quelle: 'Website', anzeige: '' },
    { lex: 'K-d5', ...lead('d5', 4400, 'Julia Hoffmann', 5, 'Referenzauto', 'VW T6 Multivan', 'Terminiert', '17.11.26 09:05 David: Termin fest, bringt den Bus am Montag um 8 Uhr.', 'Will den T6 als Referenzauto aufbereiten lassen. Termin steht.\nNächster Schritt: Montag 8 Uhr Annahme vorbereiten.', ymd(new Date(Date.now() + 3 * 864e5))) },
    { lex: 'K-d6', ...lead('d6', 9000, 'Dennis Krämer', 6, 'Anderes', 'Porsche 911', 'Auftrag', '13.11.26 14:20 Jonathan: Komplettpaket gebucht, sehr zufrieden.') },
  ];
  const DL = window.DEMO_LEADS, kopie = x => JSON.parse(JSON.stringify(x));
  return new Promise((ok, nein) => setTimeout(() => {
    const l = DL.find(x => x.id === d.id);
    const jetzt = new Date().toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }).replace(',', '');
    if (aktion === 'liste') return ok({ lexware: true, leads: kopie(DL), tabellen: [{ name: 'Leads November 2026', anzahl: DL.length }], heimUrl: '' });
    if (aktion === 'feedback') return ok({});
    if (aktion === 'push' || aktion === 'pushTest' || aktion === 'foto') return ok({});
    if (aktion === 'vorlage') return ok({});
    if (aktion === 'fotos') return ok({ fotos: [], ordner: '' });
    const vermerk = t => { l.notizen = (l.notizen ? l.notizen + '\n\n' : '') + `${jetzt} ${konto.name || 'Demo'}: ${t}`; };
    const artikel = [['a1', 'Auftragspauschale', 58, 'Stück'], ['a2', 'Einfache Handwäsche Mittel & Oberklasse', 101.15, 'Stück'],
      ['a3', 'Interieur Aufbereitung', 226.1, 'Stück'], ['a4', 'Lackaufbereitung One-Step-Politur', 380.8, 'Aufwand'], ['a5', 'Polierarbeiten', 65.45, 'Stunde'],
      ['a6', 'Reinigung & Pflege von Ledersitzen', 41.65, 'Stück'], ['a7', '2 Stufen Keramikversiegelung', 714, 'Stück']].map(([id, name, preis, einheit]) => ({ id, name, preis, einheit }));
    if (aktion === 'statistik') {
      const tag = n => ymd(new Date(Date.now() - n * 864e5));
      return ok({ meta: { ausgaben: 312.45, impressionen: 40210, klicks: 812, waehrung: 'EUR' },
        angebote: [{ k: 'K-d6', s: 'accepted', b: 1890, d: tag(9) }, { k: 'K-d5', s: 'open', b: 1240.5, d: tag(3) }, { k: 'K-x', s: 'open', b: 1880, d: tag(2) }, { k: 'K-y', s: 'rejected', b: 420, d: tag(5) }],
        rechnungen: [{ nr: 'RE260470', k: 'K-d6', name: 'Dennis Krämer', s: 'paid', b: 1890, o: 0, d: tag(4), u: tag(1) },
          { nr: 'RE260468', k: 'K-x', name: 'Autohaus Muster', s: 'paid', b: 642.6, o: 0, d: tag(6), u: tag(3) },
          { nr: 'RE260471', k: 'K-z', name: 'Petra Lang', s: 'open', b: 380, o: 380, d: tag(1), u: tag(1) },
          { nr: 'RE260455', k: 'K-w', name: 'Firma Wolf', s: 'overdue', b: 512.4, o: 512.4, d: tag(20), u: tag(20) }] });
    }
    if (aktion === 'lexArtikel') return ok({ firma: 'JD Brüder (Demo)', artikel: artikel.map(a => ({ ...a, aus: (window.DEMO_AUS || []).includes(a.id) })) });
    if (aktion === 'angebotPdf') return ok({ nr: l.angebot.nr, daten: btoa('%PDF-1.4 Demo'), angebot: l.angebot });
    if (aktion === 'angebotMail') {
      vermerk(`Angebot ${l.angebot.nr} per Mail an ${d.email} geschickt`); l.angebot.gesendet = heute();
      return ok({ lead: kopie(l), angebot: l.angebot, nachfassen: '' });
    }
    if (aktion === 'gesendet') {
      vermerk(`Angebot ${l.angebot.nr} per ${d.weg} geschickt`); l.angebot.gesendet = heute();
      const nach = !l.naechster ? ymd(new Date(Date.now() + 3 * 864e5)) : '';
      if (nach) l.naechster = nach;
      return ok({ lead: kopie(l), angebot: l.angebot, nachfassen: nach });
    }
    if (aktion === 'artikelAus') { window.DEMO_AUS = d.aus; return ok({ aus: d.aus }); }
    if (aktion === 'nachziehen') { const n = DL.filter(x => AKTIV.includes(x.status) && !x.lex); n.forEach(x => { x.lex = 'demo'; }); return ok({ angelegt: n.length, rest: 0 }); }
    if (aktion === 'lexDaten') {
      if (d.speichern) l.kunde = { email: d.email, strasse: d.strasse, plz: d.plz, ort: d.ort };
      l.lex = l.lex || (d.speichern ? 'demo' : '');
      return ok({ lex: l.lex, kunde: l.kunde || { email: '', strasse: '', plz: '', ort: '' } });
    }
    if (aktion === 'lexAngebot') {
      const art = Object.fromEntries(artikel.map(a => [a.id, a]));
      const summe = d.posten.reduce((s, x) => s + x.menge * (x.artikel ? art[x.artikel].preis : x.preis), 0) * (1 - (d.rabatt || 0) / 100);
      l.lex = 'demo'; l.angebot = { nr: 'AG' + String(50 + Math.floor(Math.random() * 50)).padStart(4, '0'), summe, pdf: 'https://example.com/angebot.pdf', link: 'https://app.lexware.de/', datum: heute() };
      vermerk(`Angebot ${l.angebot.nr} erstellt (${euro(summe)}${d.rabatt ? `, ${d.rabatt} % Rabatt` : ''}): ${d.posten.map(x => (x.menge === 1 ? '' : x.menge + '× ') + (x.artikel ? art[x.artikel].name : x.name)).join(', ')}`);
      return ok({ lead: kopie(l), lex: 'demo', angebot: l.angebot, pdf64: btoa('%PDF-1.4 Demo') });
    }
    if (aktion === 'speichern') {
      if (d.status !== undefined) l.status = d.status;
      if (d.naechster !== undefined) l.naechster = d.naechster;
      if (d.notiz) l.notizen = (l.notizen ? l.notizen + '\n\n' : '') + `${jetzt} ${konto.name || 'Demo'}: ${d.notiz}`;
      return ok({ lead: kopie(l) });
    }
    if (aktion === 'ki') {
      if (!l.notizen) return nein(new Error('Es gibt noch keine Notizen zum Zusammenfassen.'));
      l.ki = `Demo-Zusammenfassung: ${l.name} interessiert sich für ${l.antworten.map(a => a[1]).join(', ')}. Im echten Betrieb schreibt Claude hier aus deinen Notizen eine Kurzfassung.\nNächster Schritt: Morgen anrufen und einen Termin vorschlagen.`;
      return ok({ lead: kopie(l), vorschlag: { status: 'Zurückrufen', naechster: morgen() } });
    }
  }, aktion === 'ki' ? 1400 : 250));
}

// ---------- Start ----------
tabHi();
render();
laden(true);
setInterval(() => { if (!document.hidden) laden(true); }, 60000);
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js');
// Wer Benachrichtigungen schon erlaubt hat, meldet sein Gerät still neu an (das Abo kann sich ändern)
if (angemeldet() && pushOk() && Notification.permission === 'granted') pushEin(true);
