# Belege per E-Mail – Einrichtung (Inbound)

Damit Kunden Belege an `belege-<token>@<deine-domain>` weiterleiten können. Du richtest das
**einmal** als Anbieter ein; die Kunden tragen danach in der App nur noch ihre Weiterleitungen ein.

## Überblick
Mail → **Cloudflare Email Routing** → **Email Worker** (parst Anhänge) → POST an Hub
`/api/inbound-email` → Hub speichert revisionssicher + leitet (optional) an Steuerberater/DATEV weiter.

## 1. Domain bei Cloudflare
- Eine Domain (oder Subdomain, z. B. `belege.deine-domain.de`) in Cloudflare aufnehmen.
- **Email → Email Routing** aktivieren (Cloudflare legt die nötigen MX-Einträge automatisch an).

## 2. Worker anlegen
```bash
npm create cloudflare@latest ioufm-inbound     # leeres Worker-Projekt
cd ioufm-inbound
npm i postal-mime
# server/cloudflare-email-worker.js als src/index.js übernehmen
npx wrangler deploy
```
Variablen/Secrets für den Worker:
```bash
npx wrangler secret put INBOUND_SECRET     # langes, zufälliges Geheimnis (du wählst es)
# HUB_URL als Variable in wrangler.toml:  HUB_URL = "https://ioufm-production.up.railway.app"
```

## 3. Email-Route verbinden
Cloudflare → Email Routing → **Routing rules**: Catch-all (oder Muster `belege-*@deine-domain`)
→ **Send to a Worker** → den eben deployten Worker wählen.

## 4. Hub-Variablen (Railway)
```
INBOUND_SECRET = <genau dasselbe Geheimnis wie im Worker>
INBOUND_DOMAIN = belege.deine-domain.de      (die Domain hinter @ in der Adresse)
RESEND_API_KEY = <schon gesetzt fürs Mailing>   (für die Auto-Weiterleitung)
```

## 5. Testen
- In der App (Stammdaten → „Belege per E-Mail") die angezeigte Adresse kopieren.
- Eine Mail mit PDF-Anhang dorthin schicken/weiterleiten.
- Nach wenigen Sekunden erscheint der Beleg im Archiv; bei aktivierter Weiterleitung kommt er beim Steuerberater/DATEV an.

## Sicherheits-/Datenschutz-Hinweis
Per Mail empfangene Belege liegen **serverseitig** (Hub) – anders als der sonst Ende-zu-Ende
verschlüsselte Tresor. Das ist bei „Mail an eine Adresse" technisch unvermeidbar. Ablage ist
revisionssicher (Original unverändert, Zeitstempel, SHA-256, write-once). Für die steuerliche
Anerkennung gehört eine **Verfahrensdokumentation** dazu – Vorlage:
`Verfahrensdokumentation_Belege_Vorlage.md`.
