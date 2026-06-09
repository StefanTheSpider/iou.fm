# iou.fm – Sync-Hub

Die **einzige Cloud-Komponente**. Speichert pro Mandant (Firma) eine **eigene DB-Datei**
und darin **nur Ende-zu-Ende-verschlüsselten Chiffretext**. Der Server hat keine
Schlüssel und kann die Inhalte nicht lesen. **Kein Benutzer-Login** – Zugriff
ausschließlich über den pro Mandant erzeugten `accessKey`.

Die eigentliche App läuft auf dem Gerät (Desktop/Browser); **Löhne werden nie
übertragen** und bleiben lokal.

## Endpunkte

| Methode | Pfad | Zweck |
|--------|------|-------|
| GET  | `/health` | Statuscheck (Railway-Healthcheck) |
| POST | `/api/tenants` | neue Mandanten-DB anlegen → `{ tenantId, accessKey }` |
| GET  | `/api/tenants/:id/doc` | verschlüsseltes Dokument lesen (Header `Authorization: Bearer <accessKey>`) |
| PUT  | `/api/tenants/:id/doc` | Dokument schreiben (`{ baseRev, payload, keyring, company }`) |

`payload` = E2E-Chiffretext der geteilten Daten, `keyring` = passwortgeschützte
Benutzer-Hüllen. Schreiben mit veralteter `baseRev` → **409** mit aktuellem Stand
(Client führt zusammen und sendet erneut).

## Lokal starten

```bash
cd server
node index.mjs          # Port 3000, Daten unter ./data
npm test                # 17 Prüfungen
```

## Auf Railway deployen

1. Neues Railway-Projekt → **Deploy from Repo** (oder `railway up` im `server/`-Ordner).
   Der `Dockerfile` benötigt keine externen Abhängigkeiten (nur Node-Standardlib).
2. **Volume** an `/data` mounten (Settings → Volumes). Ohne Volume gehen die
   Mandanten-DBs bei jedem Deploy verloren.
3. Healthcheck steht in `railway.toml` auf `/health`.
4. Optional ENV `CORS_ORIGIN` = exakte App-Herkunft (Default `*`; bei E2E unkritisch).
5. Die öffentliche Railway-URL in der App unter **Stammdaten → Cloud-Sync** eintragen
   und „Sync einrichten" klicken.

## Datenschutz / Sicherheit

- Der Server speichert **nur Chiffretext** + einen **SHA-256-Hash** des `accessKey`
  (nie den Schlüssel im Klartext).
- Jeder Mandant ist eine **physisch eigene Datei** (`data/tenants/<tenantId>.json`).
- Keine personenbezogenen Klartextdaten, keine IBANs, keine Lohndaten auf dem Server.
