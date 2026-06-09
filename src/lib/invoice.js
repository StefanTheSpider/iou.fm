// Rechnungsprüfung: aus Rechnungspositionen + tatsächlich angenommener Menge
// den freigegebenen (zu zahlenden) Betrag berechnen. Speist die Sammelüberweisung.
import { parseAmount } from "./money.js";

export function emptyLine() {
  return { id: crypto.randomUUID(), desc: "", qty: "1", price: "", accepted: "" };
}

// menge/angenommen als Zahl (Komma erlaubt); leer bei "angenommen" = volle Menge.
function num(v, fallback = 0) {
  const n = parseFloat(String(v ?? "").replace(/\./g, "").replace(",", "."));
  return isFinite(n) ? n : fallback;
}

export function lineCalc(line) {
  const qty = num(line.qty, 0);
  const acceptedRaw = String(line.accepted ?? "").trim();
  const accepted = acceptedRaw === "" ? qty : num(acceptedRaw, 0);
  const priceCents = parseAmount(line.price).cents; // Einzelpreis in Cent
  return {
    qty, accepted, priceCents,
    invoicedCents: Math.round(qty * priceCents),
    approvedCents: Math.round(Math.max(0, accepted) * priceCents),
  };
}

export function invoiceTotals(lines) {
  let invoicedCents = 0, approvedCents = 0;
  const rows = lines.map((l) => {
    const c = lineCalc(l);
    invoicedCents += c.invoicedCents;
    approvedCents += c.approvedCents;
    return { line: l, ...c };
  });
  return { invoicedCents, approvedCents, diffCents: invoicedCents - approvedCents, rows };
}

// CSV/Copy-Paste: je Zeile "Bezeichnung[TAB/;]Menge[TAB/;]Einzelpreis".
export function parsePastedLines(text) {
  const out = [];
  for (const raw of String(text).split(/\r?\n/)) {
    const t = raw.trim();
    if (!t) continue;
    const parts = t.split(/\t|;/).map((s) => s.trim());
    if (parts.length < 2) continue;
    out.push({ id: crypto.randomUUID(), desc: parts[0] || "", qty: parts[1] || "1", price: parts[2] || "", accepted: "" });
  }
  return out;
}
