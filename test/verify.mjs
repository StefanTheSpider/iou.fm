// Verifikation der reinen Logik gegen die echten DATEV-Daten (ohne PDF/Browser).
import { parseDatev } from "../src/lib/datevParse.js";
import { validateIban, cleanIban } from "../src/lib/iban.js";
import { parseAmount } from "../src/lib/money.js";
import { buildSepaXml, centsToAmount } from "../src/lib/sepa.js";

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log(`${c ? "✓" : "✗"} ${m}`); };

// --- Rekonstruierte Zeilen der DATEV-Abstimmliste (Mai 2026) ---
const lines = [
  "Empfangendes Institut: COMMERZBANK HAMBURG BLZ: 20040000 Konto-Nr.: 343865200",
  "BIC: COBADEFFXXX IBAN: DE52 2004 0000 0343 8652 00",
  "Auftraggeber: TIX + TRAVEL GMBH",
  "Ausführungsdatum: 27.05.2026",
  "Referenznummer: 2605270824 Berater-Nr. / Mandanten-Nr.:341513 / 50852",
  "Z.-Nr. Empfänger IBAN Betrag in Euro",
  "ZIELINSKI MAREK DE89 2004 0000 0383 9040 00 5.565,89",
  "TUAEV STEFAN DE46 2005 0550 1261 5937 17 3.900,00",
  "GANZENMUELLER LARA DE98 1203 0000 1033 6676 17 2.709,41",
  "ROLLENHAGEN IMKE DE95 2069 0500 0001 0494 42 547,16",
  "KINAY LEVENT DE61 3002 0900 3252 9343 29 555,98",
  "KINAY HANDAN DE97 3002 0900 5390 4854 33 555,98",
  "SADRI AFSHIN DE97 2005 0550 1008 9773 48 1.401,14",
  "MARKOVIC JOZO DE57 2004 0000 0244 1947 00 1.396,44",
  "GUEL TUNC DE54 3405 0000 0000 1592 93 2.884,57",
  "MATSIOU ATHANASIA DE68 2005 0550 1268 6168 00 2.403,01",
  "GANZENMUELLER MATS NICLAS DE31 1203 0000 1085 1522 52 1.032,18",
  "Anzahl Zahlungsvorgänge: 11 Gesamtsumme: 22.951,76",
];

const r = parseDatev(lines);

ok(r.payments.length === 11, `11 Empfänger erkannt (${r.payments.length})`);
ok(r.debtor.iban === "DE52200400000343865200", `Auftraggeber-IBAN: ${r.debtor.iban}`);
ok(r.debtor.bic === "COBADEFFXXX", `Auftraggeber-BIC: ${r.debtor.bic}`);
ok(r.debtor.name === "TIX + TRAVEL GMBH", `Auftraggeber: ${r.debtor.name}`);
ok(r.executionDate === "2026-05-27", `Ausführungsdatum (ISO): ${r.executionDate}`);
ok(r.reference === "2605270824", `Referenz: ${r.reference}`);

// IBAN-Prüfziffer aller Empfänger
let allValid = true;
for (const p of r.payments) {
  const v = validateIban(p.ibanRaw);
  if (!v.ok) { allValid = false; console.log(`   ✗ ungültig: ${p.nameRaw} ${p.ibanRaw} (${v.reason})`); }
}
ok(allValid, "alle 11 Empfänger-IBANs bestehen die Prüfziffer");

// Beträge & Summe
const cents = r.payments.map((p) => parseAmount(p.amountRaw).cents);
const sum = cents.reduce((a, b) => a + b, 0);
ok(sum === 2295176, `Gesamtsumme = ${centsToAmount(sum)} (erwartet 22951.76)`);
ok(cents.every((c) => c > 0), "alle Beträge > 0");

// SEPA-XML bauen und prüfen
const xml = buildSepaXml({
  debtor: { name: r.debtor.name, iban: r.debtor.iban, bic: r.debtor.bic },
  executionDate: r.executionDate,
  payments: r.payments.map((p) => ({
    name: p.nameRaw, iban: p.ibanRaw, bic: "", amountCents: parseAmount(p.amountRaw).cents,
    purpose: "Gehalt 05/2026", endToEndId: "NOTPROVIDED",
  })),
  category: "SALA",
});
ok(xml.includes("<CtrlSum>22951.76</CtrlSum>"), "XML CtrlSum = 22951.76");
ok((xml.match(/<NbOfTxs>11<\/NbOfTxs>/g) || []).length === 2, "XML NbOfTxs = 11 (GrpHdr + PmtInf)");
ok(xml.includes("<CtgyPurp><Cd>SALA</Cd></CtgyPurp>"), "XML enthält SALA-Kategorie");
ok(xml.includes("pain.001.001.09"), "XML ist pain.001.001.09");
ok((xml.match(/<CdtTrfTxInf>/g) || []).length === 11, "11 Transaktionsblöcke im XML");

// --- IBAN-Reinigung gegen typische Sheet-Verschmutzungen ---
ok(validateIban("DE87 2003 0000 0040 0646 00.").ok, "IBAN mit Leerzeichen+Punkt wird bereinigt & gültig");
ok(validateIban("DE 96 7525 0000 0200 1761 13").ok, "IBAN mit Leerzeichen wird bereinigt & gültig");
ok(cleanIban("de15\n2695 1311 0117 9070 06") === "DE1526951311011790700" + "6", "Zeilenumbruch+Kleinbuchstaben bereinigt");
// Echter Tippfehler (letzte Ziffer verändert) -> muss als ungültig erkannt werden
const broken = validateIban("DE89 2004 0000 0383 9040 01");
ok(!broken.ok && broken.code === "checksum", "Tippfehler-IBAN wird als ungültig (Prüfziffer) erkannt");

console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen`);
process.exit(fail ? 1 : 0);
