// WooCommerce-Adapter (REST API v3).
// Auth: Consumer Key + Consumer Secret (Basic Auth). In WooCommerce unter
// WooCommerce → Einstellungen → Erweitert → REST-API anlegen (nur Lesen).
import { pickFetch, b64 } from "./http.js";
import { methodFromText, normalizeOrder } from "./normalize.js";

// Rohes Order-JSON von WooCommerce -> einheitliche Struktur.
export function parseWooOrder(o) {
  const name =
    [o.billing?.first_name, o.billing?.last_name].filter(Boolean).join(" ") ||
    o.billing?.company || "";
  const amount = parseFloat(o.total || "0");
  const title = o.line_items?.[0]?.name || "";
  return normalizeOrder({
    orderNumber: o.number || o.id,
    customerName: name,
    totalCents: Math.round(amount * 100),
    currency: o.currency || "EUR",
    eventTitle: title,
    method: methodFromText(o.payment_method, o.payment_method_title),
  });
}

export async function fetchWooOrder({ siteUrl, consumerKey, consumerSecret, orderNumber, fetchImpl }) {
  const num = String(orderNumber).replace(/^#/, "").trim();
  if (!num) throw new Error("Bitte Bestellnummer angeben.");
  if (!siteUrl || !consumerKey || !consumerSecret) {
    throw new Error("WooCommerce nicht verbunden (Shop-URL + Consumer Key/Secret unter Stammdaten eintragen).");
  }
  const base = String(siteUrl).replace(/\/+$/, "");
  const auth = "Basic " + b64(`${consumerKey}:${consumerSecret}`);
  const doFetch = await pickFetch(fetchImpl);

  // 1) Direkt per ID (WooCommerce-Bestellnummer = ID im Standard).
  let res = await doFetch(`${base}/wp-json/wc/v3/orders/${encodeURIComponent(num)}`, { headers: { Authorization: auth } });
  if (res.ok) return parseWooOrder(await res.json());

  // 2) Fallback: Suche (z. B. bei Plugins mit eigener Bestellnummer).
  const r2 = await doFetch(`${base}/wp-json/wc/v3/orders?search=${encodeURIComponent(num)}&per_page=1`, { headers: { Authorization: auth } });
  if (!r2.ok) throw new Error(`WooCommerce ${r2.status}`);
  const arr = await r2.json();
  const order = Array.isArray(arr) ? arr[0] : null;
  if (!order) throw new Error("Bestellung nicht gefunden.");
  return parseWooOrder(order);
}
