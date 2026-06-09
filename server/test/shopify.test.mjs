// Tests für die Shopify-Auswertung (rein, ohne Netz).
import { normalizeOrder, categorize, extractEvents, classifyRequest, collectFromOrders } from "../shopify.mjs";

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error("  ✗ " + m); } };

const TAGS = { reisen: ["reisen"], sportDe: ["sport"], konzertDe: ["konzert"], at: ["at", "österreich"], refundRequest: ["rückerstattung angefragt"] };

const node = (o) => ({
  name: o.name, cancelledAt: o.cancelledAt || null, cancelReason: o.cancelReason || null,
  displayFinancialStatus: o.fin || "PAID", tags: o.tags || [], paymentGatewayNames: o.gw || ["bank"],
  customer: { displayName: o.cust || "Kunde" },
  totalPriceSet: { shopMoney: { amount: o.total || "100.00", currencyCode: "EUR" } },
  lineItems: { edges: [{ node: { title: o.title || "Act_Stadt_2026", product: { productType: o.type || "Tickets", tags: o.ptags || [] } } }] },
  refunds: (o.refunds || []).map((r, i) => ({ id: "gid://r/" + i, createdAt: r.date, totalRefundedSet: { shopMoney: { amount: r.amt, currencyCode: "EUR" } } })),
});

// Kategorisierung
ok(categorize(normalizeOrder(node({ name: "#1", tags: ["Sport"] })), TAGS) === "Sport DE", "Sport-Tag -> Sport DE");
ok(categorize(normalizeOrder(node({ name: "#2", tags: ["Konzert"] })), TAGS) === "Konzerte DE", "Konzert-Tag -> Konzerte DE");
ok(categorize(normalizeOrder(node({ name: "#3", tags: ["Konzert", "AT"] })), TAGS) === "Österreich", "AT-Tag schlägt DE -> Österreich");
ok(categorize(normalizeOrder(node({ name: "#4", type: "Reisen" })), TAGS) === "Reisen", "Typ Reisen -> Reisen");
ok(categorize(normalizeOrder(node({ name: "#5", tags: [] })), TAGS) === "Unzugeordnet", "ohne Tag/Titel -> Unzugeordnet (DE)");
// Land aus dem Titel
ok(categorize(normalizeOrder(node({ name: "#6", title: "Act_Wien_2027_(AT)" })), TAGS) === "Österreich", "Titel (AT) -> Österreich");
ok(categorize(normalizeOrder(node({ name: "#7", title: "Act_Wien_2027" })), TAGS) === "Österreich", "Titel Wien -> Österreich");
ok(categorize(normalizeOrder(node({ name: "#8", title: "Act_Berlin_(DE)", tags: ["Sport"] })), TAGS) === "Sport DE", "Titel (DE)+Sport-Tag -> Sport DE");
ok(categorize(normalizeOrder(node({ name: "#9", title: "Act_Salzburg_2027", tags: ["Sport"] })), TAGS) === "Österreich", "AT-Stadt schlägt Sport-Tag -> Österreich");

// Stornierung
const cancel = extractEvents(normalizeOrder(node({ name: "#10", tags: ["Sport"], cancelledAt: "2026-06-09T10:00:00Z", total: "120.00" })), TAGS, null);
ok(cancel.cancellations.length === 1 && cancel.cancellations[0].amountCents === 12000 && cancel.cancellations[0].category === "Sport DE", "Storno: Betrag + Kategorie");
ok(cancel.cancellations[0].date === "2026-06-09T10:00:00Z", "Storno: Datum = cancelledAt");

// Rückerstattung (echtes Datum + Betrag), seit-Filter
const refOrder = normalizeOrder(node({ name: "#11", tags: ["Konzert"], refunds: [{ date: "2026-06-08T09:00:00Z", amt: "50.00" }, { date: "2026-05-01T09:00:00Z", amt: "20.00" }] }));
const r1 = extractEvents(refOrder, TAGS, null);
ok(r1.refunds.length === 2, "Refunds: alle ohne since");
const r2 = extractEvents(refOrder, TAGS, "2026-06-01T00:00:00Z");
ok(r2.refunds.length === 1 && r2.refunds[0].amountCents === 5000, "Refunds: since-Filter zieht nur neuen (50€)");
ok(r2.refunds[0].date === "2026-06-08T09:00:00Z" && r2.refunds[0].category === "Konzerte DE", "Refund: Datum + Kategorie");

// Offene Anfrage
const req = classifyRequest(normalizeOrder(node({ name: "#12", tags: ["Rückerstattung angefragt"], gw: ["paypal"], fin: "PAID" })), TAGS.refundRequest);
ok(req && req.status === "offen" && req.gateway === "paypal", "Anfrage: offen + PayPal");
const reqDone = classifyRequest(normalizeOrder(node({ name: "#13", tags: ["Rückerstattung angefragt"], fin: "REFUNDED" })), TAGS.refundRequest);
ok(reqDone && reqDone.status === "erstattet", "Anfrage: erstattet bei REFUNDED");
ok(classifyRequest(normalizeOrder(node({ name: "#14", tags: ["Sport"] })), TAGS.refundRequest) === null, "ohne Anfrage-Tag -> keine Anfrage");

// Gesamt-Sammler
const all = collectFromOrders([
  node({ name: "#20", tags: ["Sport"], cancelledAt: "2026-06-09T10:00:00Z" }),
  node({ name: "#21", tags: ["Konzert", "AT"], refunds: [{ date: "2026-06-09T11:00:00Z", amt: "30.00" }] }),
  node({ name: "#22", tags: ["Rückerstattung angefragt"], gw: ["klarna"] }),
], { tagCfg: TAGS, since: "2026-06-01T00:00:00Z" });
ok(all.cancellations.length === 1 && all.refunds.length === 1 && all.requests.length === 1, "collect: 1 Storno, 1 Refund, 1 Anfrage");
ok(all.refunds[0].category === "Österreich", "collect: AT-Refund korrekt kategorisiert");

console.log(`\nShopify-Logik-Tests: ${pass} ok, ${fail} fehlgeschlagen`);
process.exit(fail ? 1 : 0);
