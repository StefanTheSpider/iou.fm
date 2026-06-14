# Stripe-Einrichtung – SEPA-Abos für iou.fm

Damit Kunden iou.fm per **SEPA-Lastschrift** abonnieren können. Du machst das einmalig;
ich fasse keine Keys an – die trägst du selbst in Railway ein.

## 1. SEPA-Lastschrift aktivieren
Stripe-Dashboard → **Einstellungen → Zahlungsmethoden** → **SEPA-Lastschrift** aktivieren.

## 2. Produkte & Preise anlegen
Stripe-Dashboard → **Produkte** → je Tarif ein Produkt mit **wiederkehrendem Preis (monatlich, EUR)**.
**Wichtig (B2B):** bei jedem Preis das **Steuerverhalten auf „Exklusiv" (Nettopreis)** stellen – die USt kommt dann obendrauf.

| Produkt | Netto-Preis / Monat | Abrechnung | ENV-Variable |
|---|---|---|---|
| iou.fm **Basis** | **39,99 €** | monatlich | `STRIPE_PRICE_BASIS` |
| iou.fm **Pro** | **79,99 €** | monatlich | `STRIPE_PRICE_PRO` |
| iou.fm **Bank** | **99,99 €** | monatlich | `STRIPE_PRICE_BANK` |
| iou.fm **+3 Mitarbeiter** | **19,99 €** | monatlich (Menge = Anzahl 3er-Pakete) | `STRIPE_PRICE_SEATS` |

Nach dem Speichern jeweils die **Preis-ID** kopieren (beginnt mit `price_…`).
Inklusiv-Mitarbeiter je Tarif: **Basis 2 · Pro 3 · Bank 5**; das „+3 Mitarbeiter"-Paket (19,99 € netto) kann mehrfach dazugebucht werden.

## 3. Steuersatz (Tax Rate) anlegen – NICHT Stripe Tax
Stripe-Dashboard → **Produkte → Steuersätze (Tax rates) → Steuersatz hinzufügen**:
- **Satz:** `19 %` (deutscher Regelsteuersatz für Software-Abos)
- **Verhalten:** **Exklusiv** (netto + USt obendrauf)
- **Region/Land:** Deutschland
- Anzeigename z. B. „USt 19 % (DE)"

Danach die **Tax-Rate-ID** kopieren (beginnt mit `txr_…`) → Variable `STRIPE_TAX_RATE_ID`.

> **Stripe Tax NICHT aktivieren** – das kostet 0,5 % pro Transaktion. Die App hängt diese
> manuelle Tax Rate automatisch an jede Subscription (Checkout + Sitzplatz-Pakete).

## 4. Kundenportal aktivieren
Stripe-Dashboard → **Einstellungen → Billing → Kundenportal** aktivieren
(erlaubt Kündigung, Zahlungsmittel ändern; optional Mengen-Änderung für Sitzplätze).

## 5. Webhook anlegen
Stripe-Dashboard → **Entwickler → Webhooks → Endpunkt hinzufügen**
- URL: `https://ioufm-production.up.railway.app/api/stripe/webhook`
- Events: `checkout.session.completed`, `customer.subscription.created`,
  `customer.subscription.updated`, `customer.subscription.deleted`,
  `invoice.paid`, `invoice.payment_failed`
- Danach das **Signing secret** kopieren (beginnt mit `whsec_…`).

## 6. Railway-Variablen setzen (Hub-Service)
```
STRIPE_SECRET_KEY     = sk_live_…        (oder sk_test_… zum Testen)
STRIPE_WEBHOOK_SECRET = whsec_…
STRIPE_TAX_RATE_ID    = txr_…            (die 19%-Tax-Rate aus Schritt 3)
STRIPE_PRICE_BASIS    = price_…
STRIPE_PRICE_PRO      = price_…
STRIPE_PRICE_BANK     = price_…
STRIPE_PRICE_SEATS    = price_…          (das „+3 Mitarbeiter"-Paket)
PUBLIC_URL            = https://ioufm-production.up.railway.app
BILLING_ENFORCE       = 0                (siehe unten)
OWNER_ID              = iou-owner-…      (deine private Owner-ID, siehe unten)
```

Hinweis: `STRIPE_SECRET_KEY` kannst du aus deinem anderen Projekt übernehmen, **wenn es dasselbe
Stripe-Konto ist**. `STRIPE_WEBHOOK_SECRET` ist **neu** (gehört zum hier angelegten Webhook-Endpunkt).
Fehlt `STRIPE_TAX_RATE_ID`, läuft der Checkout zwar, aber **ohne USt-Zeile** – dann ist die Rechnung falsch.

## 7. Sanfter Start (wichtig)
- **`BILLING_ENFORCE=0`** → die App zeigt nur Test-/Abo-Hinweise, sperrt aber **nicht**.
  So testest du in Ruhe, ohne dich auszusperren.
- Wenn alles läuft: **`BILLING_ENFORCE=1`** → nach Ablauf der 7-Tage-Testphase ist ohne
  aktives Abo Schluss; Mitarbeiter-Limit (5 je Lizenz) wird durchgesetzt.
- **Sonderstatus (zahlt nie) per Owner-ID:** Setze `OWNER_ID` in Railway auf deine private
  Owner-ID. Danach in der App (eingeloggt als Admin) unter **Stammdaten → Abo & Lizenz →
  „Owner-Status freischalten"** die ID einmal eingeben. Das Konto ist dann dauerhaft von
  Abo-Pflicht und Mitarbeiter-Limit befreit – egal ob `BILLING_ENFORCE` an ist. Die ID wird
  sicher (timing-safe) gegen die Railway-Variable geprüft und nirgends im Klartext gespeichert.
  Zusätzlich optional: `EXEMPT_TENANTS` (Tenant-IDs, kommagetrennt).
- **EBICS** ist an den Tarif **Bank** gekoppelt: nur zahlende Bank-Kunden (oder Konten mit
  Sonderstatus) können die Bankanbindung aktivieren und „Per EBICS senden" nutzen.

## 8. Deployen
```bash
cd ~/Desktop/Projekte/sepa_2.0/server && railway up
cd ~/Desktop/Projekte/sepa_2.0 && ./release.sh "Verkauf: Stripe SEPA-Abo, Lizenzen, Sitzplätze"
```

## Test (Stripe-Testmodus)
Mit `sk_test_…` + Test-Webhook und der **Test-IBAN** `DE89370400440532013000` einen
Checkout durchspielen – danach erscheint der Mandant als „active", die Paywall verschwindet.
Prüfe die erste Rechnung im Stripe-Dashboard: **netto + 19 % USt** und **Firmenname** als
Rechnungsempfänger (nicht der SEPA-Kontoinhaber).

---

### Was die App damit kann
- 3 Tarife (Basis/Pro/Bank), **7 Tage kostenlos testen**.
- Inklusiv-Mitarbeiter **gestaffelt** (Basis 2 · Pro 3 · Bank 5); weitere als **3er-Pakete** dazubuchbar (Stammdaten → Abo & Lizenz).
- Bezahlung per **SEPA-Lastschrift** über Stripe (gehostete Bezahlseite, du fasst keine IBANs an).
- Kunden verwalten/kündigen selbst über das **Stripe-Kundenportal**.
- Nach Testablauf ohne Abo: **Paywall** (erst bei `BILLING_ENFORCE=1`).
