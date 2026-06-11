// E-Rechnungs-Kernprüfung nach EN 16931 (Pflichtfelder + Rechen-Konsistenz).
// Kein vollständiges Schematron, aber die zentralen Geschäftsregeln (BR-*), die
// für die deutsche E-Rechnungspflicht praktisch entscheidend sind.
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

export function validateEInvoice(f = {}) {
  const errors = [], warnings = [];
  const need = (cond, code, msg) => { if (!cond) errors.push(`${code}: ${msg}`); };
  const warn = (cond, code, msg) => { if (!cond) warnings.push(`${code}: ${msg}`); };

  // Pflichtangaben
  need(!!f.invoiceNumber, "BR-2", "Rechnungsnummer fehlt");
  need(!!f.issueDate, "BR-3", "Rechnungsdatum fehlt");
  need(!!f.currency, "BR-5", "Währung fehlt");
  need(!!f.sellerName, "BR-6", "Name des Verkäufers fehlt");
  need(!!f.buyerName, "BR-7", "Name des Käufers fehlt");
  need((f.lineCount || 0) >= 1, "BR-16", "Mindestens eine Rechnungsposition erforderlich");
  warn(!!(f.sellerVatId || f.sellerTaxNo), "BR-CO-26", "USt-IdNr. oder Steuernummer des Verkäufers fehlt");

  // Rechen-Konsistenz (Beträge in Euro als Zahl)
  if (f.lineNetTotal != null && f.taxTotal != null && f.grandTotal != null) {
    need(round2(f.lineNetTotal + f.taxTotal) === round2(f.grandTotal),
      "BR-CO-15", `Netto (${round2(f.lineNetTotal)}) + Steuer (${round2(f.taxTotal)}) ≠ Brutto (${round2(f.grandTotal)})`);
  }
  if (f.grandTotal != null && f.duePayable != null) {
    need(round2(f.grandTotal) === round2(f.duePayable + (f.prepaid || 0)),
      "BR-CO-16", `Zahlbetrag (${round2(f.duePayable)}) passt nicht zum Bruttobetrag (${round2(f.grandTotal)})`);
  }

  // Zahlung
  warn(!!f.iban, "BR-DE-Pay", "Keine IBAN/Zahlungsverbindung gefunden");
  if (f.iban) need(f.ibanValid !== false, "BR-IBAN", "IBAN ungültig (Prüfsumme)");

  return { ok: errors.length === 0, errors, warnings, profile: f.profile || "" };
}

// Kurzlabel für die UI.
export function validationLabel(v) {
  if (!v) return "";
  if (v.ok && !v.warnings.length) return "E-Rechnung geprüft (EN 16931): gültig";
  if (v.ok) return `E-Rechnung gültig · ${v.warnings.length} Hinweis(e)`;
  return `E-Rechnung: ${v.errors.length} Fehler`;
}
