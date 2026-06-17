// Shopify-Anbindung (Admin GraphQL API).
//
// Holt zu einer Bestellnummer: Kundenname, gezahlten Betrag, Währung und das
// Event (aus dem Artikel) für den Verwendungszweck. Die IBAN liefert Shopify
// NICHT – die gibt der Kunde separat an und wird in der App eingegeben.
//
// Hinweis CORS/Laufzeit: Die Admin-API sendet keine CORS-Header. Im Browser
// (Dev) wird der direkte Aufruf daher blockiert; in der späteren Tauri-Desktop-
// App läuft der Request über die native HTTP-Schicht ohne CORS. Bis dahin
// funktioniert das Modul auch komplett manuell (Bestelldaten von Hand eintragen).

const API_VERSION = "2024-10";

// "Herbert Grönemeyer_Frankfurt_So. 13.06.2027_Open Airs 2027_(DE)"
//  -> "Herbert Grönemeyer Frankfurt"
export function deriveEventLabel(title) {
  if (!title) return "";
  const parts = String(title).split("_").map((s) => s.trim()).filter(Boolean);
  if (parts.length >= 2) return `${parts[0]} ${parts[1]}`;
  return parts[0] || "";
}

// Leitet die Zahlart aus den Shopify-Payment-Gateways ab (festgeschrieben, da Fakt).
export function methodFromGateways(gateways = []) {
  const g = (gateways || []).map((x) => String(x).toLowerCase()).join(" ");
  if (g.includes("paypal")) return "paypal";
  if (g.includes("klarna")) return "klarna";
  if (g.includes("gift")) return "gutschein";
  if (g.includes("shopify_payments") || g.includes("stripe") || g.includes("card") ||
      g.includes("credit") || g.includes("mollie") || g.includes("adyen") || g.includes("amazon")) return "kreditkarte";
  // bank / sepa / überweisung / manual / vorkasse -> SEPA
  return "ueberweisung";
}

// Parst einen GraphQL-Order-Node in das von der App genutzte Format.
export function parseOrderNode(node) {
  if (!node) return null;
  const orderName = node.name || "";
  const orderNumber = orderName.replace(/^#/, "");
  // Name: Kundenkonto (falls read_customers vorhanden), sonst Rechnungs-/
  // Lieferadresse (im Order enthalten, nur read_orders nötig).
  const customerName =
    node.customer?.displayName ||
    node.billingAddress?.name ||
    [node.billingAddress?.firstName, node.billingAddress?.lastName].filter(Boolean).join(" ") ||
    node.shippingAddress?.name ||
    "";
  const money = node.totalPriceSet?.shopMoney || {};
  const amount = parseFloat(money.amount || "0");
  const title = node.lineItems?.edges?.[0]?.node?.title || "";
  const eventShort = deriveEventLabel(title);
  // Bezahl-Status: nur wenn das Geld tatsächlich eingegangen ist, darf erstattet werden.
  // PAID/PARTIALLY_PAID/(PARTIALLY_)REFUNDED = Geld war da; PENDING/AUTHORIZED/VOIDED/EXPIRED = nie bezahlt.
  const fin = String(node.displayFinancialStatus || "").toUpperCase();
  const paid = fin ? ["PAID", "PARTIALLY_PAID", "PARTIALLY_REFUNDED", "REFUNDED"].includes(fin) : undefined;
  // Bereits im Shop erstatteter Betrag (auch Teil-/Kulanz-Erstattungen) – direkt aus der
  // Bestellung, damit auch Rückerstattungen erkannt werden, die noch nicht im iou-Feed stehen.
  const refundedAmt = parseFloat(node.totalRefundedSet?.shopMoney?.amount || "0");
  const refundedCents = Math.max(0, Math.round((Number.isFinite(refundedAmt) ? refundedAmt : 0) * 100));
  return {
    orderName,
    orderNumber,
    customerName,
    totalCents: Math.round(amount * 100),
    currency: money.currencyCode || "EUR",
    eventTitle: title,
    eventShort,
    method: methodFromGateways(node.paymentGatewayNames),
    financialStatus: fin,
    paid,                       // true | false | undefined (unbekannt)
    refundedCents,              // im Shop bereits erstatteter Betrag (0 = keiner)
    suggestedPurpose: `Erstattung ${orderNumber} ${eventShort}`.trim(),
  };
}

const ORDER_QUERY = `
query($q: String!) {
  orders(first: 1, query: $q) {
    edges {
      node {
        name
        paymentGatewayNames
        displayFinancialStatus
        customer { displayName }
        billingAddress { name firstName lastName }
        shippingAddress { name }
        totalPriceSet { shopMoney { amount currencyCode } }
        totalRefundedSet { shopMoney { amount currencyCode } }
        lineItems(first: 3) { edges { node { title quantity } } }
      }
    }
  }
}`;

// Im Dev-Modus (Browser) läuft der Aufruf über den lokalen Proxy (umgeht CORS,
// Token bleibt serverseitig). In der Tauri-Desktop-App / Produktion wird Shopify
// direkt mit Domain + Token aus dem Tresor aufgerufen.
const DEV = typeof import.meta !== "undefined" && import.meta.env && import.meta.env.DEV;
const DEV_PROXY = "http://localhost:8788";

// Läuft die App in Tauri (Desktop)? Dann gibt es ein natives HTTP-Plugin, dessen
// Requests NICHT der Browser-CORS-Regel unterliegen.
const isTauri = () => typeof window !== "undefined" && !!window.__TAURI_INTERNALS__;

// Wählt die passende fetch-Implementierung: explizit übergeben > Tauri-HTTP > Browser-fetch.
async function pickFetch(explicit) {
  if (explicit) return explicit;
  if (isTauri()) {
    try {
      const mod = await import("@tauri-apps/plugin-http");
      if (mod?.fetch) return mod.fetch;
    } catch { /* Plugin nicht verfügbar -> Browser-fetch */ }
  }
  return fetch;
}

export async function fetchShopifyOrder({ domain, token, orderNumber, fetchImpl }) {
  const num = String(orderNumber).replace(/^#/, "").trim();
  if (!num) throw new Error("Bitte Bestellnummer angeben.");
  if (!domain || !token) throw new Error("Shopify nicht verbunden (Domain + Token unter Stammdaten eintragen).");

  const doFetch = await pickFetch(fetchImpl);
  let res;
  // Im Browser-Dev ohne Tauri: über lokalen Proxy (umgeht CORS). In Tauri/Produktion direkt.
  if (DEV && !isTauri()) {
    // Browser-Entwicklung: über lokalen Relay-Proxy (umgeht CORS). Zugangsdaten
    // kommen aus dem Tresor und werden nur durchgereicht (Proxy speichert nichts).
    try {
      res = await doFetch(`${DEV_PROXY}/order`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderNumber: num, domain, token }),
      });
    } catch (e) {
      throw new Error("Dev-Proxy nicht erreichbar – läuft `npm run proxy`?");
    }
  } else {
    // Desktop (Tauri) / Produktion: direkter Aufruf, kein CORS.
    const url = `https://${domain.replace(/^https?:\/\//, "").replace(/\/$/, "")}/admin/api/${API_VERSION}/graphql.json`;
    try {
      res = await doFetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
        body: JSON.stringify({ query: ORDER_QUERY, variables: { q: `name:${num}` } }),
      });
    } catch (e) {
      throw new Error("Verbindung zu Shopify fehlgeschlagen.");
    }
  }

  if (!res.ok) throw new Error(`Shopify-Fehler ${res.status}`);
  const json = await res.json();
  const node = json?.data?.orders?.edges?.[0]?.node;
  if (!node) throw new Error(`Bestellung ${num} nicht gefunden.`);
  return parseOrderNode(node);
}
