import { buildAccountantCsv, entriesForMonth, combinedEntries, prevMonthKey, thisMonthKey, isLastDayOfMonth } from "../accountant.mjs";

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error("  ✗ " + m); } };

const feed = {
  cancellations: [
    { date: "2026-05-03T10:00:00Z", event: "BTS München", customer: "Max", orderNumber: "1001", category: "Konzerte DE", amountCents: 12900 }, // nur Storno
    { date: "2026-05-10T10:00:00Z", event: "Lady Gaga", customer: "Eva", orderNumber: "1005", category: "Konzerte DE", amountCents: 20000 },   // Storno + Refund
  ],
  refunds: [
    { date: "2026-05-20T09:00:00Z", event: "Sportevent Wien", customer: "Ali", orderNumber: "1003", category: "Österreich", amountCents: 7400, paidCents: 7400 }, // nur Refund
    { date: "2026-05-11T09:00:00Z", event: "Lady Gaga", customer: "Eva", orderNumber: "1005", category: "Konzerte DE", amountCents: 20000, paidCents: 20000 },    // Refund zu 1005
    { date: "2026-06-01T09:00:00Z", event: "X", customer: "Z", orderNumber: "1009", category: "X", amountCents: 5000, paidCents: 5000 },
  ],
};

// Dedup: 1005 nur EINE Zeile, markiert "Storniert & erstattet"
const comb = combinedEntries(feed);
const r1005 = comb.filter((r) => r.orderNumber === "1005");
ok(r1005.length === 1, "1005 nur eine Zeile (keine Doppelzählung)");
ok(r1005[0].art === "Storniert & erstattet", "1005 als 'Storniert & erstattet'");
ok(comb.find((r) => r.orderNumber === "1001").art === "Stornierung", "1001 reines Storno");
ok(comb.find((r) => r.orderNumber === "1003").art === "Erstattung", "1003 reine Erstattung");

const may = entriesForMonth(feed, "2026-05");
ok(may.length === 3, "Mai: 3 Zeilen (1001, 1003, 1005) – nicht 4");

const csv = buildAccountantCsv(feed, "2026-05");
const head = csv.split("\r\n")[0];
ok(head === "Art;Veranstaltung;Datum;Kunde;Bestellnummer;Kategorie;Verwendungszweck;Urspr. gezahlt (EUR);Erstattet/Storniert (EUR)", "CSV: neue Kopfzeile mit Verwendungszweck + Urspr. gezahlt");
ok(csv.includes("Storniert & erstattet;Lady Gaga;11.05.2026;Eva;1005;Konzerte DE;Erstattung 1005 Lady Gaga;200,00;200,00"), "CSV: 1005 eine Zeile, Verwendungszweck gefüllt, 200,00");
ok(comb.find((r) => r.orderNumber === "1001").purpose === "Stornierung 1001 BTS München", "Verwendungszweck auch bei reinem Storno gefüllt");
ok(/Summe;;;;;;;;403,00/.test(csv), "CSV: Summe 129 + 74 + 200 = 403,00 (keine Doppelzählung)");

// App-/SEPA-Erstattung mit Verwendungszweck + urspr. Betrag
const app = [{ orderNumber: "29985", customer: "Melissa", event: "BTS", amountCents: 14990, paidCents: 149900, purpose: "Erstattung 29985 BTS", date: "2026-05-15", category: "" }];
const csvApp = buildAccountantCsv(feed, "2026-05", app);
ok(csvApp.includes("Erstattung (App/SEPA);BTS;15.05.2026;Melissa;29985;;Erstattung 29985 BTS;1499,00;149,90"), "CSV: App-Erstattung mit Verwendungszweck + urspr. gezahlt (1499,00) + erstattet (149,90)");

// Monats-Helfer
ok(prevMonthKey(new Date("2026-01-15")) === "2025-12", "prevMonthKey Jahreswechsel");
ok(thisMonthKey(new Date("2026-06-10")) === "2026-06", "thisMonthKey");
ok(isLastDayOfMonth(new Date("2026-06-30T12:00:00")) === true, "letzter Tag 30.06");
ok(isLastDayOfMonth(new Date("2026-02-28T12:00:00")) === true, "letzter Tag 28.02 (kein Schaltjahr)");
ok(isLastDayOfMonth(new Date("2026-06-29T12:00:00")) === false, "29.06 nicht letzter Tag");

console.log(`\nBuchhalter-Versand-Tests: ${pass} ok, ${fail} fehlgeschlagen`);
process.exit(fail ? 1 : 0);
