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
INBOUND_DOMAIN = iou-tech.com                (Empfangs-Domain, Cloudflare Email Routing)
SEND_DOMAIN    = iou-tech.com                (Versand AUCH von hier – siehe DATEV-Hinweis)
RESEND_FROM    = iou.fm <belege@iou-tech.com>
```

## Wichtig: Senden UND Empfangen auf derselben Domain (iou-tech.com)
Damit die **DATEV-Absenderbestätigung** funktioniert, muss die iou.fm-Absenderadresse auch
**empfangen** können. Deshalb läuft Versand UND Empfang über **iou-tech.com**:
- **Empfang:** Cloudflare Email Routing (Catch-all → Worker → Hub) – schon eingerichtet.
- **Versand:** `iou-tech.com` zusätzlich in **Resend** als Sende-Domain verifizieren
  (DNS-Einträge bei Cloudflare hinterlegen: SPF/DKIM von Resend; stört die Empfangs-MX nicht,
  da Resend einen `send`-Subdomain nutzt).

Ablauf der DATEV-Freigabe (automatisch abgefangen):
1. Kunde trägt in DATEV Unternehmen online unter *Belege → Einstellungen → Upload Mail* die
   iou.fm-Absenderadresse `belege-<senderToken>@iou-tech.com` als freigegebenen Absender ein.
2. DATEV schickt eine Bestätigungsmail an diese Adresse → Cloudflare → Worker → Hub.
3. Der Hub erkennt die Mail an die Absender-Adresse, extrahiert den Bestätigungslink und zeigt
   ihn in der App (Stammdaten → „Belege & Buchhaltung" → Button „DATEV-Absender jetzt bestätigen").

## Sicherheit: pro Mandant eigene Absenderadresse
iou.fm sendet pro Mandant von `belege-<senderToken>@iou-tech.com`. Jeder Kunde gibt in DATEV nur
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
