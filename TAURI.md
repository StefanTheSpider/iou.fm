# iou.fm als Desktop-App (Tauri v2)

Verpackt **genau das bestehende Frontend** in eine native, installierbare Mac-App
(`.app`/`.dmg`). Vorteile gegenüber dem Browser-Build:

- **Shopify funktioniert ohne CORS** – Requests laufen über die native HTTP-Schicht
  (`@tauri-apps/plugin-http`), kein Dev-Proxy mehr nötig.
- Echtes Fenster, App-Icon, Doppelklick-Start, später signierbar/notarisierbar.
- Cloud-Sync läuft unverändert (der Hub sendet CORS-Header).

Alles bleibt lokal & Ende-zu-Ende verschlüsselt; **Löhne weiterhin nur auf dem Gerät**.

---

## Einmalige Voraussetzungen (auf dem Mac)

1. **Xcode Command Line Tools** (für den C-Compiler/Linker):
   ```
   xcode-select --install
   ```
2. **Rust-Toolchain** (rustup):
   ```
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
   ```
   Danach neues Terminal öffnen (oder `source "$HOME/.cargo/env"`) und prüfen:
   ```
   rustc --version
   ```

## Projekt vorbereiten

```
cd ~/Desktop/Projekte/sepa_2.0
npm install                       # zieht @tauri-apps/cli, api, plugin-http
npx tauri icon src-tauri/icons/source.png   # erzeugt alle App-Icons (PNG/ICO/ICNS)
```

> `tauri icon` ist nötig, weil macOS u. a. `icon.icns` braucht. Du kannst das
> Quell-PNG `src-tauri/icons/source.png` jederzeit durch dein eigenes Logo
> (möglichst 1024×1024) ersetzen und den Befehl erneut ausführen.

## Entwickeln (Hot-Reload-Fenster)

```
npm run tauri:dev
```
Startet Vite (Port 5173) und öffnet das native iou.fm-Fenster. Beim ersten Mal
kompiliert Rust einige Minuten, danach geht's schnell. Hier kannst du **Shopify
live testen** – der Bestell-Import sollte jetzt ohne Proxy funktionieren.

> Port 5173 muss frei sein (nicht parallel `npm run dev` laufen lassen).

## Installierbare App bauen

```
npm run tauri:build
```
Ergebnis liegt unter:
```
src-tauri/target/release/bundle/macos/iou.fm.app
src-tauri/target/release/bundle/dmg/iou.fm_0.1.0_<arch>.dmg
```
Die `.dmg` ist die verteilbare Datei.

---

## Hinweise

- **Signierung/Notarisierung:** Für Verteilung außerhalb deines Macs ohne
  Gatekeeper-Warnung braucht es ein Apple-Developer-Zertifikat (kostenpflichtig).
  Fürs interne Testen reicht „Rechtsklick → Öffnen". Signierung können wir später
  in `tauri.conf.json` (`bundle.macOS`) ergänzen.
- **Was läuft worüber:** Shopify → natives HTTP-Plugin (CORS-frei, Scope auf
  `*.myshopify.com` in `src-tauri/capabilities/default.json`). Sync-Hub & EZB-Kurse
  → normale fetch-Requests (senden CORS-Header).
- **Windows/Linux:** Dieselbe Codebasis baut mit Tauri auch `.msi`/`.AppImage`,
  jeweils auf dem Zielsystem (oder via CI). Aktuell auf macOS ausgelegt.
