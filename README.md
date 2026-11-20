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
4. **Als Web-App bereitstellen:** Oben rechts *Bereitstellen → Neue Bereitstellung*. Beim Zahnrad *Typ auswählen* → **Web-App**. *Ausführen als:* **Ich**, *Zugriff:* **Jeder**. Auf *Bereitstellen*, Zugriff erlauben (Google fragt nach Tabellen und externen Verbindungen). Die **Web-App-URL** kopieren (endet auf `/exec`).
5. **URL eintragen:** Die URL in `config.js` bei `window.JD_API` eintragen und hochladen (oder einfach an Claude schicken). Die URL ist kein Geheimnis, ohne Passwort liefert sie nichts.
6. **App öffnen:** Link der App auf dem Handy öffnen, Name und Team-Passwort eingeben, dann *Setup → Auf den Startbildschirm*.

**Test:** Die Web-App-URL im Browser öffnen. Steht dort „JD Vertrieb Schnittstelle läuft.“, ist alles bereit.

## Neue Kampagne, neue Tabelle

Link zur neuen Lead-Tabelle in „JD Vertrieb“ in die nächste freie Zeile in Spalte A setzen. Beim nächsten Aktualisieren sind die Leads in der App. In der App führt *Setup → Tabelle verbinden* direkt dorthin. Alte Tabellen dürfen drinbleiben, dann tauchen offene Rückrufe weiter auf. Wer sie nicht mehr braucht, löscht die Zeile.

Kann eine Tabelle nicht gelesen werden (falscher Link, kein Zugriff), zeigt die App das unter *Setup* an, die anderen Tabellen laufen weiter.

## Was die App in die Lead-Tabellen schreibt

Erwartet wird der Aufbau der Meta-Leadlisten mit dem Sortier-Skript: Kopfzeile mit `id`, `created_time`, `full_name`, `phone_number`, `lead_status`, `Notiz` und `Termin`. Alle anderen Spalten wie `interesse` oder `fahrzeug` zeigt die App als Angaben aus dem Formular.

- **lead_status:** Werte wie im Dropdown (Offen, Zurückrufen, Terminiert, Nicht erreicht, Unqualifiziert, Auftrag). Leer heißt in der App „Neu“.
- **Notiz:** Neue Notizen werden mit Datum, Uhrzeit und Namen angehängt, nie überschrieben. Die KI-Zusammenfassung landet als eigener Eintrag „KI:“ in derselben Zelle.
- **Termin:** Datum für Termin oder Rückruf.
- **id:** Von Hand eingetragene Leads ohne id bekommen eine („manuell-…“), damit die App sie speichern kann.

Neue Leads, die Meta über die Kopfzeile schiebt, zeigt die App sofort. Die Zeilenfarbe passt das Sortier-Skript beim nächsten Lauf an (alle 10 Minuten), weil Änderungen per Skript kein onEdit auslösen. Feedback über die Lampe landet in „JD Vertrieb“ im Reiter **Feedback**.

## Wenn das Skript geändert wird

Nach jeder Änderung an `vertrieb.gs` bei Google: *Bereitstellen → Bereitstellungen verwalten → Stift → Version: Neue Version → Bereitstellen*. Die URL bleibt gleich.

## Entwickeln

- Test fürs Skript (ohne Google): `node test.js`
- Nach Änderungen an CSS oder JS die Zahl `?v=` in `index.html` hochzählen, sonst sehen die Handys die alte Version.
