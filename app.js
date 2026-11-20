// Oberfläche von JD Vertrieb. Die Daten liegen im Google Sheet, apps-script/vertrieb.gs liefert und speichert sie.
// Aufbau wie Dayliner: render() zeichnet die Seite des aktiven Tabs, sheet() öffnet ein Bottom-Sheet.
const VERSION = '1';
const STATUS = { 'Neu': 'var(--accent)', 'Nicht erreicht': 'var(--near)', 'Rückruf': 'var(--blue)', 'Termin': 'var(--teal)', 'Kunde': 'var(--ok)', 'Kein Interesse': 'rgba(255,255,255,.35)' };
const OFFEN = ['Neu', 'Nicht erreicht', 'Rückruf', 'Termin'];
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
let leads = [], sheetUrl = '', stand = null, laedt = false, fehlerText = '';
let tab = 'anrufen', filter = 'Offen', suche = '';
let offen = null;            // Lead, der gerade im Sheet offen ist
const vorschlag = {};        // KI-Vorschläge je Lead
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
async function laden(still) {
  if (!angemeldet() || laedt) return;
  laedt = true; $('.roundbtn')?.classList.add('spin');
  try {
    const j = await api('liste');
    const vorher = new Set(leads.map(l => l.id));
    const neu = j.leads.filter(l => !vorher.has(l.id));
    if (stand && neu.length) { toast(neu.length === 1 ? `🔔 Neuer Lead: ${neu[0].name}` : `🔔 ${neu.length} neue Leads`); haptic(); }
    leads = j.leads; sheetUrl = j.sheetUrl || ''; stand = new Date(); fehlerText = '';
  } catch (e) {
    if (e.code === 'pw') return abmelden(e.message);
    fehlerText = e.message; if (!still) toast(e.message);
  } finally { laedt = false; }
  // Wer gerade tippt (Suche, Name), verliert durch das Nachladen nicht den Cursor
  if (view.contains(document.activeElement) && document.activeElement.matches('input,textarea')) { if ($('#liste')) $('#liste').innerHTML = listeHtml(); }
  else render();
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
const faellig = l => OFFEN.includes(l.status) && l.naechster && l.naechster <= heute();
const telLink = l => 'tel:' + String(l.telefon).replace(/[^\d+]/g, '');
const datumKurz = s => { const d = new Date(s + 'T12:00'); return `${WD[d.getDay()]} ${pad(d.getDate())}.${pad(d.getMonth() + 1)}.`; };
function wann(l) {
  if (OFFEN.includes(l.status) && l.naechster) {
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
function leadZeile(l) {
  const info = [l.fahrzeug, l.interesse].filter(Boolean).join(' · ') || l.telefon;
  return `<div class="lead">
    <button class="open" onclick="openLead(${js(l.id)})"><span class="dot" style="--c:${STATUS[l.status] || STATUS.Neu}"></span>
      <span class="tt"><b>${esc(l.name || 'Ohne Namen')}</b><span>${esc(info)}</span></span>${wann(l)}</button>
    ${l.telefon ? `<a class="callbtn" href="${esc(telLink(l))}" onclick="anruf(event, ${js(l.id)})" aria-label="${esc(l.name)} anrufen">${ICON.phone}</a>` : ''}
  </div>`;
}
const block = (titel, liste) => liste.length ? `<div class="label">${titel}</div><div class="group">${liste.map(leadZeile).join('')}</div>` : '';
function kopf(titel) {
  return `<div class="phead"><h1>${titel}</h1><button class="roundbtn pill ${laedt ? 'spin' : ''}" onclick="laden()" aria-label="Aktualisieren">${ICON.refresh}</button></div>
  <p class="stand">${fehlerText ? `<span style="color:var(--minus)">${esc(fehlerText)}</span>` : stand ? `Stand ${pad(stand.getHours())}:${pad(stand.getMinutes())} Uhr` : 'Lädt…'}</p>`;
}

// ---------- Tab: Anrufen ----------
function renderAnrufen() {
  const faell = leads.filter(faellig).sort((a, b) => a.naechster.localeCompare(b.naechster));
  const neu = leads.filter(l => l.status === 'Neu' && !faellig(l));
  const nochmal = leads.filter(l => l.status === 'Nicht erreicht' && !faellig(l));
  const woche = leads.filter(l => Date.now() - new Date(l.datum) < 7 * 864e5).length;
  view.innerHTML = kopf('Anrufen') + (!stand && laedt ? '<p class="loading">Leads werden geladen…</p>' : `
    <div class="tiles">
      <div class="tile"><b>${woche}</b><span>Diese Woche</span></div>
      <div class="tile"><b>${leads.filter(l => OFFEN.includes(l.status)).length}</b><span>Offen</span></div>
      <div class="tile"><b>${leads.filter(l => l.status === 'Termin').length}</b><span>Termine</span></div>
    </div>
    ${block('Fällig', faell)}${block('Neu', neu)}${block('Nochmal versuchen', nochmal)}
    ${faell.length + neu.length + nochmal.length ? '' : '<div class="card empty"><b>🎉</b>Alles erledigt. Gerade wartet niemand auf einen Anruf.</div>'}`);
}

// ---------- Tab: Alle ----------
function gefiltert() {
  const q = suche.trim().toLowerCase();
  return leads.filter(l => (filter === 'Alle' || (filter === 'Offen' ? OFFEN.includes(l.status) : l.status === filter))
    && (!q || [l.name, l.telefon, l.fahrzeug, l.interesse, l.notizen].join(' ').toLowerCase().includes(q)));
}
function listeHtml() {
  const l = gefiltert();
  return l.length ? `<div class="group">${l.map(leadZeile).join('')}</div>` : '<div class="card empty">Keine Leads gefunden.</div>';
}
function renderAlle() {
  const anzahl = f => leads.filter(l => f === 'Alle' || (f === 'Offen' ? OFFEN.includes(l.status) : l.status === f)).length;
  view.innerHTML = kopf('Alle Leads') + `
    <label class="search">${ICON.search}<input type="search" placeholder="Name, Nummer, Fahrzeug" value="${esc(suche)}" oninput="suche=this.value;$('#liste').innerHTML=listeHtml()" aria-label="Leads durchsuchen"></label>
    <div class="scroller">${['Offen', 'Alle', ...Object.keys(STATUS)].map(f => `<button class="pill ${f === filter ? 'sel' : ''}" onclick="filter=${js(f)};render()">${f} <span class="n">${anzahl(f)}</span></button>`).join('')}</div>
    <div id="liste">${listeHtml()}</div>`;
}

// ---------- Tab: Setup ----------
function renderSetup() {
  view.innerHTML = `<div class="phead"><h1>Setup</h1></div>
    <div class="label">Du</div>
    <div class="group"><label class="row"><span>Dein Name</span><input value="${esc(konto.name)}" placeholder="z. B. David" onchange="konto.name=this.value.trim();merke('jdv-konto',konto);toast('Gespeichert')" autocomplete="given-name"></label></div>
    <p class="hint">Steht bei jeder Notiz dabei, damit ihr wisst, wer telefoniert hat.</p>
    <div class="label">App</div>
    <div class="group">
      <button class="row" onclick="installHilfe()"><span>📲 Auf den Startbildschirm</span><span>›</span></button>
      ${sheetUrl ? `<a class="row" href="${esc(sheetUrl)}" target="_blank" rel="noopener"><span>📊 Google Sheet öffnen</span><span>›</span></a>` : ''}
      <div class="row"><span>Version</span><span>${VERSION}</span></div>
    </div>
    ${DEMO ? '' : '<button class="pill wide" style="color:var(--minus);margin-top:var(--gap-l)" onclick="abmelden()">Abmelden</button>'}`;
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
    leads = j.leads; sheetUrl = j.sheetUrl || ''; stand = new Date();
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
  offen = id;
  sheet(leadHtml(l));
  const entwurf = lies('jdv-entwurf', {});
  if (entwurf[id]) { $('#notiz').value = entwurf[id]; delete entwurf[id]; merke('jdv-entwurf', entwurf); }
  if (fokus) setTimeout(() => $('#notiz')?.focus(), 300);
}
// Fenster neu zeichnen, ohne angefangene Notiz und Scrollposition zu verlieren
function leadNeu(id) {
  const l = leads.find(x => x.id === id), p = $('.panel');
  if (offen !== id || !l || !p) return;
  const txt = $('#notiz')?.value || '', top = p.scrollTop;
  p.innerHTML = '<div class="grab"></div>' + leadHtml(l);
  $('#notiz').value = txt; p.scrollTop = top;
}
function leadHtml(l) {
  const v = vorschlag[l.id];
  const vor = v && (v.status !== l.status || (v.naechster && v.naechster !== l.naechster)) ? `<div class="vorschlag"><span>Vorschlag: <b>${esc(v.status)}</b>${v.naechster ? `, melden am ${datumKurz(v.naechster)}` : ''}</span><button class="pill sm sel" onclick="uebernehmen(${js(l.id)})">Übernehmen</button></div>` : '';
  const zeile = (k, w) => w ? `<div class="row"><span>${k}</span><span>${esc(w)}</span></div>` : '';
  const eingang = new Date(l.datum);
  return `<div class="sheet-head"><span></span><h2>${esc(l.name || 'Ohne Namen')}</h2><button class="pill" onclick="closeSheet()">Fertig</button></div>
    <p class="sub">${esc([l.fahrzeug, l.interesse].filter(Boolean).join(' · ') || 'Keine Angaben zu Fahrzeug und Interesse')}</p>
    <div class="two">
      ${l.telefon ? `<a class="big" href="${esc(telLink(l))}" onclick="anruf(event, ${js(l.id)})">${ICON.phone}Anrufen</a>` : '<button class="big" disabled>Keine Nummer</button>'}
      ${l.wa ? `<a class="big wa" href="${esc(l.wa)}" target="_blank" rel="noopener">${ICON.wa}WhatsApp</a>` : ''}
    </div>
    <div class="label">Status</div>
    <div class="seg">${Object.keys(STATUS).map(s => `<button class="pill ${s === l.status ? 'sel' : ''}" onclick="setze(${js(l.id)},{status:${js(s)}})">${s}</button>`).join('')}</div>
    <div class="group"><label class="row"><span>Nächster Kontakt</span><input type="date" value="${esc(l.naechster)}" onchange="setze(${js(l.id)},{naechster:this.value})"></label></div>
    <div class="label">Neue Notiz</div>
    <textarea id="notiz" placeholder="Wie lief das Gespräch? Was will der Kunde?"></textarea>
    <p class="hint">🎙️ Tipp aufs Mikrofon der Tastatur und erzähl einfach. Beim Schließen wird die Notiz automatisch gespeichert.</p>
    <button class="pill wide" id="nbtn" onclick="notizSpeichern(${js(l.id)})">Notiz speichern</button>
    <div class="label">KI-Zusammenfassung</div>
    <div class="card"><div class="ki" id="ki">${l.ki ? esc(l.ki) : '<span class="muted">Noch keine. Sobald du eine Notiz speicherst, fasst Claude zusammen.</span>'}</div>${vor}
      ${l.notizen ? `<button class="pill wide" id="kbtn" style="margin:var(--gap) 0 0" onclick="kiStarten(${js(l.id)})">✨ ${l.ki ? 'Neu zusammenfassen' : 'Zusammenfassen'}</button>` : ''}</div>
    <div class="label">Verlauf</div>
    <div class="card verlauf">${l.notizen ? esc(l.notizen) : '<span class="muted">Noch keine Notizen.</span>'}</div>
    <div class="label">Details</div>
    <div class="group">${zeile('Telefon', l.telefon)}${zeile('Eingang', isNaN(eingang) ? '' : eingang.toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' }))}${zeile('Anzeige', l.anzeige)}${zeile('Zuletzt bearbeitet', l.bearbeitet)}</div>`;
}
async function setze(id, aend) {
  const l = leads.find(x => x.id === id); if (!l) return;
  const alt = { ...l };
  Object.assign(l, aend); leadNeu(id); render();
  try {
    Object.assign(l, (await api('speichern', { id, ...aend })).lead);
    toast(aend.status ? `Status: ${aend.status}` : aend.naechster ? `Melden am ${datumKurz(aend.naechster)}` : 'Gespeichert');
  } catch (e) { Object.assign(l, alt); toast(e.message); }
  leadNeu(id); render();
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
function anruf(e, id) {
  merke('jdv-anruf', { id, t: Date.now(), weg: false });
  if (DEMO) {
    e.preventDefault(); toast('Demo: Jetzt würde das Telefon wählen.');
    setTimeout(() => { merke('jdv-anruf', null); openLead(id, true); toast('Wie lief das Gespräch?'); }, 1800);
  }
}
document.addEventListener('visibilitychange', () => {
  const a = lies('jdv-anruf', null);
  if (document.hidden) { if (a) merke('jdv-anruf', { ...a, weg: true }); return; }
  laden(true);
  if (a?.weg && Date.now() - a.t < 3600e3) {
    merke('jdv-anruf', null);
    const l = leads.find(x => x.id === a.id);
    if (l) { openLead(a.id, true); toast(`Wie lief es mit ${l.name}?`); }
  }
});

// ---------- Fenster, Meldungen ----------
function sheet(html) {
  $('#sheet').innerHTML = `<div class="backdrop" onclick="closeSheet()"></div><div class="panel"><div class="grab"></div>${html}</div>`;
  $('#sheet').hidden = false;
}
function closeSheet() {
  const id = offen, notiz = $('#notiz')?.value.trim();
  $('#sheet').hidden = true; $('#sheet').innerHTML = ''; offen = null;
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
  window.DEMO_LEADS ||= [
    { id: 'd1', datum: vor(12), name: 'Lena Becker', telefon: '+49 170 0000001', interesse: 'Premium-Aufbereitung', fahrzeug: 'VW Golf 8', anzeige: 'Herbst Aufbereitung', wa: 'https://wa.me/491700000001', status: 'Neu', notizen: '', ki: '', naechster: '', bearbeitet: '' },
    { id: 'd2', datum: vor(95), name: 'Markus Schmidt', telefon: '+49 170 0000002', interesse: 'Leasingrückläufer', fahrzeug: 'BMW X5', anzeige: 'Leasing zurück', wa: 'https://wa.me/491700000002', status: 'Neu', notizen: '', ki: '', naechster: '', bearbeitet: '' },
    { id: 'd3', datum: vor(1500), name: 'Sabine Klein', telefon: '+49 170 0000003', interesse: 'Scheibentönung', fahrzeug: 'Audi A4 Avant', anzeige: 'Folientechnik', wa: 'https://wa.me/491700000003', status: 'Rückruf', notizen: '19.11.26 10:12 David: Will Preis für hinten und Heckscheibe, ruft nach Rücksprache mit Mann zurück. Heute nochmal melden.', ki: 'Interessiert an Tönung der hinteren Scheiben am Audi A4. Will den Preis erst mit ihrem Mann besprechen.\nNächster Schritt: Heute zurückrufen und Angebot ab 220 € nennen.', naechster: heute(), bearbeitet: '19.11.26 10:12 David' },
    { id: 'd4', datum: vor(2900), name: 'Tobias Wagner', telefon: '+49 170 0000004', interesse: 'Basic', fahrzeug: 'Mercedes C-Klasse', anzeige: 'Herbst Aufbereitung', wa: 'https://wa.me/491700000004', status: 'Nicht erreicht', notizen: '18.11.26 16:40 Jonathan: Mailbox, nichts drauf gesprochen.', ki: '', naechster: '', bearbeitet: '18.11.26 16:40 Jonathan' },
    { id: 'd5', datum: vor(4400), name: 'Julia Hoffmann', telefon: '+49 170 0000005', interesse: 'Sternenhimmel', fahrzeug: 'VW T6 Multivan', anzeige: 'Veredeln', wa: 'https://wa.me/491700000005', status: 'Termin', notizen: '17.11.26 09:05 David: Termin fest, bringt den Bus am Montag um 8 Uhr.', ki: 'Will einen Sternenhimmel im T6. Termin steht.\nNächster Schritt: Montag 8 Uhr Annahme vorbereiten.', naechster: ymd(new Date(Date.now() + 3 * 864e5)), bearbeitet: '17.11.26 09:05 David' },
    { id: 'd6', datum: vor(9000), name: 'Dennis Krämer', telefon: '+49 170 0000006', interesse: 'Luxus', fahrzeug: 'Porsche 911', anzeige: 'Herbst Aufbereitung', wa: 'https://wa.me/491700000006', status: 'Kunde', notizen: '13.11.26 14:20 Jonathan: Luxus-Paket gebucht, sehr zufrieden.', ki: '', naechster: '', bearbeitet: '13.11.26 14:20 Jonathan' },
  ];
  const DL = window.DEMO_LEADS, kopie = x => JSON.parse(JSON.stringify(x));
  return new Promise((ok, nein) => setTimeout(() => {
    const l = DL.find(x => x.id === d.id);
    const jetzt = new Date().toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }).replace(',', '');
    if (aktion === 'liste') return ok({ leads: kopie(DL), sheetUrl: '' });
    if (aktion === 'feedback') return ok({});
    if (aktion === 'speichern') {
      if (d.status !== undefined) l.status = d.status;
      if (d.naechster !== undefined) l.naechster = d.naechster;
      if (d.notiz) l.notizen = (l.notizen ? l.notizen + '\n\n' : '') + `${jetzt} ${konto.name || 'Demo'}: ${d.notiz}`;
      l.bearbeitet = `${jetzt} ${konto.name || 'Demo'}`;
      return ok({ lead: kopie(l) });
    }
    if (aktion === 'ki') {
      if (!l.notizen) return nein(new Error('Es gibt noch keine Notizen zum Zusammenfassen.'));
      l.ki = `Demo-Zusammenfassung: ${l.name} interessiert sich für ${l.interesse} am ${l.fahrzeug}. Im echten Betrieb schreibt Claude hier aus deinen Notizen eine Kurzfassung.\nNächster Schritt: Morgen anrufen und einen Termin vorschlagen.`;
      return ok({ lead: kopie(l), vorschlag: { status: 'Rückruf', naechster: morgen() } });
    }
  }, aktion === 'ki' ? 1400 : 250));
}

// ---------- Start ----------
tabHi();
render();
laden(true);
setInterval(() => { if (!document.hidden) laden(true); }, 60000);
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js');
