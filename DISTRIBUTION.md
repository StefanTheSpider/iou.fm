# iou.fm ausliefern – vom Code zur verkaufsfertigen App

Der Kunde bekommt am Ende **eine Datei** (`.dmg` bzw. `.msi`/`.exe`), Doppelklick, fertig –
kein Node, kein Rust, kein Terminal. Dieses Dokument beschreibt den Weg dorthin.

---

## 0) Sofort testen – unsignierte .dmg (kein Account nötig)

```
cd ~/Desktop/Projekte/sepa_2.0
npm install
npm run tauri:build
```
Ergebnis:
```
src-tauri/target/release/bundle/macos/iou.fm.app
src-tauri/target/release/bundle/dmg/iou.fm_0.1.0_aarch64.dmg
```
Doppelklick auf die `.app` startet die echte App (kein Dev-Server, keine Ports). Da noch nicht
signiert: beim ersten Start **Rechtsklick → Öffnen** (einmalig die Gatekeeper-Warnung bestätigen).

So fühlt sich das Produkt für den Kunden an – die Schritte 1–3 entfernen nur noch die Warnung,
schalten Auto-Update frei und bauen Windows mit.

---

## 1) macOS signieren + notarisieren (keine Warnung mehr)

**Voraussetzung:** Apple Developer Program (99 $/Jahr).

1. Im Apple Developer Portal ein **„Developer ID Application"**-Zertifikat erstellen, in der
   Schlüsselbund-App als `.p12` exportieren (mit Passwort).
2. Werte ermitteln:
   - `APPLE_SIGNING_IDENTITY` – z. B. `Developer ID Application: fork and merge UG (TEAMID)`
   - `APPLE_TEAM_ID` – 10-stellige Team-ID
   - `APPLE_ID` – deine Apple-ID-E-Mail
   - `APPLE_PASSWORD` – **app-spezifisches Passwort** (appleid.apple.com → Anmeldung → App-Passwörter)
3. **Lokal** signiert bauen (Beispiel zsh):
   ```
   export APPLE_SIGNING_IDENTITY="Developer ID Application: … (TEAMID)"
   export APPLE_ID="dein@apple.id"
   export APPLE_PASSWORD="xxxx-xxxx-xxxx-xxxx"
   export APPLE_TEAM_ID="TEAMID"
   npm run tauri:build
   ```
   Tauri signiert und notarisiert die `.dmg` automatisch. (Im CI läuft das über Secrets, siehe 4.)

> Ohne diese Variablen baut `tauri:build` weiter – nur eben unsigniert. Der Default-Build bleibt also intakt.

---

## 2) Auto-Update aktivieren (Tauri-Updater)

Der Frontend-Check (`src/lib/update.js`) + Banner sind schon eingebaut und laufen still leer,
solange nichts konfiguriert ist. Das **Rust-Plugin ist bewusst deaktiviert** – ohne Konfig
würde die App sonst beim Start abstürzen. Zum Scharfschalten **alle vier Schritte**:

1. **Signaturschlüssel erzeugen** (einmalig):
   ```
   npx tauri signer generate -w ~/.tauri/iou-updater.key
   ```
   Gibt **privaten Schlüssel** (Datei + Passwort) und **public key** (Base64) aus.
2. In **`src-tauri/tauri.conf.json`** ergänzen – unter `"plugins"`:
   ```json
   "plugins": {
     "updater": {
       "endpoints": ["https://github.com/<OWNER>/<REPO>/releases/latest/download/latest.json"],
       "pubkey": "HIER_DEN_PUBLIC_KEY_EINFUEGEN"
     }
   }
   ```
   und in `"bundle"`: `"createUpdaterArtifacts": true`.
3. In **`src-tauri/src/lib.rs`** die auskommentierte Updater-Zeile aktivieren:
   ```rust
   #[cfg(desktop)]
   let builder = builder.plugin(tauri_plugin_updater::Builder::new().build());
   ```
   und in **`src-tauri/capabilities/default.json`** zu `permissions` `"updater:default"` hinzufügen.
4. Privaten Schlüssel als CI-Secret hinterlegen (siehe 4): `TAURI_SIGNING_PRIVATE_KEY`
   (Inhalt der Key-Datei) + `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.

> Erst wenn 1–3 zusammen erledigt sind, startet die App wieder – Plugin und Konfig müssen
> immer gemeinsam vorhanden sein. Danach erzeugt jeder Release ein signiertes Update +
> `latest.json`; installierte Apps aktualisieren sich (Banner → „Jetzt aktualisieren & neu starten").

---

## 3) Windows-Installer (.msi/.exe)

Wird **auf einem Windows-Rechner oder im CI** gebaut (macOS allein kann das nicht). Die
Release-Pipeline (Schritt 4) erledigt das automatisch auf einem Windows-Runner. Lokal auf
Windows: `npm install && npm run tauri:build` → `src-tauri/target/release/bundle/{msi,nsis}/`.
Optional ohne SmartScreen-Warnung: Windows-Code-Signing-Zertifikat (EV/OV) – separat.

---

## 4) Release-Pipeline (GitHub Actions) – baut alles auf einmal

Die Datei `.github/workflows/release.yml` baut bei jedem Versions-Tag macOS (universal,
signiert+notarisiert) **und** Windows, erzeugt die Updater-Artefakte und legt einen
**GitHub Release (Entwurf)** an.

**Secrets** im GitHub-Repo hinterlegen (Settings → Secrets and variables → Actions):

| Secret | Inhalt |
|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | Inhalt der `~/.tauri/iou-updater.key` |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Passwort dieses Schlüssels |
| `APPLE_CERTIFICATE` | Base64 der `.p12` (`base64 -i cert.p12 \| pbcopy`) |
| `APPLE_CERTIFICATE_PASSWORD` | Passwort der `.p12` |
| `APPLE_SIGNING_IDENTITY` | `Developer ID Application: … (TEAMID)` |
| `APPLE_ID` | Apple-ID-E-Mail |
| `APPLE_PASSWORD` | app-spezifisches Passwort |
| `APPLE_TEAM_ID` | Team-ID |

**Release auslösen:**
```
git tag v0.1.1
git push origin v0.1.1
```
→ Actions baut Mac + Windows, signiert/notarisiert, hängt `.dmg`, `.msi`/`.exe` und `latest.json`
an den Release. Entwurf prüfen → veröffentlichen. Fertig zum Verkaufen.

---

## Was der Kunde tut (das Ziel)

1. `.dmg` (Mac) bzw. `.exe` (Windows) herunterladen, installieren.
2. iou.fm öffnen → anmelden oder „Neue Firma einrichten".
3. Updates kommen automatisch.

Kein Terminal, kein Node, kein Rust, kein Hub-Setup – der Hub läuft zentral bei dir (Railway).
