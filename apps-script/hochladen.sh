#!/bin/zsh
# Lädt das Google-Skript ins Projekt der Tabelle „Leads Nov 2026“ und stellt die Web-App neu bereit.
# Code = vertrieb.gs, Sortieren = sortieren.gs, dazu appsscript.json. Die Bereitstellung bleibt dieselbe,
# der Link in config.js ändert sich also nicht. Braucht clasp (npm i -g @google/clasp), angemeldet als jd.brueder@gmail.com.
# Aufruf: apps-script/hochladen.sh "Beschreibung"   (ohne Beschreibung: der letzte Commit)
set -e
cd "$(dirname "$0")"
SKRIPT=1gVwZje_Utn17CKMw4muQd29wmrd9fBPE2A_2GhxEemmVBUt0da8oF32i   # Projekteinstellungen → Skript-ID
WEBAPP=AKfycbzYjAuA_iCfbLlwKT7o_UzdLNEe3P0EfnMejcjpMYat8qnJyQuO0sl8tEvW-ijtd6Fr   # die Bereitstellung aus config.js
TEXT="${1:-$(git log -1 --format='%h %s' | cut -c1-90)}"
T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT
cp vertrieb.gs "$T/Code.js"; cp sortieren.gs "$T/Sortieren.js"; cp appsscript.json "$T/"
printf '{"scriptId":"%s","rootDir":"."}' "$SKRIPT" > "$T/.clasp.json"
cd "$T"
clasp push --force
V=$(clasp create-version "$TEXT" | grep -o '[0-9][0-9]*' | tail -1)
clasp update-deployment "$WEBAPP" -V "$V" -d "$TEXT"
echo "Bereitgestellt: Version $V"
