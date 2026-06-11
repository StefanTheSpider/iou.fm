import { buildAccountantCsv, entriesForMonth, prevMonthKey, thisMonthKey, isLastDayOfMonth } from "../accountant.mjs";

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error("  ✗ " + m); } };

const feed = {
  cancellations: [
    { date: "2026-05-03T10:00:00Z", event: "BTS München", customer: "Max", orderNumber: "1001", category: "Konzerte DE", amountCents: 12900 },
    { date: "2026-06-01T10:00:00Z", event: "Robbie Düsseldorf", customer: "Eva", orderNumber: "1002", category: "Konzerte DE", amountCents: 5000 },
  ],
  refunds: [
    { date: "2026-05-20T09:00:00Z", event: "Sportevent Wien", customer: "Ali", orderNumber: "1003", category: "Österreich", amountCents: 7400 },
  ],
};

const may = entriesForMonth(feed, "2026-05");
ok(may.length === 2, "entriesForMonth: nur Mai-Einträge (2)");
ok(may[0].date < may[1].date, "entriesForMonth: nach Datum sortiert");

const csv = buildAccountantCsv(feed, "2026-05");
const lines = csv.split("\r\n");
ok(lines[0] === "Art;Veranstaltung;Datum;Kunde;Bestellnummer;Kategorie;Betrag (EUR)", "CSV: Kopfzeile");
ok(csv.includes("Stornierung;BTS München;03.05.2026;Max;1001;Konzerte DE;129,00"), "CSV: Storno-Zeile mit deutschem Betrag");
ok(csv.includes("Erstattung;Sportevent Wien;20.05.2026;Ali;1003;Österreich;74,00"), "CSV: Erstattung-Zeile");
ok(!csv.includes("Robbie"), "CSV: Juni-Eintrag NICHT im Mai-Export");
ok(/Summe;;;;;;203,00/.test(csv), "CSV: Summe = 129,00 + 74,00 = 203,00");

// App-/SEPA-Erstattungen werden mit aufgenommen (USt-Korrektur)
const appRefunds = [
  { orderNumber: "29985", customer: "Melissa Wilkop", event: "BTS München", amountCents: 14990, date: "2026-05-15", category: "" },
  { orderNumber: "30000", customer: "Egal", event: "X", amountCents: 5000, date: "2026-06-02", category: "" }, // anderer Monat
];
const csvApp = buildAccountantCsv(feed, "2026-05", appRefunds);
ok(csvApp.includes("Erstattung (App/SEPA);BTS München;15.05.2026;Melissa Wilkop;29985;;149,90"), "CSV: App-Erstattung mit Bestellnummer enthalten");
ok(!csvApp.includes("30000"), "CSV: App-Erstattung aus anderem Monat NICHT enthalten");
ok(/Summe;;;;;;352,90/.test(csvApp), "CSV: Summe inkl. App-Erstattung (203,00 + 149,90)");
ok(entriesForMonth(feed, "2026-05", appRefunds).length === 3, "entriesForMonth: inkl. App-Erstattung (3)");

// Quoting bei Semikolon/Anführungszeichen
const tricky = buildAccountantCsv({ cancellations: [{ date: "2026-05-01", event: 'A; "B"', customer: "X", orderNumber: "9", category: "Reisen", amountCents: 100 }] }, "2026-05");
ok(tricky.includes('"A; ""B"""'), "CSV: Sonderzeichen korrekt escaped");

// Monats-Helfer
ok(prevMonthKey(new Date("2026-01-15")) === "2025-12", "prevMonthKey: Jahreswechsel");
ok(thisMonthKey(new Date("2026-06-10")) === "2026-06", "thisMonthKey");
ok(isLastDayOfMonth(new Date("2026-06-30T12:00:00")) === true, "isLastDayOfMonth: 30.06 -> true");
ok(isLastDayOfMonth(new Date("2026-06-29T12:00:00")) === false, "isLastDayOfMonth: 29.06 -> false");
ok(isLastDayOfMonth(new Date("2026-02-28T12:00:00")) === true, "isLastDayOfMonth: 28.02.2026 (kein Schaltjahr) -> true");
ok(isLastDayOfMonth(new Date("2026-12-31T12:00:00")) === true, "isLastDayOfMonth: 31.12 -> true");

console.log(`\nBuchhalter-Versand-Tests: ${pass} ok, ${fail} fehlgeschlagen`);
process.exit(fail ? 1 : 0);
