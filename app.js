// Oberfläche von JD Vertrieb. Die Daten liegen im Google Sheet, apps-script/vertrieb.gs liefert und speichert sie.
// Aufbau wie Dayliner: render() zeichnet die Seite des aktiven Tabs, sheet() öffnet ein Bottom-Sheet.
const VERSION = '17';
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
// WhatsApp bei „Nicht erreicht“. Die Vorlage gilt fürs ganze Team und liegt im Google-Skript (Setup → WhatsApp-Nachricht).
const VORLAGE_STANDARD = 'Hallo {Name}, hier ist {Ich} von JD Brüder. Ich habe gerade versucht, dich wegen deiner Anfrage zum Thema {Wunsch} anzurufen. Wann passt es dir am besten für einen kurzen Rückruf?';
let vorlage = VORLAGE_STANDARD;
// Lexware: Angebot und Kundendaten (nur sichtbar, wenn im Google-Skript ein Schlüssel hinterlegt ist)
const LEX_APP = 'https://app.lexware.de/permalink/';
let lexAn = false, lexArtikelCache = null, angebot = null;   // angebot: gerade offene Angebotsseite
const kundeCache = {}, kundeUhr = {};   // E-Mail und Adresse je Lead (aus Lexware oder gerade eingetippt), Speichern mit kurzer Pause
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
function uebernimm(j) { leads = j.leads; tabellen = j.tabellen || []; heimUrl = j.heimUrl || ''; vorlage = j.vorlage || VORLAGE_STANDARD; lexAn = DEMO || !!j.lexware; stand = new Date(); }
async function laden(still) {
  if (!angemeldet() || laedt) return;
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
  ({ anrufen: renderAnrufen, alle: renderAlle, setup: renderSetup })[tab]();
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
const wunsch = l => (l.antworten.find(a => a[0] === 'Interesse') || l.antworten[0] || [])[1] || '';
const waText = l => vorlage.replaceAll('{Name}', (l.name || '').split(' ')[0]).replaceAll('{Wunsch}', wunsch(l) || 'Fahrzeugaufbereitung')
  .replaceAll('{Ich}', konto.name || 'das Team').replace(/ +,/g, ',');
function leadZeile(l) {
  const info = wunsch(l) || l.telefon;
  return `<div class="lead">
    <button class="open" onclick="openLead(${js(l.id)})"><span class="dot" style="--c:${STATUS[l.status] || STATUS.Neu}"></span>
      <span class="tt"><b>${esc(l.name || 'Ohne Namen')}</b><span>${esc(info)}</span></span>${wann(l)}</button>
    ${l.wa ? `<a class="callbtn wa" href="${esc(l.wa)}" target="_blank" rel="noopener" aria-label="${esc(l.name)} auf WhatsApp schreiben">${ICON.wa}</a>` : ''}
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
function renderSetup() {
  view.innerHTML = `<div class="phead"><h1>Setup</h1></div>
    <div class="label">Du</div>
    <div class="group"><label class="row"><span>Dein Name</span><input value="${esc(konto.name)}" placeholder="z. B. David" onchange="konto.name=this.value.trim();merke('jdv-konto',konto);toast('Gespeichert')" autocomplete="given-name"></label></div>
    <p class="hint">Steht bei jeder Notiz dabei, damit ihr wisst, wer telefoniert hat.</p>
    <div class="label">Lead-Tabellen</div>
    <div class="group">
      ${tabellen.map(t => t.fehler ? `<div class="row"><span>⚠️ ${esc(t.name)}</span><span style="color:var(--minus)">klemmt</span></div>`
        : t.url ? `<a class="row" href="${esc(t.url)}" target="_blank" rel="noopener"><span>📊 ${esc(t.name)}</span><span>${t.anzahl} ›</span></a>`
        : `<div class="row"><span>📊 ${esc(t.name)}</span><span>${t.anzahl}</span></div>`).join('')}
      ${heimUrl ? `<a class="row" href="${esc(heimUrl)}" target="_blank" rel="noopener"><span>➕ Tabelle verbinden</span><span>›</span></a>` : ''}
    </div>
    ${tabellen.filter(t => t.fehler).map(t => `<p class="hint" style="color:var(--minus)">${esc(t.name)}: ${esc(t.fehler)}</p>`).join('')}
    <p class="hint">Neue Kampagne? Tipp auf „Tabelle verbinden“ und setz den Link zur neuen Lead-Tabelle in die nächste freie Zeile in Spalte A.</p>
    <div class="label">Design</div>
    <div class="two">${[['dunkel', '🌙 Dunkel'], ['hell', '☀️ Hell']].map(([k, t]) => `<button class="pill ${lies('jdv-design', 'dunkel') === k ? 'sel' : ''}" aria-pressed="${lies('jdv-design', 'dunkel') === k}" onclick="designSetzen('design', '${k}')">${t}</button>`).join('')}</div>
    <div class="group"><label class="row"><span>✨ Gold im Hintergrund</span><input type="checkbox" switch ${lies('jdv-gold', true) ? 'checked' : ''} onchange="designSetzen('gold', this.checked)"></label></div>
    <div class="label">WhatsApp bei „Nicht erreicht“</div>
    <textarea id="vorlage" aria-label="WhatsApp-Nachricht" onchange="vorlageSpeichern(this)">${esc(vorlage)}</textarea>
    <p class="hint">{Name} wird zum Vornamen des Kunden, {Wunsch} zu dem, was er will, {Ich} zu deinem Namen. {Name} und {Wunsch} müssen drinbleiben. Gilt fürs ganze Team.</p>
    <p class="hint">Vorschau: ${esc(waText({ name: 'Kevin', antworten: [['Interesse', 'Referenzauto']] }))}</p>
    <div class="label">App</div>
    <div class="group">
      <button class="row" onclick="installHilfe()"><span>📲 Auf den Startbildschirm</span><span>›</span></button>
      ${pushOk() ? `<button class="row" onclick="pushEin()"><span>🔔 Benachrichtigungen</span><span>${Notification.permission === 'granted' ? 'An' : 'Einschalten ›'}</span></button>`
        : '<div class="row"><span>🔔 Benachrichtigungen</span><span class="muted">Erst auf den Startbildschirm</span></div>'}
      ${lexAn ? '<button class="row" onclick="lexPruefen()"><span>🧾 Lexware</span><span>Prüfen ›</span></button>' : '<div class="row"><span>🧾 Lexware</span><span class="muted">Nicht verbunden</span></div>'}
      <div class="row"><span>Version</span><span>${VERSION}</span></div>
    </div>
    ${DEMO ? '' : '<button class="pill wide" style="color:var(--minus);margin-top:var(--gap-l)" onclick="abmelden()">Abmelden</button>'}`;
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
  if (lexAn && !kundeCache[id]) kundeLaden(id);
  const entwurf = lies('jdv-entwurf', {});
  if (entwurf[id]) { $('#notiz').value = entwurf[id]; delete entwurf[id]; merke('jdv-entwurf', entwurf); }
  if (fokus) setTimeout(() => $('#notiz')?.focus(), 300);
}
// Fenster neu zeichnen, ohne angefangene Notiz und Scrollposition zu verlieren
function leadNeu(id) {
  const l = leads.find(x => x.id === id), p = $('.panel');
  if (offen !== id || !l || !p) return;
  const txt = $('#notiz')?.value || '', top = p.scrollTop;
  if ($('#kunde')) kundeCache[id] = kundeFelder();
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
      ${waFrage[l.id] && l.wa ? `<div class="vorschlag"><span>Per WhatsApp schreiben?</span><a class="pill sm sel" href="${esc(l.wa + '?text=' + encodeURIComponent(waText(l)))}" target="_blank" rel="noopener" onclick="waGeschickt(${id})">WhatsApp</a><button class="pill sm" onclick="delete waFrage[${id}];leadNeu(${id})">Nein</button></div>` : ''}
      <div class="fussoben"><button class="pill statuswahl" aria-expanded="false" aria-controls="statusmenu" onclick="statusMenu()"><span class="dot" style="--c:${STATUS[l.status] || STATUS.Neu}"></span><b>${esc(l.status)}</b><span class="muted" aria-hidden="true">▴</span></button>${lexAn ? `<button class="pill sel" onclick="angebotOeffnen(${id})">🧾 Angebot</button>` : ''}</div>
      <div class="two">
        ${l.telefon ? `<a class="big" href="${esc(telLink(l))}" onclick="anruf(event, ${id})">${ICON.phone}Anrufen</a>` : '<button class="big" disabled>Keine Nummer</button>'}
        ${l.wa ? `<a class="big wa" href="${esc(l.wa)}" target="_blank" rel="noopener">${ICON.wa}WhatsApp</a>` : ''}
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
async function vorlageSpeichern(t) {
  const neu = t.value.trim();
  if (!neu.includes('{Name}') || !neu.includes('{Wunsch}')) { t.value = vorlage; return toast('{Name} und {Wunsch} müssen in der Nachricht bleiben.'); }
  try { await api('vorlage', { vorlage: neu }); vorlage = neu; toast('WhatsApp-Nachricht gespeichert'); render(); }
  catch (e) { t.value = vorlage; toast(e.message); }
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
  const wa = `${l.wa || 'https://wa.me/'}?text=${encodeURIComponent(`Hallo${vorname ? ' ' + vorname : ''}, hier sind die Fotos von deinem Auto: ${f?.ordner}`)}`;
  return `${f?.fotos.length ? `<div class="fotos">${f.fotos.map(x => `<a href="${esc(x.url)}" target="_blank" rel="noopener">${x.bild ? `<img src="${esc(x.bild)}" alt="${esc(x.name)}" loading="lazy">` : '<span>🖼️</span>'}</a>`).join('')}</div>` : ''}
    <p class="muted" style="margin:0 0 var(--gap)">${esc(st || (!f ? 'Fotos werden geladen…' : f.fotos.length ? `${f.fotos.length} ${f.fotos.length === 1 ? 'Foto' : 'Fotos'}` : 'Noch keine Fotos. Mach sie, wenn das Auto bei euch steht.'))}</p>
    <label class="pill wide">📷 Fotos hinzufügen<input type="file" accept="image/*" multiple hidden onchange="fotosHoch(${js(l.id)}, this.files)"></label>
    ${rest.length && !st ? `<button class="pill wide" onclick="fotosHoch(${js(l.id)}, fotoRest[${js(l.id)}])">↻ ${rest.length} nicht hochgeladene Fotos nochmal senden</button>` : ''}
    ${f?.fotos.length ? `<div class="two" style="margin:0"><a class="pill" href="${esc(f.ordner)}" target="_blank" rel="noopener">📁 Ordner</a><a class="pill" href="${esc(wa)}" target="_blank" rel="noopener">📤 An Kunden</a></div>` : ''}`;
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
const anrede = l => { const v = (l.name || '').split(' ')[0]; return `Hallo${v ? ' ' + v : ''}`; };
// Im Kundenfenster oben: Angebot erstellen, letztes Angebot verschicken, E-Mail und Adresse (gehen direkt nach Lexware)
function kundeBlock(l) {
  const id = js(l.id), a = l.angebot, k = kundeCache[l.id] || l.kunde || {};
  const wa = a?.pdf && l.wa ? `${l.wa}?text=${encodeURIComponent(`${anrede(l)}, hier ist dein Angebot ${a.nr} von JD Brüder: ${a.pdf}\nMeld dich gern, wenn du Fragen hast.`)}` : '';
  const feld = (f, name, extra = '') => `<div class="row"><label for="k-${f}">${name}</label><input id="k-${f}" value="${esc(k[f] || '')}" autocomplete="off" onchange="kundeGeaendert(${id})"${extra}></div>`;
  // Neues Angebot: Knopf „Angebot“ in der festen Leiste unten, auch mitten im Telefonat ohne Scrollen
  return `${a ? `<div class="label">Letztes Angebot</div>
    <div class="card" id="angebotkarte">
      <p class="angebotzeile"><span><b>${esc(a.nr || 'Angebot')}</b> · ${euro(a.summe)}</span><span class="muted">${a.datum ? 'vom ' + datumKurz(a.datum) : ''}</span></p>
      ${a.pdf ? `<div class="drei">${wa ? `<a class="pill" href="${esc(wa)}" target="_blank" rel="noopener" onclick="angebotGeschickt(${id}, 'WhatsApp')">${ICON.wa}WhatsApp</a>` : ''}<button class="pill" onclick="angebotMail(${id})">✉️ Mail</button><a class="pill" href="${esc(a.pdf)}" target="_blank" rel="noopener">📄 PDF</a></div>`
        : `<a class="pill wide" style="margin:0" href="${esc(a.link)}" target="_blank" rel="noopener">Das PDF fehlt noch. In Lexware öffnen ↗</a>`}
    </div>` : ''}
    <div class="label">Kundendaten</div>
    <div class="group" id="kunde">${feld('email', 'E-Mail', ' type="email" inputmode="email" autocapitalize="off"')}${feld('strasse', 'Straße')}${feld('plz', 'PLZ', ' inputmode="numeric" maxlength="10"')}${feld('ort', 'Ort')}</div>
    <p class="hint">Wird direkt in Lexware gespeichert.${l.lex ? ` <a href="${esc(LEX_APP + 'contacts/view/' + l.lex)}" target="_blank" rel="noopener">Kunde in Lexware ↗</a>` : ''}</p>`;
}
const kundeFelder = () => Object.fromEntries(['email', 'strasse', 'plz', 'ort'].map(f => [f, $('#k-' + f)?.value.trim() || '']));
async function kundeLaden(id) {
  try {
    const j = await api('lexDaten', { id }), l = leads.find(x => x.id === id);
    if (l && j.lex) l.lex = j.lex;
    kundeCache[id] ||= j.kunde;
    if (offen === id) for (const [f, v] of Object.entries(j.kunde)) { const el = $('#k-' + f); if (el && !el.value && document.activeElement !== el) el.value = v; }
  } catch (e) { if (offen === id) toast(e.message); }
}
// Feld verlassen: kurz warten (vielleicht kommt gleich das nächste Feld), dann alles auf einmal nach Lexware
function kundeGeaendert(id) {
  const k = kundeCache[id] = kundeFelder();
  clearTimeout(kundeUhr[id]);
  if (k.email && !MAIL_OK.test(k.email)) return toast('Die E-Mail-Adresse sieht nicht richtig aus.');
  kundeUhr[id] = setTimeout(async () => {
    try {
      const j = await api('lexDaten', { id, speichern: true, ...k }), l = leads.find(x => x.id === id);
      if (l) l.lex = j.lex;
      toast('In Lexware gespeichert');
    } catch (e) { toast(e.message); }
  }, 800);
}
function angebotGeschickt(id, weg) {
  const nr = leads.find(x => x.id === id)?.angebot?.nr || '';
  api('speichern', { id, notiz: `Angebot ${nr} per ${weg} geschickt` })
    .then(j => { Object.assign(leads.find(x => x.id === id) || {}, j.lead); leadNeu(id); }).catch(e => toast(e.message));
}
function angebotMail(id) {
  const l = leads.find(x => x.id === id), a = l?.angebot, email = ($('#k-email')?.value || kundeCache[id]?.email || '').trim();
  if (!a) return;
  if (!MAIL_OK.test(email)) { toast('Trag erst die E-Mail-Adresse ein.'); return $('#k-email')?.focus(); }
  location.href = `mailto:${email}?subject=${encodeURIComponent(`Dein Angebot ${a.nr} von JD Brüder`)}&body=${encodeURIComponent(`${anrede(l)},\n\nhier ist dein Angebot ${a.nr}:\n${a.pdf}\n\nMeld dich gern, wenn du Fragen hast.\n\nViele Grüße\n${konto.name || 'JD Brüder'}\nJD Brüder`)}`;
  angebotGeschickt(id, 'Mail');
}
async function lexPruefen() {
  try { const j = await api('lexArtikel'); lexArtikelCache = j.artikel; toast(`Lexware verbunden: ${j.firma}, ${j.artikel.length} Artikel`); }
  catch (e) { toast(e.message); }
}
// Angebotsseite im selben Fenster, gedacht fürs Telefonat: oben was im Angebot ist, darunter alle Artikel zum Suchen
const angebotSumme = a => [...(a.artikel || []).filter(x => a.menge[x.id]).map(x => x.preis * a.menge[x.id]), ...a.eigene.map(x => x.preis)].reduce((s, x) => s + x, 0);
async function angebotOeffnen(id) {
  const notiz = $('#notiz')?.value.trim();   // angefangene Notiz bleibt als Entwurf am Lead
  if (notiz) merke('jdv-entwurf', { ...lies('jdv-entwurf', {}), [id]: notiz });
  if ($('#kunde')) kundeCache[id] = kundeFelder();
  const l = leads.find(x => x.id === id), ref = /referenz/i.test(wunsch(l));   // Aktion: 20 % für Referenzkunden
  offen = null;
  const a = angebot = { id, artikel: lexArtikelCache, menge: {}, eigene: [], rabatt: ref ? 20 : 0, referenz: ref, suche: '' };
  angebotZeichnen(); $('.panel').scrollTop = 0;
  try { lexArtikelCache = (await api('lexArtikel')).artikel; } catch (e) { a.fehler = e.message; }
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
    lead('d2', 95, 'Markus Schmidt', 2, 'Aufbereitung', 'BMW X5', 'Neu'),
    lead('d3', 1500, 'Sabine Klein', 3, 'Referenzauto', 'Audi A4 Avant', 'Zurückrufen', '19.11.26 10:12 David: Will den Preis mit ihrem Mann besprechen und meldet sich. Heute nochmal anrufen.', 'Interessiert an einer Aufbereitung als Referenzauto, will den Preis erst mit ihrem Mann besprechen.\nNächster Schritt: Heute zurückrufen und den Termin festmachen.', heute()),
    lead('d4', 2900, 'Tobias Wagner', 4, 'Aufbereitung', 'Mercedes C-Klasse', 'Nicht erreicht', '18.11.26 16:40 Jonathan: Mailbox, nichts drauf gesprochen.'),
    lead('d5', 4400, 'Julia Hoffmann', 5, 'Referenzauto', 'VW T6 Multivan', 'Terminiert', '17.11.26 09:05 David: Termin fest, bringt den Bus am Montag um 8 Uhr.', 'Will den T6 als Referenzauto aufbereiten lassen. Termin steht.\nNächster Schritt: Montag 8 Uhr Annahme vorbereiten.', ymd(new Date(Date.now() + 3 * 864e5))),
    lead('d6', 9000, 'Dennis Krämer', 6, 'Anderes', 'Porsche 911', 'Auftrag', '13.11.26 14:20 Jonathan: Komplettpaket gebucht, sehr zufrieden.'),
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
    if (aktion === 'lexArtikel') return ok({ firma: 'JD Brüder (Demo)', artikel });
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
      return ok({ lead: kopie(l), lex: 'demo', angebot: l.angebot });
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
