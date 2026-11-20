# JD Vertrieb

Handy-App für die Meta-Leads von JD Brüder. Neue Leads sehen, mit einem Tipp anrufen, Notizen festhalten, Claude fasst das Gespräch zusammen und schlägt den nächsten Schritt vor.

- **App:** reines HTML, CSS und JS ohne Build (Design aus Dayliner, Farben JD Schwarz und Gold). Läuft auf GitHub Pages.
- **Daten:** bleiben im Google Sheet „JD Brüder Leads“. Das Skript `apps-script/vertrieb.gs` liefert sie an die App und schreibt Status, Notizen und KI-Zusammenfassung zurück.
- **Geheimnisse:** Team-Passwort und Claude-Schlüssel liegen nur in den Skripteigenschaften bei Google, nie im Code.

Ohne eingetragene Schnittstelle (`config.js` leer) läuft die App im Demo-Modus mit Beispiel-Leads.

## Einrichten (einmalig, ca. 10 Minuten)

1. **Skript einfügen:** Sheet „JD Brüder Leads“ öffnen → *Erweiterungen → Apps Script*. Links neben *Dateien* auf **+** → *Skript*, Name `vertrieb`. Den kompletten Inhalt von [`apps-script/vertrieb.gs`](apps-script/vertrieb.gs) hineinkopieren und speichern. Die bestehende Datei mit `holeLeads` bleibt, wie sie ist.
2. **Passwort und Schlüssel hinterlegen:** Links Zahnrad *Projekteinstellungen* → ganz unten *Skripteigenschaften* → *Skripteigenschaft hinzufügen*:
   - `TEAM_PASSWORT` = ein Passwort, das ihr euch ausdenkt (damit meldet ihr euch in der App an)
   - `ANTHROPIC_API_KEY` = euer Claude-Schlüssel (beginnt mit `sk-ant-api`, zu finden unter console.anthropic.com → API Keys)
3. **Als Web-App bereitstellen:** Oben rechts *Bereitstellen → Neue Bereitstellung*. Beim Zahnrad *Typ auswählen* → **Web-App**. *Ausführen als:* **Ich**, *Zugriff:* **Jeder**. Auf *Bereitstellen*, Zugriff erlauben. Die **Web-App-URL** kopieren (endet auf `/exec`).
4. **URL eintragen:** Die URL in `config.js` bei `window.JD_API` eintragen und hochladen (oder einfach an Claude schicken). Die URL ist kein Geheimnis, ohne Passwort liefert sie nichts.
5. **App öffnen:** Link der App auf dem Handy öffnen, Name und Team-Passwort eingeben, dann *Setup → Auf den Startbildschirm*.

**Test:** Die Web-App-URL im Browser öffnen. Steht dort „JD Vertrieb Schnittstelle läuft.“, ist alles bereit.

## Wenn das Skript geändert wird

Nach jeder Änderung an `vertrieb.gs` bei Google: *Bereitstellen → Bereitstellungen verwalten → Stift → Version: Neue Version → Bereitstellen*. Die URL bleibt gleich.

## Was die App ins Sheet schreibt

Beim ersten Laden legt sie diese Spalten an, falls sie fehlen: **Notizen**, **KI-Zusammenfassung**, **Nächster Kontakt**, **Zuletzt bearbeitet**. Notizen werden immer mit Datum, Uhrzeit und Namen angehängt, nie überschrieben. Status-Werte: Neu, Nicht erreicht, Rückruf, Termin, Kunde, Kein Interesse. Feedback über die Lampe landet im Reiter **Feedback**.

## Entwickeln

- Test fürs Skript (ohne Google): `node test.js`
- Nach Änderungen an CSS oder JS die Zahl `?v=` in `index.html` hochzählen, sonst sehen die Handys die alte Version.
