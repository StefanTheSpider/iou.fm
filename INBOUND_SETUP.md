# Belege per E-Mail – Einrichtung (Inbound via Cloudflare, kostenlos & skalierend)

Empfang über **Cloudflare Email Routing** (gratis, unbegrenzt) auf einer **separaten Domain**,
damit `fork-and-merge.com` und die `@fork-and-merge.com`-Postfächer **komplett unberührt** bleiben.
Versand läuft weiter über **Resend** von `@fork-and-merge.com` (schon verifiziert).

## Architektur
Mail an `belege-<token>@DEINE-BELEG-DOMAIN` → Cloudflare Email Routing → **Email Worker**
(schickt die rohe Mail an den Hub) → Hub `/api/inbound-email` extrahiert PDF-Anhänge,
speichert revisionssicher + leitet (optional) an Steuerberater/DATEV weiter (über Resend).

## Was nur DU machst (Accounts/DNS), der Rest ist Code
### 1. Separate Beleg-Domain registrieren
Günstige Domain holen, z. B. `ioufm-belege.de` (~1 €/Monat). Bei Cloudflare Registrar oder
beliebigem Registrar; Nameserver auf **Cloudflare** zeigen lassen (Domain bei Cloudflare „adden").

### 2. Cloudflare Email Routing aktivieren
Cloudflare → die Beleg-Domain → **Email → Email Routing** → aktivieren (legt die nötigen MX
automatisch an). Diese Domain hat keine bestehende Mail → kein Risiko.

### 3. Worker anlegen (Dashboard, kein CLI)
Cloudflare → **Workers & Pages → Create → Worker** → den Inhalt von
`server/cloudflare-email-worker.js` einfügen → **Deploy**.
Dann **Settings → Variables**:
```
HUB_URL        = https://ioufm-production.up.railway.app
INBOUND_SECRET = <dasselbe Geheimnis wie im Hub>
```

### 4. Routing-Regel verbinden
Email Routing → **Routing rules** → **Catch-all** → Action **Send to a Worker** → den Worker wählen.

### 5. Railway-Variablen (Hub)
```
INBOUND_SECRET = <gleiches Geheimnis wie im Worker>
INBOUND_DOMAIN = DEINE-BELEG-DOMAIN          (z. B. ioufm-belege.de)
SEND_DOMAIN    = fork-and-merge.com          (Versand bleibt hier, Resend ist verifiziert)
RESEND_FROM    = iou.fm <belege@fork-and-merge.com>
```

## Sicherheit: pro Mandant eigene Absenderadresse
iou.fm sendet pro Mandant von `belege-<token>@fork-and-merge.com`. Jeder Kunde gibt in DATEV nur
seine eigene Adresse als freigegebenen Absender frei → kein Cross-Tenant-Versand möglich.

## Kosten
- Cloudflare Email Routing + Worker: **kostenlos**, unbegrenzt (Worker-Free-Tier 100.000/Tag).
- Resend: für ausgehende Weiterleitungen (im vorhandenen Plan).
- Einzige laufende Kosten: die ~1 €/Monat für die Beleg-Domain.

## Testen
1. App → Stammdaten → „Belege per E-Mail" → angezeigte Adresse `belege-…@DEINE-BELEG-DOMAIN` kopieren.
2. Mail mit PDF-Anhang dorthin schicken → in der App „Archiv anzeigen" → Beleg erscheint.

## Hinweise
- Per Mail empfangene Belege liegen serverseitig (Hub), nicht im E2E-Tresor – bei „Mail an Adresse"
  unvermeidbar. Ablage revisionssicher (Original, Zeitstempel, SHA-256, write-once).
- Verfahrensdokumentation: `Verfahrensdokumentation_Belege_Vorlage.md`.
- Alternative (kostenpflichtig, einfacher): Postmark Inbound – der Hub akzeptiert auch dessen JSON-Format.
