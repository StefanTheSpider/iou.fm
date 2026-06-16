# iou.fm – Projektregeln (verbindlich)

## REGEL 1 — Bedienungsanleitung IMMER mitpflegen
**Sobald ein Feature oder eine Funktion neu dazukommt oder sich ändert, wird die Bedienungsanleitung im selben Arbeitsschritt aktualisiert.** Kein Feature gilt als fertig, solange die Anleitung nicht angepasst ist.

Betroffene Dateien (beide synchron halten):
- `docs/anleitung.html` (öffentliche Anleitung, von der Landingpage verlinkt)
- `Bedienungsanleitung.md` (Markdown-Quelle, gleicher Inhalt)

Stil der Anleitung:
- **Aufgabenorientiert und für Einsteiger** geschrieben („Ich möchte … → so geht's"), kein Fachjargon, konkrete Schritte.
- **Keine Owner-/Vendor-/Support-Funktionen** aufführen — die sind für Endkunden irrelevant und gehören NICHT in die Anleitung.
- Nur die Endkunden-Rollen **Mitarbeiter** und **Admin** beschreiben.

## REGEL 2 — Versionsnummern
Versionsnummern nie raten. Höchsten Git-Tag lesen und per `release.sh` automatisch bumpen
(`git tag --list 'v*' | sort -V | tail -1`). Release ausschließlich über `./release.sh "<was ist neu>"`.

## REGEL 3 — Keine Commits ohne Aufforderung
Dateien ändern ist ok; Git (commit/push/Release) macht der User bzw. `release.sh`.

## REGEL 4 — Tauri-Fenster blockiert window.open & target="_blank"
Im gebauten App-Fenster funktioniert **weder `window.open` noch ein blanker
`<a target="_blank">`** — beides scheitert still (kein Popup, kein Tab). Das ist
mehrfach passiert (Belege-Download, INI-Brief, Footer-Link). Deshalb immer:
- **Externe URL öffnen** → `openExternal(url)` aus `src/lib/openExternal.js`
  (Rust-`invoke("open_external")`, `window.open` nur als Browser-Dev-Fallback).
  Links: `onClick={e => { e.preventDefault(); openExternal(url); }}`, nie nur `target="_blank"`.
- **Datei ausgeben/drucken** → Blob + temporärer `<a download>`-Klick (landet in
  „Downloads"), danach `toast(...)`. Muster: `src/lib/feed.js` (openBelegFile),
  `src/lib/datevExport.js`, `src/lib/ebics/iniLetter.js`.
- **Vor jedem Release greppen:** `window.open` / `target="_blank"` dürfen nur in
  `openExternal.js` vorkommen.

## Owner vs. Tix & Travel (Sonderstatus)
- **Owner-Account** = das per Railway-Variable `OWNER_ID` freigeschaltete Anbieter-Konto. Nur dieses
  hat Vendor-Rechte (Support-Login in Kundenkonten, Modus-Vorschau). NICHT an das „Gründer"-Flag koppeln.
- **Tix & Travel** = wichtigster Kunde, zahlt nie (über `EXEMPT_TENANTS` befreit), aber **ohne** Vendor-Rechte.
- Diese Trennung ist absolut: Owner-Funktionen erscheinen nur im Owner-Account, nie bei T&T.

## Tarife (Stand jetzt, netto/B2B)
Basis 49,99 € · Pro 99,99 € · Bank 169,99 € (EBICS nur im Bank-Tarif) · +3 Mitarbeiter 19,99 €.
Inklusiv-Mitarbeiter gestaffelt: Basis 2 · Pro 3 · Bank 5; weitere als +3er-Pakete. 7 Tage Test. Stripe SEPA-Lastschrift. Durchsetzung über `BILLING_ENFORCE=1`.

## Architektur-Kurz
- Tauri-App (`src/`), Sync-Hub auf Railway (`server/`, node:http, keine externen Deps), E2E-verschlüsselt.
- Löhne bleiben strikt lokal (nie zum Hub). EBICS-Schlüssel bleiben lokal (`ebicsKeys`, nicht in SHARED_KEYS).
- Shop-Adapter in `src/lib/ecommerce/`, EBICS in `src/lib/ebics/`, Billing in `src/lib/billing.js` + `server/billing.mjs`/`server/stripe.mjs`.
