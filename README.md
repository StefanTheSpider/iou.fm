# iou.fm — IBAN · Order · Überweisung

Lokale, passwortgeschützte SEPA-Zahlungs-App: erzeugt aus einer **DATEV-Abstimmliste (PDF)**
automatisch eine **SEPA-Lohndatei (pain.001.001.09)** und wickelt Erstattungen/Sammel­überweisungen
ab. Alle Daten bleiben Ende-zu-Ende verschlüsselt auf dem Gerät.

Entwickelt von [fork and merge UG](https://www.fork-and-merge.com/).

## Schnellstart – SEPA testen

```bash
npm install
npm run dev          # neutrale Edition   (oder: npm run dev:tix für die Tix-Edition)
```

Adresse aus dem Terminal öffnen (i. d. R. http://localhost:5173).

1. **Admin anlegen** (Benutzername + Passwort) → **Einrichtung**: ein Auftraggeberkonto (Name + IBAN) + Modul wählen → „Einrichtung abschließen".
2. **SEPA testen – drei Wege (alle ohne Shopify/Proxy):**
   - **Löhne:** DATEV-Abstimmliste-PDF in den Tab „Löhne" ziehen → Zusammenfassung prüfen → **SEPA-Lohndatei herunterladen**.
   - **Sammelüberweisung** (Modul-Profil „Sammelüberweisung"): „+ Empfänger", Name/IBAN/Betrag/Zweck → **SEPA-Datei erstellen**.
   - **Erstattungen:** „+ Leere Zeile", Daten eintragen → **SEPA-Datei erstellen**.
3. Die erzeugte `*.xml` lässt sich im **Online-Banking als SEPA-Sammelüberweisung importieren**. Jede Datei landet zusätzlich im **Archiv** (mit DATEV-/CSV-Export).

Hinweis: Der Shopify-Bestellimport ist optional und braucht im Browser den Dev-Proxy (`npm run proxy`); fürs SEPA-Testen wird er **nicht** benötigt.

Auslieferbare Version: `npm run build` (Ergebnis in `dist/`); Tix-Edition: `npm run build:tix`. Später wird genau dieser Code in eine **Tauri-Desktop-App** verpackt.

## Was schon funktioniert

- **Tresor mit Master-Passwort** — Auftraggeberkonten & Mitarbeiter werden AES-256-GCM
  verschlüsselt lokal gespeichert (PBKDF2-Schlüsselableitung). Ohne Passwort unlesbar.
- **Mehrere Auftraggeberkonten** anlegen; beim Erstellen der Datei auswählbar.
- **Mitarbeiter-Stammdaten** mit GF-Markierung.
- **IBAN-Prüfung + BIC-Ableitung** (wie iban-rechner.de): Format wird automatisch bereinigt,
  Prüfziffer kontrolliert, BIC für DE/AT offline ermittelt. Ampel 🟢 gültig / 🔴 ungültig.
- **Lohn-Workflow:** DATEV-PDF hochladen → Empfänger/IBAN/Beträge/Datum/Auftraggeberbank
  automatisch auslesen → Abgleich mit Mitarbeitern → **Zusammenfassung mit Checkboxen**,
  „Alle auswählen", **GF-Gehälter zurückhalten**, ungültige IBANs werden markiert und aus dem
  Lauf genommen → **SEPA-XML herunterladen** (Kategorie `SALA`).

## Erstattungs-Modul (neu)

- **Shopify-Import:** Bestellnummer eingeben → Kundenname, gezahlter Betrag und Event
  (für den Verwendungszweck) werden aus der Bestellung übernommen. Die **IBAN** liefert Shopify
  nicht – die gibt der Kunde separat an und wird mit Live-Prüfung + BIC-Ableitung eingetragen.
- **Erstattungsart je Zeile (Dropdown):**
  - **Voll (100 %)** – kompletter Betrag.
  - **Mit Stornogebühr %** – erstattet = gezahlt − Gebühr (z. B. 30 % → 70 % zurück). Standard einstellbar.
  - **Fester Betrag** – exakter EUR-Betrag.
- Erstattungs- und einbehaltener Betrag werden live berechnet; **Bestellnummer** wandert als
  Verwendungszweck/EndToEndId in die SEPA-Datei (saubere Zuordnung beim Zahlungseingang).
- Checkboxen + „Alle auswählen", Summe, ungültige IBAN & Fremdwährung werden ausgeschlossen.

**Shopify einrichten:** unter *Stammdaten → Shopify-Anbindung* die `…myshopify.com`-Domain und
einen **Admin-API-Token** (Custom App in Shopify) hinterlegen – verschlüsselt im Tresor.
Hinweis: Im Browser-Dev blockiert Shopify den direkten Aufruf (CORS); in der späteren
**Tauri-Desktop-App** läuft er ohne CORS. Bis dahin lassen sich Zeilen auch manuell anlegen.

## White-Label / Theming / Editionen

**Eine Codebasis, mehrere Editionen** (massentauglich + individualisierbar):

- **Build-Preset** in `src/branding.js`: `DEFAULT` = generisch/neutral, `PRESETS.tixtravel` = Tix-Edition. Auswahl per Build-Variable:
  - `npm run dev` / `npm run build` → generische White-Label-Edition
  - `npm run dev:tix` / `npm run build:tix` → Tix & Travel-Edition (`VITE_BRAND=tixtravel`)
- **Laufzeit-Konfig** (Tresor, pro Installation): Konten, Shopify-Token, Module/Profil, DATEV-Konten, Benutzer, Branding-Overrides.
- **Regel:** nichts Kundenspezifisches in der Logik hartcodieren – nur Preset/Config/Flag mit generischem Default.

- Standardwerte in `src/branding.js` (pro Kunde an­passbar): Produktname, Wortmarke, Logo, Tagline, Theme.
- Zur Laufzeit überschreibbar unter **Stammdaten → Darstellung** (verschlüsselt im Tresor):
  - **Hell-/Dunkel-Modus**
  - **Primärfarbe** (Buttons, aktiver Tab), **Sekundärfarbe** (Links, Beträge), **Textfarbe** – jeweils als **HEX oder RGB**
  - Produktname, Wortmarke, optionales Logo
- Die Theme-Engine (`src/lib/theme.js`) setzt daraus die CSS-Variablen; Änderungen wirken sofort.
- Der Urheber-Hinweis **fork and merge UG** bleibt immer erhalten (`MAKER` in `branding.js`, nicht überschreibbar).

## Anmeldung & Cloud-Sync – Ende-zu-Ende

**Login von jedem Gerät mit Benutzername + Passwort.** Der **Sync-Hub** (`server/`, einzige
Cloud-Komponente, z. B. auf Railway, Adresse fest in `src/config.js` eingebaut) authentifiziert
und liefert den verschlüsselten Datenblock – **lesen kann der Server ihn nicht** (Modell wie
Bitwarden): aus dem Passwort wird ein `authHash` (geht zum Server, dort nur als Hash gespeichert)
und ein `vaultKey` (bleibt auf dem Gerät, entpackt den Datenschlüssel) abgeleitet.

- **Primärer Screen:** Anmelden. „Neue Firma einrichten" (Admin-Registrierung) ist sekundär.
- **Geteilt (synchronisiert):** Stammdaten, Erstattungen/Sammelüberweisung, Archiv, Branding/Config.
- **Strikt lokal (nie in die Cloud):** **Löhne** – `gfIbans` und Lohn-Batches (verschlüsselter Geräte-Cache).
- **Mitarbeiter:** Der Admin legt sie unter *Stammdaten → Benutzer & Zugänge* an (Benutzer + Passwort);
  sie melden sich danach von jedem Gerät selbst an. Kein Code, keine URL.
- **Automatischer Sync:** Pull beim Anmelden + Fensterwechsel + alle 60 s, Push beim Speichern.

**Endpunkte (Hub):** `register`, `prelogin`, `login`, `adduser`, `users/list`, `users/delete`,
`migrate` + `GET/PUT/DELETE /api/tenants/:id/doc` (verschlüsselter Transport). Siehe `server/README.md`.

**Migration eines Alt-Tresors:** Loggt sich ein bestehender Nutzer auf dem Gerät mit dem alten
lokalen Tresor (`sepa2_vault_v2`) erstmals im neuen System ein, wird sein Mandant automatisch per
`/api/auth/migrate` ins Login-System gehoben (gleiches Passwort).

## Verifikation

```bash
node test/verify.mjs         # 18 Prüfungen: DATEV-Lohn (Summe, IBANs, XML)
node test/pdftest.mjs        # echte DATEV-PDF (11 Empfänger, 22.951,76 €)
node test/verify_refund.mjs  # 13 Prüfungen: Erstattungs-Berechnung + Shopify-Parsing
node test/verify_sync.mjs    # 15 Prüfungen: Sync-Split (Löhne lokal) + Merge + Invite-Code
node server/test/hub.test.mjs  # 17 Prüfungen: Sync-Hub (Mandant, push/pull, Konflikt, Isolation)
```

## Projektstruktur

```
src/
  lib/
    sepa.js        SEPA-XML (pain.001.001.09), Betrag in Cent, SALA, Sanitisierung
    iban.js        IBAN reinigen + Mod-97-Prüfung + BIC-Ableitung
    blz.js         BLZ -> BIC (DE/AT Starter-Verzeichnis; volle Bundesbank-Datei folgt)
    money.js       Betrags-/Währungs-Parsing + EZB-Tageskurs-Umrechnung
    datev.js       PDF -> Textzeilen (pdf.js)
    datevParse.js  reine Parse-Logik der Abstimmliste (testbar, ohne PDF)
    vault.js       verschlüsselter Tresor (Web-Crypto)
  components/
    LockScreen.jsx Tresor anlegen / entsperren
    Stammdaten.jsx Auftraggeberkonten + Mitarbeiter
    Lohn.jsx       Lohn-Workflow
    Footer.jsx     Urheber-/Branding-Hinweis
```

## Nächste Phasen (siehe KONZEPT.md im Schwester-Ordner)

- DE/AT-BIC-Verzeichnis vollständig einspielen (Bundesbank-Datei).
- Tauri-Verpackung (Desktop, signiert, offline).
- Erstattungs-Modul (Cloud, Team) als eigene Phase.

> Hinweis: Der BLZ→BIC-Datensatz ist im Prototyp bewusst klein gehalten. Für EUR-SEPA ist die
> BIC ohnehin optional (die IBAN genügt) — fehlt eine BIC, wird trotzdem korrekt überwiesen.
