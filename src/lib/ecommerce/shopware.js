// Shopware-6-Adapter (Admin API).
// Auth: OAuth Client Credentials (Integration in Shopware → Einstellungen → System →
// Integrationen anlegen; Client-ID + Secret, Leserechte für Bestellungen).
import { pickFetch } from "./http.js";
import { methodFromText, normalizeOrder } from "./normalize.js";

// Rohes Order-Entity (Accept: application/json -> flache Struktur) -> einheitlich.
export function parseShopwareOrder(o, fallbackNumber = "") {
  const cust = o.orderCustomer || {};
  const name = [cust.firstName, cust.lastName].filter(Boolean).join(" ") || cust.company || "";
  const total = o.amountTotal ?? o.price?.totalPrice ?? 0;
  const title = (o.lineItems && o.lineItems[0]?.label) || "";
  const currency = o.currency?.isoCode || "EUR";
  const pm = (o.transactions && o.transactions[0]?.paymentMethod?.name) || "";
  return normalizeOrder({
    orderNumber: o.orderNumber || fallbackNumber,
    customerName: name,
    totalCents: Math.round((Number(total) || 0) * 100),
    currency,
    eventTitle: title,
    method: methodFromText(pm),
  });
}

export async function fetchShopwareOrder({ siteUrl, clientId, clientSecret, orderNumber, fetchImpl }) {
  const num = String(orderNumber).replace(/^#/, "").trim();
  if (!num) throw new Error("Bitte Bestellnummer angeben.");
  if (!siteUrl || !clientId || !clientSecret) {
    throw new Error("Shopware nicht verbunden (Shop-URL + Client-ID/Secret unter Stammdaten eintragen).");
  }
  const base = String(siteUrl).replace(/\/+$/, "");
  const doFetch = await pickFetch(fetchImpl);

  // 1) Access-Token holen (client_credentials).
  const tr = await doFetch(`${base}/api/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ grant_type: "client_credentials", client_id: clientId, client_secret: clientSecret }),
  });
  if (!tr.ok) throw new Error(`Shopware-Anmeldung fehlgeschlagen (${tr.status}).`);
  const token = (await tr.json()).access_token;
  if (!token) throw new Error("Shopware: kein Token erhalten.");

  // 2) Bestellung per Ordernummer suchen (mit nötigen Verknüpfungen).
  const sr = await doFetch(`${base}/api/search/order`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      filter: [{ type: "equals", field: "orderNumber", value: num }],
      associations: { lineItems: {}, orderCustomer: {}, currency: {}, transactions: { associations: { paymentMethod: {} } } },
      limit: 1,
    }),
  });
  if (!sr.ok) throw new Error(`Shopware ${sr.status}`);
  const data = (await sr.json()).data;
  const o = Array.isArray(data) ? data[0] : null;
  if (!o) throw new Error("Bestellung nicht gefunden.");
  return parseShopwareOrder(o, num);
}
