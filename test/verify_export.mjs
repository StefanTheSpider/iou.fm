import { flatten, toCsv, toDatev, kindLabel } from "../src/lib/datevExport.js";

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log(`${c ? "✓" : "✗"} ${m}`); };

const batches = [
  { kind: "lohn", execDate: "2026-05-27", createdAt: "2026-06-01", accountLabel: "Hauptkonto", filename: "27_05_26_Lohn_SEPA.xml",
    payments: [{ name: "Marek Zielinski", iban: "DE89200400000383904000", amountCents: 556589, purpose: "Gehalt 05/2026" }] },
  { kind: "erstattung", execDate: "2026-06-08", createdAt: "2026-06-08", accountLabel: "Ticketkonto", filename: "08_06_26_Erstattung_SEPA.xml",
    payments: [{ name: "Daniel Ramos Fortes", iban: "DE95200400000343865202", amountCents: 13860, purpose: "Erstattung 33222 Daniel Caesar Köln" }] },
];

const rows = flatten(batches);
ok(rows.length === 2, `2 Zahlungszeilen aus 2 Batches (${rows.length})`);
ok(kindLabel("lohn") === "Lohn/Gehalt", "Typ-Label");

const c = toCsv(rows);
ok(c.includes("Ausführungsdatum;Typ;Empfänger"), "CSV-Kopf vorhanden");
ok(c.includes("5565,89"), "CSV Betrag im deutschen Format");
ok(c.includes("5704,49"), `CSV Summe 5704,49 (${(556589 + 13860) / 100})`);

const d = toDatev(rows, { berater: "341513", mandant: "50852", bankKonto: "1200", kontoLohn: "4120", kontoErstattung: "4830" });
const dl = d.split("\r\n");
ok(dl[0].startsWith("﻿EXTF;700;21;\"Buchungsstapel\"") || dl[0].startsWith("EXTF;700;21;\"Buchungsstapel\""), "DATEV EXTF-Kopf");
ok(dl[0].includes(";341513;50852;"), "DATEV Berater-/Mandantennummer im Kopf");
ok(dl[1].includes("Umsatz (ohne Soll/Haben-Kz)") && dl[1].includes("Buchungstext"), "DATEV Spaltenüberschriften");
ok(dl[2].startsWith("5565,89;S;EUR;"), "DATEV Buchungszeile: Betrag, Soll, WKZ");
ok(dl[2].includes(";4120;1200;"), "DATEV Konto/Gegenkonto (Lohn -> 4120 gegen 1200)");
ok(dl[2].includes(";2705;"), "DATEV Belegdatum TTMM (2705)");
ok(dl[3].includes(";4830;1200;"), "DATEV Erstattung -> 4830 gegen 1200");

console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen`);
process.exit(fail ? 1 : 0);
