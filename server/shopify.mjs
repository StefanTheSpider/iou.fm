// Server-seitige Shopify-Abfrage für den Nacht-Cron.
// Liefert pro Mandant: Stornierungen, Rückerstattungen (getrennt, je mit echtem
// Datum/Betrag) und offene Rückerstattungs-Anfragen (per Tag) – kategorisiert
// nach Tags (Typ reisen -> "Reisen"; Typ tickets -> Sport DE/Konzerte DE/Österreich).

const API_VERSION = "2024-10";
const lc = (s) => String(s || "").toLowerCase().trim();

// "Künstler_Stadt_Datum_…(DE)" -> "Künstler Stadt"
export function deriveEventLabel(title) {
  if (!title) return "";
  const parts = String(title).split("_").map((s) => s.trim()).filter(Boolean);
  return parts.length >= 2 ? `${parts[0]} ${parts[1]}` : parts[0] || "";
}

const cents = (m) => Math.round(parseFloat((m && m.amount) || "0") * 100);

// GraphQL-Order-Node -> einheitliches Objekt.
export function normalizeOrder(node) {
  const li = node.lineItems?.edges?.[0]?.node || {};
  const money = node.totalPriceSet?.shopMoney || node.currentTotalPriceSet?.shopMoney || {};
  return {
    orderNumber: (node.name || "").replace(/^#/, ""),
    customer: node.customer?.displayName || node.billingAddress?.name || "",
    title: li.title || "",
    event: deriveEventLabel(li.title),
    productType: li.product?.productType || "",
    productTags: li.product?.tags || [],
    orderTags: node.tags || [],
    gateways: node.paymentGatewayNames || [],
    currency: money.currencyCode || "EUR",
    totalCents: cents(money),
    cancelledAt: node.cancelledAt || null,
    cancelReason: node.cancelReason || null,
    financialStatus: node.displayFinancialStatus || "",
    refunds: (node.refunds || []).map((r) => ({
      id: r.id, createdAt: r.createdAt,
      amountCents: cents(r.totalRefundedSet?.shopMoney),
      currency: r.totalRefundedSet?.shopMoney?.currencyCode || money.currencyCode || "EUR",
    })),
  };
}

// Land aus dem Produkt-Titel: bevorzugt Länder-Suffix „(AT)"/„(DE)",
// sonst österreichische Städte/Stichworte -> AT, sonst DE.
const AT_RE = /\((at|aut|öst)\)\s*$|österreich|\bwien\b|salzburg|\bgraz\b|innsbruck|\blinz\b|klagenfurt|bregenz|\bwels\b|villach|st\.?\s?pölten/i;
const DE_SUFFIX_RE = /\((de|ger)\)\s*$/i;
export function countryFromTitle(title = "") {
  const t = String(title).replace(/_/g, " "); // Unterstriche -> Wortgrenzen
  if (AT_RE.test(t)) return "AT";
  if (DE_SUFFIX_RE.test(t)) return "DE";
  return "DE"; // Default: Inland
}

// Kategorie: Land aus Titel (DE/AT), Sport vs. Konzerte aus Tags (sobald gepflegt).
// tagCfg = { reisen:[], sportDe:[], konzertDe:[], at:[] }
export function categorize(order, tagCfg = {}) {
  const tags = [...(order.orderTags || []), ...(order.productTags || [])].map(lc);
  const has = (list) => (list || []).some((t) => tags.includes(lc(t)));
  if (lc(order.productType).includes("reise") || has(tagCfg.reisen)) return "Reisen";
  // Österreich: aus Titel ODER explizitem AT-Tag.
  if (countryFromTitle(order.title) === "AT" || has(tagCfg.at)) return "Österreich";
  // Deutschland: Sport vs. Konzerte über Tags; ohne Tag noch „Unzugeordnet".
  if (has(tagCfg.sportDe)) return "Sport DE";
  if (has(tagCfg.konzertDe)) return "Konzerte DE";
  return "Unzugeordnet";
}

const after = (date, since) => !since || (date && date > since);

// Aus einem Order: neue Stornierungen + neue Rückerstattungen seit `since`.
export function extractEvents(order, tagCfg, since) {
  const base = { orderNumber: order.orderNumber, customer: order.customer, event: order.event,
    category: categorize(order, tagCfg), currency: order.currency };
  const cancellations = [];
  const refunds = [];
  if (order.cancelledAt && after(order.cancelledAt, since)) {
    cancellations.push({ ...base, date: order.cancelledAt, amountCents: order.totalCents, reason: order.cancelReason || "" });
  }
  for (const r of order.refunds || []) {
    if (after(r.createdAt, since) && r.amountCents > 0) {
      refunds.push({ ...base, date: r.createdAt, amountCents: r.amountCents, refundId: r.id,
        gateway: (order.gateways[0] || "").toLowerCase() });
    }
  }
  return { cancellations, refunds };
}

// Offene Rückerstattungs-Anfrage? (per Tag markiert, noch nicht erledigt)
export function classifyRequest(order, requestTags = []) {
  const tags = [...(order.orderTags || []), ...(order.productTags || [])].map(lc);
  const tagged = (requestTags || []).some((t) => tags.includes(lc(t)));
  if (!tagged) return null;
  const fs = lc(order.financialStatus);
  const status = order.cancelledAt ? "storniert"
    : fs.includes("refunded") ? "erstattet"
    : "offen";
  return {
    orderNumber: order.orderNumber, customer: order.customer, event: order.event,
    category: categorize(order, requestTags && {}), amountCents: order.totalCents,
    currency: order.currency, gateway: (order.gateways[0] || "").toLowerCase(), status,
  };
}

// Verarbeitet eine Liste roher Order-Nodes -> Feed-Teile (rein, testbar).
export function collectFromOrders(nodes, { tagCfg = {}, since = null } = {}) {
  const cancellations = [], refunds = [], requests = [];
  for (const node of nodes) {
    const o = normalizeOrder(node);
    const ev = extractEvents(o, tagCfg, since);
    cancellations.push(...ev.cancellations);
    refunds.push(...ev.refunds);
    const req = classifyRequest(o, tagCfg.refundRequest);
    if (req) { req.category = categorize(o, tagCfg); requests.push(req); }
  }
  return { cancellations, refunds, requests };
}

// --- Netzwerk: Orders seit `sinceIso` paginiert holen ----------------------
const ORDER_QUERY = `
query($q: String!, $cursor: String) {
  orders(first: 100, query: $q, after: $cursor, sortKey: UPDATED_AT) {
    pageInfo { hasNextPage endCursor }
    edges { node {
      name createdAt updatedAt cancelledAt cancelReason displayFinancialStatus
      tags paymentGatewayNames
      customer { displayName }
      billingAddress { name }
      totalPriceSet { shopMoney { amount currencyCode } }
      lineItems(first: 5) { edges { node { title quantity product { productType tags } } } }
      refunds { id createdAt totalRefundedSet { shopMoney { amount currencyCode } } }
    } }
  }
}`;

export async function fetchOrdersSince(domain, token, sinceIso) {
  const host = String(domain).replace(/^https?:\/\//, "").replace(/\/$/, "");
  const url = `https://${host}/admin/api/${API_VERSION}/graphql.json`;
  const q = `updated_at:>=${sinceIso}`;
  let cursor = null, all = [], guard = 0;
  do {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
      body: JSON.stringify({ query: ORDER_QUERY, variables: { q, cursor } }),
    });
    if (!res.ok) throw new Error(`Shopify ${res.status}`);
    const json = await res.json();
    const conn = json?.data?.orders;
    if (!conn) break;
    all.push(...conn.edges.map((e) => e.node));
    cursor = conn.pageInfo.hasNextPage ? conn.pageInfo.endCursor : null;
  } while (cursor && ++guard < 50);
  return all;
}
