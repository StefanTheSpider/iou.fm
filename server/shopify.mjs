// Server-seitige Shopify-Abfrage für den Nacht-Cron.
// Liefert pro Mandant: Stornierungen, Rückerstattungen (getrennt, je mit echtem
// Datum/Betrag) und offene Rückbuchungen/Zahlungsreklamationen (Shopify-Disputes,
// kein Tag) – kategorisiert nach Titel (Land) + Tags (Sport/Konzerte; Typ reisen
// -> "Reisen"; Typ tickets -> Sport DE/Konzerte DE/Österreich).

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
    disputes: (node.disputes || []).map((d) => ({ id: d.id, initiatedAs: d.initiatedAs, status: d.status })),
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
      refunds.push({ ...base, date: r.createdAt, amountCents: r.amountCents, paidCents: order.totalCents, refundId: r.id,
        gateway: (order.gateways[0] || "").toLowerCase() });
    }
  }
  return { cancellations, refunds };
}

// Zahlungsreklamationen / Rückbuchungen (Disputes) aus Shopify.
// INQUIRY = Anfrage der Bank, CHARGEBACK = echte Rückbuchung. „offen" = Antwort nötig / in Prüfung.
const DISPUTE_OPEN = ["NEEDS_RESPONSE", "UNDER_REVIEW"];
const DISPUTE_TERMINAL = ["WON", "LOST", "ACCEPTED", "CHARGE_REFUNDED"];
const DISPUTE_PHASE = {
  NEEDS_RESPONSE: "Antwort nötig", UNDER_REVIEW: "in Prüfung",
  ACCEPTED: "akzeptiert", CHARGE_REFUNDED: "erstattet", WON: "gewonnen", LOST: "verloren",
};
// Hat die Bestellung einen bereits abgeschlossenen Dispute? Dann gilt sie als entschieden –
// eine parallel noch auf "in Prüfung" stehende Anfrage ist nur ein Lebenszyklus-Rest.
const hasResolvedDispute = (order) => (order.disputes || []).some((d) => DISPUTE_TERMINAL.includes(d.status));

export function extractDisputes(order, tagCfg = {}) {
  const resolved = hasResolvedDispute(order);
  return (order.disputes || []).map((d) => ({
    orderNumber: order.orderNumber, customer: order.customer, event: order.event,
    category: categorize(order, tagCfg), amountCents: order.totalCents, currency: order.currency,
    gateway: (order.gateways[0] || "").toLowerCase(),
    art: d.initiatedAs === "CHARGEBACK" ? "Rückbuchung" : "Anfrage",
    phase: DISPUTE_PHASE[d.status] || d.status,
    // Offen nur, wenn der Dispute offen ist UND die Bestellung nicht schon entschieden wurde.
    status: DISPUTE_OPEN.includes(d.status) && !resolved ? "offen" : "erledigt",
    disputeId: d.id,
  }));
}

// Verarbeitet eine Liste roher Order-Nodes -> Feed-Teile (rein, testbar).
export function collectFromOrders(nodes, { tagCfg = {}, since = null } = {}) {
  const cancellations = [], refunds = [], requests = [];
  for (const node of nodes) {
    const o = normalizeOrder(node);
    const ev = extractEvents(o, tagCfg, since);
    cancellations.push(...ev.cancellations);
    refunds.push(...ev.refunds);
    requests.push(...extractDisputes(o, tagCfg)); // offene Rückbuchungen/Disputes
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
      disputes { id initiatedAs status }
    } }
  }
}`;

async function fetchOrdersByQuery(domain, token, q) {
  const host = String(domain).replace(/^https?:\/\//, "").replace(/\/$/, "");
  const url = `https://${host}/admin/api/${API_VERSION}/graphql.json`;
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

// Bestellungen seit `sinceIso` (für neue Stornierungen + Rückerstattungen).
export function fetchOrdersSince(domain, token, sinceIso) {
  return fetchOrdersByQuery(domain, token, `updated_at:>=${sinceIso}`);
}

// Bestellungen gezielt per Nummer/Name holen – z. B. um den ursprünglich gezahlten
// Gesamtbetrag für App/SEPA-Erstattungen nachzutragen, deren Shopify-`updated_at`
// außerhalb des normalen Sync-Fensters liegt.
export async function fetchOrdersByNames(domain, token, names = []) {
  const clean = [...new Set((names || []).map((n) => String(n).replace(/^#/, "").trim()).filter(Boolean))];
  const out = [];
  const CHUNK = 25;
  for (let i = 0; i < clean.length; i += CHUNK) {
    const q = clean.slice(i, i + CHUNK).map((n) => `name:${n}`).join(" OR ");
    out.push(...await fetchOrdersByQuery(domain, token, q));
  }
  return out;
}

// Alle Bestellungen mit OFFENER Rückbuchung (Dispute) – unabhängig vom Datum,
// damit auch alte Bestellungen mit neuer Reklamation erscheinen.
export function fetchOpenDisputeOrders(domain, token) {
  return fetchOrdersByQuery(domain, token, "chargeback_status:needs_response OR chargeback_status:under_review");
}

// Alle Bestellungen mit ABGESCHLOSSENER Rückbuchung (für die Gewinn-/Verlust-Quote).
export function fetchResolvedDisputeOrders(domain, token) {
  return fetchOrdersByQuery(domain, token,
    "chargeback_status:won OR chargeback_status:lost OR chargeback_status:accepted OR chargeback_status:charge_refunded");
}

// Zählt Dispute-Ausgänge über eine Liste von Order-Nodes (rein, testbar).
// winRate = gewonnen / (gewonnen + verloren) in % (1 Dezimal), null wenn nichts entschieden.
// Zusätzlich aufgeschlüsselt nach Art: inquiry (Anfrage) vs. chargeback (echte Rückbuchung).
function newBucket() {
  return { won: 0, lost: 0, accepted: 0, chargeRefunded: 0, openNeedsResponse: 0, openUnderReview: 0 };
}
function countInto(b, status, countOpen = true) {
  if (status === "WON") b.won++;
  else if (status === "LOST") b.lost++;
  else if (status === "ACCEPTED") b.accepted++;
  else if (status === "CHARGE_REFUNDED") b.chargeRefunded++;
  else if (status === "NEEDS_RESPONSE") { if (countOpen) b.openNeedsResponse++; }
  else if (status === "UNDER_REVIEW") { if (countOpen) b.openUnderReview++; }
}
function finalize(b) {
  b.decided = b.won + b.lost;
  b.open = b.openNeedsResponse + b.openUnderReview;
  b.winRate = b.decided ? Math.round((b.won / b.decided) * 1000) / 10 : null;
  return b;
}
function newGroup() {
  return { total: newBucket(), inquiry: newBucket(), chargeback: newBucket() };
}
function addToGroup(g, d, countOpen = true) {
  countInto(g.total, d.status, countOpen);
  countInto(d.initiatedAs === "CHARGEBACK" ? g.chargeback : g.inquiry, d.status, countOpen);
}
function finalizeGroup(g) { finalize(g.total); finalize(g.inquiry); finalize(g.chargeback); return g; }

export function tallyDisputeOutcomes(nodes) {
  const overall = newGroup();
  const years = {};
  const seen = new Set();
  for (const node of nodes) {
    if (node.name && seen.has(node.name)) continue;
    if (node.name) seen.add(node.name);
    const yr = node.createdAt ? new Date(node.createdAt).getFullYear() : null;
    // Offene Disputes nur zählen, wenn die Bestellung nicht schon entschieden ist.
    const countOpen = !hasResolvedDispute(node);
    for (const d of node.disputes || []) {
      addToGroup(overall, d, countOpen);
      if (yr) { (years[yr] || (years[yr] = newGroup())); addToGroup(years[yr], d, countOpen); }
    }
  }
  finalizeGroup(overall);
  const byYear = Object.keys(years).sort().map((y) => {
    const g = finalizeGroup(years[y]);
    return { year: Number(y), ...g.total, inquiry: g.inquiry, chargeback: g.chargeback };
  });
  // Rückwärtskompatibel: Gesamtzahlen auf Top-Level + Aufschlüsselungen.
  return { ...overall.total, inquiry: overall.inquiry, chargeback: overall.chargeback, byYear };
}
