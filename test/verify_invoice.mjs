import { invoiceTotals, lineCalc, parsePastedLines } from "../src/lib/invoice.js";

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log(`${c ? "✓" : "✗"} ${m}`); };

// Lachs abgelehnt (0 angenommen), Brot voll angenommen
const lines = [
  { desc: "Lachs 5kg", qty: "5", price: "20,00", accepted: "0" },
  { desc: "Brot", qty: "10", price: "2,50", accepted: "" },   // leer = volle Menge
  { desc: "Wein", qty: "6", price: "8,00", accepted: "4" },   // 2 nicht angenommen
];
const t = invoiceTotals(lines);
ok(t.invoicedCents === 5 * 2000 + 10 * 250 + 6 * 800, `Rechnungssumme ${(t.invoicedCents / 100).toFixed(2)} (erwartet 173,00)`);
ok(t.approvedCents === 0 + 10 * 250 + 4 * 800, `Freigegeben ${(t.approvedCents / 100).toFixed(2)} (erwartet 57,00)`);
ok(t.diffCents === t.invoicedCents - t.approvedCents, `Differenz ${(t.diffCents / 100).toFixed(2)}`);

const c = lineCalc({ qty: "3", price: "1.250,00", accepted: "" });
ok(c.approvedCents === 3 * 125000, "Tausenderpunkt im Preis korrekt geparst");

const p = parsePastedLines("Lachs;5;20,00\nBrot\t10\t2,50\n\nLeer");
ok(p.length === 2, `CSV/TSV: 2 gültige Zeilen (${p.length})`);
ok(p[0].desc === "Lachs" && p[1].qty === "10", "CSV-Felder korrekt zugeordnet");

console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen`);
process.exit(fail ? 1 : 0);
