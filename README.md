# JD Vertrieb

Handy-App für die Meta-Leads von JD Brüder. Neue Leads sehen, mit einem Tipp anrufen, Notizen festhalten, Claude fasst das Gespräch zusammen und schlägt den nächsten Schritt vor.

- **App:** reines HTML, CSS und JS ohne Build (Design aus Dayliner, Farben JD Schwarz und Gold). Läuft auf GitHub Pages.
- **Daten:** bleiben in den Lead-Tabellen, in die Meta die Leads einträgt (eine Tabelle pro Kampagne, z. B. „Leads November 2026“). Welche Tabellen die App liest, steht in einer kleinen Google-Tabelle „JD Vertrieb“. Dort liegt auch das Skript `apps-script/vertrieb.gs`, das die Leads an die App liefert und Status, Notiz und Termin zurückschreibt.
- **Geheimnisse:** Team-Passwort und Claude-Schlüssel liegen nur in den Skripteigenschaften bei Google, nie im Code.

Das Skript darf auch als zweite Datei neben dem Sortier-Skript in einer Lead-Tabelle liegen (so ist es bei JD gerade, in „Leads Nov 2026“). Die Links zu den Lead-Tabellen stehen dann in einem eigenen Reiter in Spalte A. Das Sortier-Skript bleibt dabei in seiner eigenen Datei, sonst sortiert und färbt niemand mehr.

Ohne eingetragene Schnittstelle (`config.js` leer) läuft die App im Demo-Modus mit Beispiel-Leads.

## Einrichten (einmalig, ca. 10 Minuten)

Alles im Google-Konto, dem die Lead-Tabellen gehören.

1. **Tabelle „JD Vertrieb“ anlegen:** In Google Drive eine neue, leere Google-Tabelle anlegen und „JD Vertrieb“ nennen. In Zelle **A1** den Link zur Lead-Tabelle einfügen. Spalte B füllt die App später mit dem Namen.
2. **Skript einfügen:** In „JD Vertrieb“ auf *Erweiterungen → Apps Script*. Den vorhandenen Inhalt löschen, den kompletten Inhalt von [`apps-script/vertrieb.gs`](apps-script/vertrieb.gs) einfügen und speichern.
3. **Passwort und Schlüssel hinterlegen:** Links Zahnrad *Projekteinstellungen* → ganz unten *Skripteigenschaften* → *Skripteigenschaft hinzufügen*:
   - `TEAM_PASSWORT` = ein Passwort, das ihr euch ausdenkt (damit meldet ihr euch in der App an)
   - `ANTHROPIC_API_KEY` = euer Claude-Schlüssel (beginnt mit `sk-ant-api`, zu finden unter console.anthropic.com → API Keys)
   - `PUSH_GEHEIMNIS` = das Geheimnis des Push-Dienstes (steht lokal in `push/.geheimnis`, siehe unten)
   - `LEXWARE_API_KEY` = Schlüssel aus Lexware Office (*Einstellungen → Öffentliche API*, gibt es ab Tarif XL), optional
4. **Als Web-App bereitstellen:** Oben rechts *Bereitstellen → Neue Bereitstellung*. Beim Zahnrad *Typ auswählen* → **Web-App**. *Ausführen als:* **Ich**, *Zugriff:* **Jeder**. Auf *Bereitstellen*, Zugriff erlauben (Google fragt nach Tabellen und externen Verbindungen). Die **Web-App-URL** kopieren (endet auf `/exec`).
5. **URL eintragen:** Die URL in `config.js` bei `window.JD_API` eintragen und hochladen (oder einfach an Claude schicken). Die URL ist kein Geheimnis, ohne Passwort liefert sie nichts.
6. **App öffnen:** Link der App auf dem Handy öffnen, Name und Team-Passwort eingeben, dann *Setup → Auf den Startbildschirm*.

**Test:** Die Web-App-URL im Browser öffnen. Steht dort „JD Vertrieb Schnittstelle läuft.“, ist alles bereit.

Danach im Apps Script oben die Funktion **vertriebEinrichten** wählen und **Ausführen**. Sie fragt die Berechtigungen ab (Drive für die Fotos) und legt die Zeitauslöser für die Benachrichtigungen an.

## Benachrichtigungen

- Jede Minute schaut das Skript, ob sich eine Lead-Tabelle geändert hat, und meldet neue Leads aufs Handy. Ein Tipp auf die Nachricht öffnet den Lead.
- Morgens gegen 8 Uhr kommt eine Nachricht mit allen Leads, bei denen heute ein Rückruf oder Termin fällig ist.
- Einschalten pro Handy: App auf den Startbildschirm, dann *Setup → Benachrichtigungen*. Auf dem iPhone geht das nur in der installierten App (ab iOS 16.4).
- Versendet wird über einen kleinen, kostenlosen Dienst bei Cloudflare (`push/worker.js`, wie bei Dayliner). Er merkt sich nichts, das Skript schickt die Geräte mit. Neu hochladen: im Ordner `push` `npx wrangler deploy`. Geheimnisse dort: `VAPID_PRIVATE` (aus `push/.vapid-private`) und `GEHEIMNIS` (aus `push/.geheimnis`, dasselbe wie `PUSH_GEHEIMNIS` im Skript). Beide Dateien liegen nur lokal.

## Fotos

Beim Lead unter *Fotos* lassen sich Bilder in voller Auflösung hochladen, eins nach dem anderen. Sie landen in Google Drive im Ordner **JD Vertrieb Fotos**, pro Kunde ein Unterordner mit Name und Auto. Der Unterordner ist für jeden mit dem Link sichtbar, damit *An Kunden* den Link direkt per WhatsApp verschicken kann. Der kostenlose Google-Speicher (15 GB) reicht für grob 100 Autos mit je 30 Fotos.

## WhatsApp bei „Nicht erreicht“

Wer beim Lead den Status auf *Nicht erreicht* setzt, bekommt die Frage „Per WhatsApp schreiben?“. Ein Tipp öffnet WhatsApp mit fertigem Text, im Verlauf landet ein Vermerk. Den Text stellt man unter *Setup → WhatsApp bei „Nicht erreicht“* ein, er gilt fürs ganze Team (Skripteigenschaft `WA_VORLAGE`). Platzhalter: `{Name}` (Vorname des Kunden) und `{Wunsch}` (Interesse) müssen drinbleiben, `{Ich}` ist der Name dessen, der schreibt.

## Lexware

Ist `LEXWARE_API_KEY` hinterlegt (Skripteigenschaft im Google-Skript), passiert Folgendes:

- **Jede neue Anfrage wird sofort Kunde in Lexware**, mit Name, Handynummer, Interesse und Fahrzeug als Notiz, dazu E-Mail und Adresse, falls das Meta-Formular sie abfragt (Felder `email`, `street_address`, `post_code`/`zip_code`, `city`). Das Skript merkt sich die Kontakt-id (`LEX_<Lead-id>`). Gibt es in Lexware schon einen Kunden mit gleichem Nachnamen **und** gleicher Handynummer oder E-Mail, wird er verknüpft statt doppelt angelegt (nur der Name reicht nicht). Ältere offene Leads holt *Setup → Lexware → Offene Leads ohne Kunde* nach.
- **Kundendaten im Kundenfenster:** E-Mail, Straße, PLZ und Ort lassen sich im Telefonat eintragen. Sie gehen beim Verlassen des Feldes direkt nach Lexware. Leere Felder ändern dort nichts.
- **Angebot** (Knopf in der festen Leiste unten, auch mitten im Telefonat): oben steht, was im Angebot ist, darunter alle Artikel aus Lexware mit Suche, dazu eigene Positionen. **Rabatt:** *Referenz 20 %* ist bei Leads mit Interesse Referenzauto schon an, sonst ein eigener Prozentsatz. Das Angebot steht dann als Gesamtrabatt drin, bei Referenz mit einem Satz in der Einleitung.
- *Angebot erstellen* legt es **fertig** in Lexware an (mit Nummer, 30 Tage gültig, eure Standardtexte, Fahrzeug in der Einleitung). Artikelpreise kommen frisch aus Lexware, eigene Positionen sind Endpreise. Das PDF landet im Drive-Ordner des Kunden (per Link sichtbar). Lexware verlangt dafür eine Rechnungsadresse beim Kunden. Fehlt sie, trägt das Skript mindestens das Land Deutschland ein, Straße und Ort kommen über die Kundendaten.
- **Verschicken:** Unter *Letztes Angebot* öffnet *WhatsApp* den Chat mit fertigem Text und PDF-Link, *Mail* schickt das Angebot nach einer Rückfrage direkt aus dem Gmail-Konto, unter dem das Google-Skript läuft (jd.brueder@gmail.com), mit dem PDF im Anhang (dafür muss die E-Mail eingetragen sein; Gmail erlaubt rund 100 Empfänger am Tag). Im Verlauf landet jeweils ein Vermerk. Das letzte Angebot merkt sich das Skript in `ANGEBOT_<Lead-id>`.
- **Nachfassen:** Ist beim Verschicken noch kein Rückruf geplant (und der Lead nicht terminiert, beauftragt oder unqualifiziert), trägt das Skript den Termin in 3 Tagen ein. An dem Tag steht der Lead unter *Fällig* mit „Angebot … nachfassen“, und die 8-Uhr-Nachricht nennt ihn.
- **Artikel im Angebot:** Unter *Setup → Lexware → Artikel im Angebot* legt ihr fest, welche Lexware-Artikel in der App erscheinen (z. B. ohne Bauleistungen). Gilt fürs ganze Team (`ARTIKEL_AUS`), neue Artikel sind erst mal sichtbar.
- Pakete und Preise pflegt ihr in Lexware unter *Artikel*. *Setup → Lexware → Prüfen* zeigt, ob der Schlüssel funktioniert.

## WhatsApp von der JD-Brüder-Nummer

Alle WhatsApp-Knöpfe öffnen `whatsapp://` statt `wa.me`. Auf Davids iPhone (privates WhatsApp und WhatsApp Business mit der JD-Brüder-Nummer) geht nur so WhatsApp Business auf, `wa.me` nimmt dort das private WhatsApp (getestet mit `wa-test.html`). Welche App iOS für `whatsapp://` nimmt, legt das iPhone selbst fest; ändert sich das nach einem Update, die Testseite nochmal durchtippen.

## Design

Unter *Setup → Design* wählt jeder für sein Handy Dunkel oder Hell und ob das Gold im Hintergrund zu sehen ist.

## Neue Kampagne, neue Tabelle

**Beim neuen Meta-Sofortformular** bei den Kontaktinformationen neben Name und Telefonnummer auch **E-Mail** anhaken (ist aus dem Facebook-Profil vorausgefüllt). Die App übernimmt die E-Mail dann automatisch in die Kundendaten und nach Lexware. Laufende Formulare lässt Meta nicht ändern, deshalb erst beim nächsten Formular.

Link zur neuen Lead-Tabelle in „JD Vertrieb“ in die nächste freie Zeile in Spalte A setzen. Beim nächsten Aktualisieren sind die Leads in der App. In der App führt *Setup → Tabelle verbinden* direkt dorthin. Alte Tabellen dürfen drinbleiben, dann tauchen offene Rückrufe weiter auf. Wer sie nicht mehr braucht, löscht die Zeile.

Kann eine Tabelle nicht gelesen werden (falscher Link, kein Zugriff), zeigt die App das unter *Setup* an, die anderen Tabellen laufen weiter.

## Was die App in die Lead-Tabellen schreibt

Erwartet wird der Aufbau der Meta-Leadlisten mit dem Sortier-Skript: Kopfzeile mit `id`, `created_time`, `full_name`, `phone_number`, `lead_status`, `Notiz` und `Termin`. Alle anderen Spalten wie `interesse` oder `fahrzeug` zeigt die App als Angaben aus dem Formular.

- **lead_status:** Werte wie im Dropdown (Offen, Zurückrufen, Terminiert, Nicht erreicht, Unqualifiziert, Auftrag). Leer oder „Neu“ (weiße Zeile, zum Zurücksetzen nach einem Fehltipp) heißt in der App „Neu“.
- **Notiz:** Neue Notizen werden mit Datum, Uhrzeit und Namen angehängt, nie überschrieben. Die KI-Zusammenfassung landet als eigener Eintrag „KI:“ in derselben Zelle.
- **Termin:** Datum für Termin oder Rückruf.
- **id:** Von Hand eingetragene Leads ohne id bekommen eine („manuell-…“), damit die App sie speichern kann.

Neue Leads, die Meta über die Kopfzeile schiebt, zeigt die App sofort. Die Zeilenfarbe passt das Sortier-Skript beim nächsten Lauf an (alle 10 Minuten), weil Änderungen per Skript kein onEdit auslösen. Feedback über die Lampe landet in „JD Vertrieb“ im Reiter **Feedback**.

## Wenn das Skript geändert wird

Nach jeder Änderung an `vertrieb.gs` bei Google: *Bereitstellen → Bereitstellungen verwalten → Stift → Version: Neue Version → Bereitstellen*. Die URL bleibt gleich.

## Entwickeln

- Test fürs Skript (ohne Google): `node test.js`
- Nach Änderungen an CSS oder JS die Zahl `?v=` in `index.html` hochzählen, sonst sehen die Handys die alte Version.
