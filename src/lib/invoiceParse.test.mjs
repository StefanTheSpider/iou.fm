// Tests für die Rechnungs-Heuristik (rein, ohne PDF). Lauf: node src/lib/invoiceParse.test.mjs
import { parseInvoice, findIbans, findAmountCents, findInvoiceNumber, findDueDate, findBic } from "./invoiceParse.js";

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error("  ✗ " + m); } };

const inv = `Muster Veranstaltungstechnik GmbH
Beispielstr. 1, 12345 Berlin
Rechnung Nr. 2026-0815
Zwischensumme 1.200,00
zzgl. 19% USt 228,00
Gesamtbetrag 1.428,00 EUR
Zu zahlen bis 30.06.2026: 1.428,00 EUR
IBAN: DE89 3704 0044 0532 0130 00
BIC: COBADEFFXXX`;

const r = parseInvoice(inv);
ok(r.iban === "DE89370400440532013000", "IBAN erkannt + normalisiert");
ok(r.bic === "COBADEFFXXX", "BIC nur aus BIC-Zeile (nicht aus 'Beispielstr.')");
ok(r.amountCents === 142800, "Zahlbetrag = Gesamt/Zu-zahlen (1.428,00)");
ok(r.invoiceNumber === "2026-0815", "Rechnungsnummer");
ok(r.dueDate === "2026-06-30", "Fälligkeit aus 'Zu zahlen bis'");
ok(r.creditorName.includes("Muster") && /GmbH/.test(r.creditorName), "Kreditor aus Briefkopf");

// Mehrere IBANs (z. B. eigene + Lieferant) -> alle gültigen
const multi = findIbans("Unsere IBAN DE89370400440532013000 / Ihre Zahlung an DE12500105170648489890");
ok(multi.length === 2, "mehrere gültige IBANs gefunden");

// Betrag ohne Schlüsselwort -> größter Betrag als Schätzung
ok(findAmountCents(["Position A 19,00", "Position B 250,00", "Versand 4,90"]) === 25000, "ohne Schlüsselwort: größter Betrag");

// invalide IBAN wird verworfen
ok(findIbans("DE00000000000000000000").length === 0, "ungültige IBAN verworfen");

// Rechnungsnummer-Varianten
ok(findInvoiceNumber("Rechnungsnummer: RE-2026/4711") === "RE-2026/4711", "Rechnungsnummer mit /");
ok(findInvoiceNumber("Invoice No. INV12345") === "INV12345", "Invoice No (englisch)");

// Fälligkeit-Variante
ok(findDueDate("Fällig am 15.07.2026") === "2026-07-15", "Fällig am");

console.log(`\nRechnungs-Parser-Tests: ${pass} ok, ${fail} fehlgeschlagen`);
process.exit(fail ? 1 : 0);
