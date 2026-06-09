// Tests für die Shopify-Auswertung (rein, ohne Netz).
import { normalizeOrder, categorize, extractEvents, extractDisputes, tallyDisputeOutcomes, collectFromOrders } from "../shopify.mjs";

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error("  ✗ " + m); } };

const TAGS = { reisen: ["reisen"], sportDe: ["sport"], konzertDe: ["konzert"], at: ["at", "österreich"] };

const node = (o) => ({
  name: o.name, createdAt: o.created || null, cancelledAt: o.cancelledAt || null, cancelReason: o.cancelReason || null,
  displayFinancialStatus: o.fin || "PAID", tags: o.tags || [], paymentGatewayNames: o.gw || ["bank"],
  customer: { displayName: o.cust || "Kunde" },
  totalPriceSet: { shopMoney: { amount: o.total || "100.00", currencyCode: "EUR" } },
  lineItems: { edges: [{ node: { title: o.title || "Act_Stadt_2026", product: { productType: o.type || "Tickets", tags: o.ptags || [] } } }] },
  refunds: (o.refunds || []).map((r, i) => ({ id: "gid://r/" + i, createdAt: r.date, totalRefundedSet: { shopMoney: { amount: r.amt, currencyCode: "EUR" } } })),
  disputes: (o.disputes || []).map((d, i) => ({ id: "gid://d/" + o.name + "/" + i, initiatedAs: d.initiatedAs || "INQUIRY", status: d.status })),
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

// Offene Rückbuchung (Dispute)
const dInquiry = extractDisputes(normalizeOrder(node({ name: "#12", tags: ["Konzert"], gw: ["shopify_payments"], disputes: [{ initiatedAs: "INQUIRY", status: "NEEDS_RESPONSE" }] })), TAGS);
ok(dInquiry.length === 1 && dInquiry[0].status === "offen" && dInquiry[0].art === "Anfrage" && dInquiry[0].phase === "Antwort nötig", "Dispute: Inquiry NEEDS_RESPONSE -> offen/Anfrage");
const dChargeback = extractDisputes(normalizeOrder(node({ name: "#13", disputes: [{ initiatedAs: "CHARGEBACK", status: "UNDER_REVIEW" }] })), TAGS);
ok(dChargeback[0].status === "offen" && dChargeback[0].art === "Rückbuchung" && dChargeback[0].phase === "in Prüfung", "Dispute: Chargeback UNDER_REVIEW -> offen/Rückbuchung");
const dLost = extractDisputes(normalizeOrder(node({ name: "#14", disputes: [{ initiatedAs: "CHARGEBACK", status: "LOST" }] })), TAGS);
ok(dLost[0].status === "erledigt" && dLost[0].phase === "verloren", "Dispute: LOST -> erledigt");
ok(extractDisputes(normalizeOrder(node({ name: "#15", tags: ["Sport"] })), TAGS).length === 0, "ohne Dispute -> keine Anfrage");
// Mehrere Disputes je Order (z.B. alter LOST + neuer offener)
const dMulti = extractDisputes(normalizeOrder(node({ name: "#16", disputes: [{ initiatedAs: "CHARGEBACK", status: "LOST" }, { initiatedAs: "INQUIRY", status: "UNDER_REVIEW" }] })), TAGS);
ok(dMulti.length === 2 && dMulti.filter((d) => d.status === "offen").length === 1, "Dispute: zwei je Order, einer offen");

// Gewinn-/Verlust-Quote
const stats = tallyDisputeOutcomes([
  node({ name: "#30", disputes: [{ status: "WON" }] }),
  node({ name: "#31", disputes: [{ status: "WON" }, { status: "LOST" }] }),
  node({ name: "#32", disputes: [{ status: "LOST" }] }),
  node({ name: "#33", disputes: [{ status: "NEEDS_RESPONSE" }] }),
  node({ name: "#34", disputes: [{ status: "UNDER_REVIEW" }] }),
  node({ name: "#35", disputes: [{ status: "ACCEPTED" }] }),
]);
ok(stats.won === 2 && stats.lost === 2 && stats.decided === 4 && stats.winRate === 50, "Quote: 2/2 -> 50%");
ok(stats.open === 2 && stats.openNeedsResponse === 1 && stats.openUnderReview === 1 && stats.accepted === 1, "Quote: offene + akzeptiert gezählt");
// Dedup: gleiche Order in zwei Listen -> Disputes nur einmal
const dedup = tallyDisputeOutcomes([node({ name: "#40", disputes: [{ status: "WON" }] }), node({ name: "#40", disputes: [{ status: "WON" }] })]);
ok(dedup.won === 1, "Quote: doppelte Order wird dedupliziert");
const empty = tallyDisputeOutcomes([node({ name: "#41" })]);
ok(empty.winRate === null && empty.decided === 0, "Quote: nichts entschieden -> winRate null");
// Aufschlüsselung nach Art
const byArt = tallyDisputeOutcomes([
  node({ name: "#50", disputes: [{ initiatedAs: "INQUIRY", status: "WON" }] }),
  node({ name: "#51", disputes: [{ initiatedAs: "INQUIRY", status: "WON" }] }),
  node({ name: "#52", disputes: [{ initiatedAs: "INQUIRY", status: "LOST" }] }),
  node({ name: "#53", disputes: [{ initiatedAs: "CHARGEBACK", status: "LOST" }] }),
  node({ name: "#54", disputes: [{ initiatedAs: "CHARGEBACK", status: "WON" }] }),
]);
ok(byArt.inquiry.won === 2 && byArt.inquiry.lost === 1 && byArt.inquiry.winRate === Math.round((2/3)*1000)/10, "Art: Anfragen 2/3");
ok(byArt.chargeback.won === 1 && byArt.chargeback.lost === 1 && byArt.chargeback.winRate === 50, "Art: Rückbuchungen 50%");
ok(byArt.won === 3 && byArt.lost === 2, "Art: Gesamtsumme bleibt korrekt");
// Jahres-Aufschlüsselung
const byYear = tallyDisputeOutcomes([
  node({ name: "#60", created: "2023-05-01T00:00:00Z", disputes: [{ initiatedAs: "INQUIRY", status: "WON" }] }),
  node({ name: "#61", created: "2023-08-01T00:00:00Z", disputes: [{ initiatedAs: "CHARGEBACK", status: "LOST" }] }),
  node({ name: "#62", created: "2024-02-01T00:00:00Z", disputes: [{ initiatedAs: "INQUIRY", status: "WON" }] }),
  node({ name: "#63", created: "2024-09-01T00:00:00Z", disputes: [{ initiatedAs: "INQUIRY", status: "WON" }] }),
  node({ name: "#64", created: "2024-10-01T00:00:00Z", disputes: [{ initiatedAs: "INQUIRY", status: "LOST" }] }),
]);
ok(byYear.byYear.length === 2, "Jahr: zwei Jahrgänge");
const y23 = byYear.byYear.find((y) => y.year === 2023);
const y24 = byYear.byYear.find((y) => y.year === 2024);
ok(y23.won === 1 && y23.lost === 1 && y23.winRate === 50, "Jahr 2023: 1/1 -> 50%");
ok(y24.won === 2 && y24.lost === 1 && y24.winRate === Math.round((2/3)*1000)/10, "Jahr 2024: 2/3");
ok(y24.inquiry.winRate === Math.round((2/3)*1000)/10 && y23.chargeback.winRate === 0, "Jahr: Art-Quote je Jahr");
ok(byYear.won === 3 && byYear.lost === 2, "Jahr: Gesamtsumme korrekt");

// Gesamt-Sammler
const all = collectFromOrders([
  node({ name: "#20", tags: ["Sport"], cancelledAt: "2026-06-09T10:00:00Z" }),
  node({ name: "#21", tags: ["Konzert", "AT"], refunds: [{ date: "2026-06-09T11:00:00Z", amt: "30.00" }] }),
  node({ name: "#22", gw: ["klarna"], disputes: [{ initiatedAs: "INQUIRY", status: "NEEDS_RESPONSE" }] }),
], { tagCfg: TAGS, since: "2026-06-01T00:00:00Z" });
ok(all.cancellations.length === 1 && all.refunds.length === 1 && all.requests.length === 1, "collect: 1 Storno, 1 Refund, 1 Rückbuchung");
ok(all.refunds[0].category === "Österreich", "collect: AT-Refund korrekt kategorisiert");

console.log(`\nShopify-Logik-Tests: ${pass} ok, ${fail} fehlgeschlagen`);
process.exit(fail ? 1 : 0);
