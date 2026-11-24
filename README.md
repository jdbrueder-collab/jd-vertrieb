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
6. **App öffnen:** Link der App auf dem Handy öffnen, Name und Team-Passwort eingeben, dann *Setup → App → Auf den Startbildschirm*.

**Test:** Die Web-App-URL im Browser öffnen. Steht dort „JD Vertrieb Schnittstelle läuft.“, ist alles bereit.

Danach im Apps Script oben die Funktion **vertriebEinrichten** wählen und **Ausführen**. Sie fragt die Berechtigungen ab (Drive für die Fotos) und legt die Zeitauslöser für die Benachrichtigungen an.

## Benachrichtigungen

- Jede Minute schaut das Skript, ob sich eine Lead-Tabelle geändert hat, und meldet neue Leads aufs Handy. Ein Tipp auf die Nachricht öffnet den Lead.
- Morgens gegen 8 Uhr kommt eine Nachricht mit allen Leads, bei denen heute ein Rückruf oder Termin fällig ist.
- Einschalten pro Handy: App auf den Startbildschirm, dann *Setup → App → Benachrichtigungen*. Auf dem iPhone geht das nur in der installierten App (ab iOS 16.4).
- Versendet wird über einen kleinen, kostenlosen Dienst bei Cloudflare (`push/worker.js`, wie bei Dayliner). Er merkt sich nichts, das Skript schickt die Geräte mit. Neu hochladen: im Ordner `push` `npx wrangler deploy`. Geheimnisse dort: `VAPID_PRIVATE` (aus `push/.vapid-private`) und `GEHEIMNIS` (aus `push/.geheimnis`, dasselbe wie `PUSH_GEHEIMNIS` im Skript). Beide Dateien liegen nur lokal.

## Fotos

Beim Lead unter *Fotos* lassen sich Bilder in voller Auflösung hochladen, eins nach dem anderen. Sie landen in Google Drive im Ordner **JD Vertrieb Fotos**, pro Kunde ein Unterordner mit Name und Auto. Der Unterordner ist für jeden mit dem Link sichtbar, damit *An Kunden* den Link direkt per WhatsApp verschicken kann. Der kostenlose Google-Speicher (15 GB) reicht für grob 100 Autos mit je 30 Fotos.

## WhatsApp bei „Nicht erreicht“

Wer beim Lead den Status auf *Nicht erreicht* setzt, bekommt die Frage „Per WhatsApp schreiben?“. Ein Tipp öffnet WhatsApp mit fertigem Text, im Verlauf landet ein Vermerk. Den Text stellt man unter *Setup → WhatsApp: Nicht erreicht* ein. Platzhalter: `{Name}` (Vorname des Kunden) und `{Wunsch}` (Interesse) müssen drinbleiben, `{Ich}` ist der Name dessen, der schreibt.

**Texte an Kunden:** Unter *Setup → Nachrichten an Kunden* hat jeder Text sein eigenes Fenster mit Live-Vorschau, so wie er in WhatsApp oder im Postfach ankommt: *WhatsApp: Nicht erreicht* (`WA_VORLAGE`), *WhatsApp: Angebot* (Text zum PDF, `TEXT_ANGEBOT_WA`) und *Mail: Angebot* (Betreff und Text, `TEXT_MAIL_BETREFF`, `TEXT_MAIL`). Bausteine: `{Name}`, `{Wunsch}`, `{Nr}` (Angebotsnummer), `{Ich}`. Die Texte gelten fürs ganze Team und liegen als Skripteigenschaften im Google-Skript. Fehlt eine, gilt der Standardtext der App.

## Lexware

Ist `LEXWARE_API_KEY` hinterlegt (Skripteigenschaft im Google-Skript), passiert Folgendes:

- **Jede neue Anfrage wird sofort Kunde in Lexware**, mit Name, Handynummer, Interesse und Fahrzeug als Notiz, dazu E-Mail und Adresse, falls das Meta-Formular sie abfragt (Felder `email`, `street_address`, `post_code`/`zip_code`, `city`). Das Skript merkt sich die Kontakt-id (`LEX_<Lead-id>`). Gibt es in Lexware schon einen Kunden mit gleichem Nachnamen **und** gleicher Handynummer oder E-Mail, wird er verknüpft statt doppelt angelegt (nur der Name reicht nicht). Ältere offene Leads holt *Setup → Lexware → Offene Leads ohne Kunde* nach.
- **Kundendaten im Kundenfenster:** E-Mail, Straße, PLZ und Ort lassen sich im Telefonat eintragen. Sie gehen beim Verlassen des Feldes direkt nach Lexware, spätestens beim Schließen des Fensters, beim Tippen auf *Angebot* oder wenn das Fenster neu gezeichnet wird. Gibt es den Kunden noch nicht, wird er angelegt; gibt es ihn schon (gleicher Nachname und Nummer oder E-Mail), wird er verknüpft und die Daten landen dort. Leere Felder ändern nichts. Klappt das Speichern nicht, sagt die App es und versucht es beim nächsten Mal erneut.
- **Angebot** (Knopf in der festen Leiste unten, auch mitten im Telefonat): oben steht, was im Angebot ist, darunter alle Artikel aus Lexware mit Suche, dazu eigene Positionen. **Rabatt:** *Referenz 20 %* ist bei Leads mit Interesse Referenzauto schon an, sonst ein eigener Prozentsatz. Das Angebot steht dann als Gesamtrabatt drin, bei Referenz mit einem Satz in der Einleitung.
- *Angebot erstellen* legt es **fertig** in Lexware an (mit Nummer, 30 Tage gültig, eure Standardtexte, Fahrzeug in der Einleitung). Artikelpreise kommen frisch aus Lexware, eigene Positionen sind Endpreise. Das PDF landet im Drive-Ordner des Kunden (per Link sichtbar). Lexware verlangt dafür eine Rechnungsadresse beim Kunden. Fehlt sie, trägt das Skript mindestens das Land Deutschland ein, Straße und Ort kommen über die Kundendaten.
- **Verschicken:** Unter *Letztes Angebot* gibt *WhatsApp* die PDF-Datei selbst (kein Link) über das Teilen-Menü des iPhones weiter: dort WhatsApp Business und den Kunden wählen. Die App lädt das PDF dafür beim Öffnen des Kunden vor, weil iOS Teilen nur direkt beim Tippen erlaubt. Taucht der Kunde im Teilen-Menü nicht auf, erst über den WhatsApp-Knopf unten den Chat öffnen. *Mail* schickt das Angebot nach einer Rückfrage direkt aus dem Gmail-Konto, unter dem das Google-Skript läuft (jd.brueder@gmail.com), mit dem PDF im Anhang (dafür muss die E-Mail eingetragen sein; Gmail erlaubt rund 100 Empfänger am Tag). Im Verlauf landet jeweils ein Vermerk. Das letzte Angebot merkt sich das Skript in `ANGEBOT_<Lead-id>`.
- **Lexware gilt:** Beim Öffnen des Kunden holt die App jedes Mal frisch aus Lexware, was dort geändert wurde: Name und Telefon (zeigt danach auch die Liste; die Lead-Tabelle von Meta bleibt unverändert), Mail und Adresse, und das neueste Angebot des Kunden, auch eins, das direkt in Lexware angelegt oder kopiert wurde, mit Status *angenommen* oder *abgelehnt*. Hat das Angebot eine neue Version, stehen neue Summe und „geändert“ auf der Karte, WhatsApp und Mail verschicken die neue Fassung, die PDF-Kopie im Drive wird ersetzt (die alte kommt in den Papierkorb). Felder, in denen gerade jemand tippt, bleiben stehen. Name und Telefon aus Lexware merkt sich das Skript in `KONTAKT_<Lead-id>`.
- **Nachfassen:** Ist beim Verschicken noch kein Rückruf geplant (und der Lead nicht terminiert, beauftragt oder unqualifiziert), trägt das Skript den Termin in 3 Tagen ein. An dem Tag steht der Lead unter *Fällig* mit „Angebot … nachfassen“, und die 8-Uhr-Nachricht nennt ihn.
- **Artikel im Angebot:** Unter *Setup → Lexware → Artikel im Angebot* legt ihr fest, welche Lexware-Artikel in der App erscheinen (z. B. ohne Bauleistungen). Gilt fürs ganze Team (`ARTIKEL_AUS`), neue Artikel sind erst mal sichtbar.
- Pakete und Preise pflegt ihr in Lexware unter *Artikel*. *Setup → Lexware → Verbindung* zeigt, ob der Schlüssel funktioniert.

## Statistik

Eigener Tab in der Menüleiste (Kreis-Symbol). Oben der Zeitraum: *7 Tage*, *Monat* (seit dem 1.), *Vormonat*, *Alles* (seit dem ersten Lead). Darunter:
- **Kennzahlen:** Ausgaben bei Meta, Leads (davon Meta und Website), Kosten pro Lead (Ausgaben geteilt durch die Meta-Leads aus den Tabellen), ROAS, Angebotswert, Eingenommen.
- **Woher die Leads kommen:** Kreisdiagramm Instagram, Facebook, Website.
- **Was aus den Leads wurde:** Tabelle je Status, getrennt nach Meta und Website.
- **Vom Lead zum Auftrag:** Leads, Erreicht (nicht mehr Neu und nicht „Nicht erreicht“), Termin (Terminiert und Auftrag), Auftrag, jeweils mit Anteil.
- **Leads pro Tag** (bis 31 Tage, sonst pro Woche), nach Quelle gestapelt.
- **ROAS** (Return on Ad Spend = Umsatz brutto geteilt durch Meta-Ausgaben im Zeitraum) dreimal: aus offenen und angenommenen Angeboten, aus geschriebenen Rechnungen und aus bezahlten Rechnungen. Gezählt werden nur Lexware-Kunden, die über einen Meta-Lead kamen (in der App verknüpft, `LEX_<Lead-id>`). Die Kachel oben zeigt den ROAS aus Rechnungen.
- **Nur Fahrzeug:** Lexware enthält auch Bauleistungen (Meta Trennwandanlagen, Schäfer, Überdachung, Fliesen, Trockenbau) und Werkstatt-Teile. In der App zählen nur Aufbereitung, Veredelung, Folie und Trockeneis. Das Skript entscheidet je Beleg an den Positionen (Stichworte `FAHRZEUG`, Bau-Stichworte `BAU` schließen immer aus) und merkt sich das in `FZ_BELEGE`. Belege an Meta Trennwandanlagen zählen nie, Belege an Kunden aus der App immer. Geprüft am 24.11.2026 an allen 77 Belegen 2026 außer Meta Trennwand: 48 zählen.
- **Rechnungen:** im Zeitraum geschrieben als Kreisdiagramm bezahlt, offen, überfällig; **Eingenommen pro Tag/Woche** und **Zuletzt bezahlt** mit Kunde und Betrag. Bezahlt-Datum ist der Tag, an dem Lexware die Zahlung zugeordnet hat (`updatedDate`); das genaue Buchungsdatum bräuchte eine Lexware-Anfrage je Rechnung.
- **Was Meta kostet:** Ausgaben, pro Lead, pro Termin, pro Auftrag, pro Klick, Impressionen.
- **Angebote in Lexware:** alle fertigen Angebote mit Angebotsdatum im Zeitraum (brutto, auch nicht über die App geschriebene) als Kreisdiagramm angenommen, offen, abgelehnt.

Leads, Status und ROAS rechnet die App selbst. Ausgaben, Angebote und Rechnungen holt das Skript (Aktion `statistik`, 5 Minuten zwischengespeichert, Aktualisieren holt neu). **Meta verbinden:** In der App unter *Setup → Meta-Werbung* den Meta-Zugriffsschlüssel einfügen (Recht `ads_read`, am besten ein Systemnutzer-Schlüssel, der läuft nicht ab). Das Skript prüft ihn bei Meta und speichert ihn als `META_TOKEN`. Über die Google-Oberfläche geht es nicht mehr, sobald das Skript mehr als 50 Skripteigenschaften hat (die App legt je Kunde welche an). Werbekonto ist JD Brüder (`act_1240466211369292`, fest im Skript), der Schlüssel sieht auch Davids privates Konto. Ein anderes Konto ginge über die Skripteigenschaft `META_KONTO`. Läuft der Schlüssel ab, sagt der Tab das.

## WhatsApp von der JD-Brüder-Nummer

Alle WhatsApp-Knöpfe öffnen `whatsapp://` statt `wa.me`. Auf Davids iPhone (privates WhatsApp und WhatsApp Business mit der JD-Brüder-Nummer) geht nur so WhatsApp Business auf, `wa.me` nimmt dort das private WhatsApp (getestet mit `wa-test.html`). Welche App iOS für `whatsapp://` nimmt, legt das iPhone selbst fest; ändert sich das nach einem Update, die Testseite nochmal durchtippen.

## Design

Unter *Setup → Design* wählt jeder für sein Handy Dunkel oder Hell und ob das Gold im Hintergrund zu sehen ist.

## Neue Kampagne, neue Tabelle

**Beim neuen Meta-Sofortformular** bei den Kontaktinformationen neben Name und Telefonnummer auch **E-Mail** anhaken (ist aus dem Facebook-Profil vorausgefüllt). Die App übernimmt die E-Mail dann automatisch in die Kundendaten und nach Lexware. Laufende Formulare lässt Meta nicht ändern, deshalb erst beim nächsten Formular.

Link zur neuen Lead-Tabelle in „JD Vertrieb“ in die nächste freie Zeile in Spalte A setzen. Beim nächsten Aktualisieren sind die Leads in der App. In der App führt *Setup → Lead-Tabellen → Tabelle verbinden* direkt dorthin. Alte Tabellen dürfen drinbleiben, dann tauchen offene Rückrufe weiter auf. Wer sie nicht mehr braucht, löscht die Zeile.

Kann eine Tabelle nicht gelesen werden (falscher Link, kein Zugriff), zeigt die App das unter *Setup → Lead-Tabellen* an, die anderen Tabellen laufen weiter.

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
