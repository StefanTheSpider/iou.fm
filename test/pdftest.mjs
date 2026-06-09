import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { parseDatev, linesFromItems } from "../src/lib/datevParse.js";
import { validateIban } from "../src/lib/iban.js";
import { parseAmount } from "../src/lib/money.js";
import fs from "node:fs";

const path = "/sessions/great-adoring-hopper/mnt/uploads/Tix & Travel Abstimmliste LOhn 05_26 geändert(DE - SEPA, Kurzform).pdf";
const data = new Uint8Array(fs.readFileSync(path));
const pdf = await getDocument({ data, isEvalSupported: false, useSystemFonts: false }).promise;
let items = [];
for (let p = 1; p <= pdf.numPages; p++) {
  const page = await pdf.getPage(p);
  const c = await page.getTextContent();
  items = items.concat(c.items.filter(i=>i.str).map(i=>({x:i.transform[4], y:i.transform[5]+p*-10000, str:i.str})));
}
const lines = linesFromItems(items);
const r = parseDatev(lines);
console.log("Auftraggeber:", JSON.stringify(r.debtor.name), "| IBAN:", r.debtor.iban, "| BIC:", r.debtor.bic, "| Datum:", r.executionDate, "| Ref:", r.reference);
console.log("Empfänger erkannt:", r.payments.length);
let sum = 0, bad = 0;
for (const p of r.payments) {
  const v = validateIban(p.ibanRaw); const a = parseAmount(p.amountRaw); sum += a.cents;
  if (!v.ok) bad++;
  console.log(`  ${v.ok?"OK":"!!"}  ${p.nameRaw.padEnd(26)} ${p.ibanRaw.padEnd(24)} ${p.amountRaw}`);
}
console.log("Summe:", (sum/100).toFixed(2), "| ungültige IBAN:", bad, "| erwartet 22951.76 / 11 / 0");
