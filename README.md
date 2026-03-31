# Hochschulsport Workflow Migration

Dieses Repository ersetzt den bisherigen n8n-Workflow fuer die Kalenderdarstellung auf GitHub Pages.

**[📅 Zur Kalender-Seite](https://greenoak24.github.io/hochschulsport-kalender/)**

## Was ist migriert?

- Datenfluss ist jetzt dateibasiert im Repo statt in n8n-Nodes.
- Das Skript scripts/scrape-rwth-and-build.mjs scraped die RWTH-Seiten direkt und erzeugt docs/data/events.json.
- Die Seite unter docs/ zeigt die Termine in einer Kalenderansicht.
- GitHub Actions baut und deployt die Seite automatisch.

## Datenquelle

Standard: Live-Scraping der RWTH Hochschulsportseiten (ohne Google Sheet).

Optionaler Fallback: CSV-Import mit bestehendem Skript.

## Umgebungsvariablen (optional)

- START_URL: Startseite fuer Kursliste (Default: https://buchung.hsz.rwth-aachen.de/angebote/aktueller_zeitraum/)
- OUTPUT_FILE: Zielpfad fuer events.json (Default: docs/data/events.json)
- MAX_COURSE_PAGES: Begrenzung der Kursseiten pro Lauf (Default: 450)
- FETCH_TIMEOUT_MS: Timeout je HTTP-Request (Default: 30000)

## CSV-Fallback

Wenn du stattdessen aus Sheet/CSV bauen willst:

1. CSV nach data/raw/kurse.csv legen
2. Fallback-Build starten

   npm run build:data:csv

## Lokale Nutzung

1. Events bauen:

   npm run build:data

2. Seite lokal starten:

   npm run serve

3. Im Browser oeffnen:

   http://localhost:8080

## GitHub Pages Setup

1. Repo nach GitHub pushen.
2. In Settings -> Pages Source auf GitHub Actions stellen.
3. Workflow Build and Deploy Kalender ausfuehren.

## Hinweise

- Einzeltermine werden als normale Termine gespeichert.
- Wiederkehrende Termine werden aus Wochentag + ReocurringEnd als Serientermine erzeugt.
- Die Kalenderseite verwendet nur statische Dateien in docs/.
- Der Build laeuft komplett ohne n8n und ohne Google Sheets.
