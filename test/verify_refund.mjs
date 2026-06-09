import { computeRefund } from "../src/lib/refund.js";
import { parseOrderNode, deriveEventLabel } from "../src/lib/shopify.js";

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log(`${c ? "✓" : "✗"} ${m}`); };

// --- Erstattungsberechnung gegen echte Sheet-Werte ---
let r = computeRefund({ paidCents: 39800, mode: "full" });
ok(r.refundCents === 39800 && r.keptCents === 0, "Voll: 398,00 -> 398,00 erstattet");

r = computeRefund({ paidCents: 39800, mode: "fee", value: 30 });
ok(r.refundCents === 27860 && r.keptCents === 11940, "30% Gebühr auf 398,00 -> 278,60 erstattet / 119,40 einbehalten");

r = computeRefund({ paidCents: 19800, mode: "fee", value: 20 });
ok(r.refundCents === 15840 && r.keptCents === 3960, "20% Gebühr auf 198,00 -> 158,40 / 39,60");

r = computeRefund({ paidCents: 55598, mode: "fee", value: 20 });
ok(r.refundCents === 44478, "20% Gebühr auf 555,98 -> 444,78 (Handball-Beispiel)");

r = computeRefund({ paidCents: 39800, mode: "fixed", value: 10000 });
ok(r.refundCents === 10000 && r.keptCents === 29800, "Fester Betrag 100,00 -> 100,00 erstattet");

r = computeRefund({ paidCents: 10000, mode: "fixed", value: 15000 });
ok(r.valid && r.warning, "Fester Betrag > gezahlt -> Warnung");

r = computeRefund({ paidCents: 39800, mode: "fee", value: 150 });
ok(!r.valid, "Gebühr 150% -> ungültig");

// --- Shopify-Parsing (GraphQL-Order-Node wie bei #33220) ---
const node = {
  name: "#33220",
  customer: { displayName: "Serap Ermis" },
  totalPriceSet: { shopMoney: { amount: "298.00", currencyCode: "EUR" } },
  lineItems: { edges: [{ node: { title: "Herbert Grönemeyer_Frankfurt_So. 13.06.2027_Open Airs 2027_(DE)", quantity: 2 } }] },
};
const o = parseOrderNode(node);
ok(o.orderNumber === "33220", `Bestellnummer ${o.orderNumber}`);
ok(o.customerName === "Serap Ermis", `Kunde ${o.customerName}`);
ok(o.totalCents === 29800, `Betrag ${o.totalCents} Cent`);
ok(o.eventShort === "Herbert Grönemeyer Frankfurt", `Event "${o.eventShort}"`);
ok(o.suggestedPurpose === "Erstattung 33220 Herbert Grönemeyer Frankfurt", `Verwendungszweck "${o.suggestedPurpose}"`);
ok(deriveEventLabel("Metallica_Berlin_Sa. 30.05.2026_(DE)") === "Metallica Berlin", "Event-Label aus Titel");

console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen`);
process.exit(fail ? 1 : 0);
