// Reine Rechnungs-Heuristik (ohne PDF/Netz/KI) – aus Rechnungstext werden
// Zahlungsdaten geschätzt: IBAN, Betrag, Rechnungsnummer, Fälligkeit, Kreditor.
// Bewusst defensiv: liefert Vorschläge, der Nutzer bestätigt sie im Review.
import { cleanIban, validateIban } from "./iban.js";

const lc = (s) => String(s || "").toLowerCase();

// --- IBAN -------------------------------------------------------------------
export function findIbans(text) {
  const t = String(text || "").toUpperCase();
  const re = /\b([A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]){10,30})\b/g;
  const out = [];
  let m;
  while ((m = re.exec(t))) {
    const cand = cleanIban(m[1]);
    if (validateIban(cand).ok && !out.includes(cand)) out.push(cand);
  }
  return out;
}

const BIC_RE = /\b[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}(?:[A-Z0-9]{3})?\b/;
export function findBic(text) {
  // Nur aus einer Zeile mit „BIC"/„SWIFT" – sonst zu fehleranfällig (Wörter sehen aus wie BIC).
  for (const line of String(text || "").split(/\r?\n/)) {
    if (/\b(bic|swift)\b/i.test(line)) {
      const m = line.toUpperCase().replace(/\b(BIC|SWIFT)\b/g, " ").match(BIC_RE);
      if (m) return m[0];
    }
  }
  return "";
}

// --- Beträge ----------------------------------------------------------------
const AMOUNT_RE = /(\d{1,3}(?:\.\d{3})+|\d+),(\d{2})\b/g; // deutsch: 1.234,56 / 1234,56
export function amountToCents(s) {
  const m = String(s).match(/(\d{1,3}(?:\.\d{3})+|\d+),(\d{2})/);
  if (!m) return 0;
  return Math.round((parseInt(m[1].replace(/\./g, ""), 10) + parseInt(m[2], 10) / 100) * 100);
}
// Schlüsselwörter mit Priorität (höher = wichtiger) für den Zahlbetrag.
const TOTAL_KEYS = [
  { re: /zu\s*zahlen|zahlbetrag|zahlungsbetrag/i, w: 100 },
  { re: /gesamtbetrag|rechnungsbetrag|endbetrag|gesamtsumme/i, w: 90 },
  { re: /\bbrutto\b|gesamt\b|\btotal\b|\bsumme\b/i, w: 70 },
];
export function findAmountCents(lines) {
  const arr = Array.isArray(lines) ? lines : String(lines || "").split(/\r?\n/);
  let best = null, fallbackMax = 0;
  for (const line of arr) {
    const amounts = line.match(AMOUNT_RE);
    if (amounts) for (const a of amounts) fallbackMax = Math.max(fallbackMax, amountToCents(a));
    for (const k of TOTAL_KEYS) {
      if (k.re.test(line) && amounts && amounts.length) {
        const cents = amountToCents(amounts[amounts.length - 1]); // letzter Betrag der Zeile
        if (cents > 0 && (!best || k.w > best.w)) best = { cents, w: k.w };
      }
    }
  }
  return best ? best.cents : fallbackMax; // ohne Schlüsselwort: größter Betrag als Schätzung
}

// --- Rechnungsnummer --------------------------------------------------------
export function findInvoiceNumber(text) {
  const t = String(text || "");
  const re = /(?:rechnung(?:s)?[\s-]*(?:nr|nummer)\.?|invoice\s*(?:no|number)\.?|beleg(?:nr|nummer)\.?|rg[\s-]*nr\.?)\s*[:#]?\s*([A-Za-z0-9][A-Za-z0-9\/\-.]{2,30})/i;
  const m = t.match(re);
  return m ? m[1].replace(/[.\-/]+$/, "") : "";
}

// --- Fälligkeit / Datum -----------------------------------------------------
const DATE_RE = /\b(\d{1,2})\.\s?(\d{1,2})\.\s?(\d{2,4})\b/;
function toIso(d, m, y) {
  const yy = y.length === 2 ? "20" + y : y;
  return `${yy}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
export function findDueDate(text) {
  const arr = String(text || "").split(/\r?\n/);
  for (const line of arr) {
    if (/(fällig|zahlbar|zahlungsziel|fälligkeit|due\s*date|payable|zu\s*zahlen\s*bis)/i.test(line)) {
      const m = line.match(DATE_RE);
      if (m) return toIso(m[1], m[2], m[3]);
    }
  }
  return "";
}

// --- Kreditor (Lieferant) – grobe Schätzung aus dem Briefkopf ---------------
export function guessCreditor(text) {
  const lines = String(text || "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  // Erste „firmenartige" Zeile: enthält Rechtsform oder ist großgeschrieben, kein Datum/Betrag.
  const formRe = /\b(gmbh|ug|ag|kg|ohg|e\.k\.|gbr|ltd|inc|e\.v\.|mbh|co\.?\s?kg)\b/i;
  const named = lines.slice(0, 12).find((l) => formRe.test(l) && l.length < 60);
  if (named) return named.replace(/\s{2,}/g, " ").trim();
  // sonst die erste nicht-leere Zeile (oft der Briefkopf)
  return (lines[0] || "").slice(0, 60);
}

// Gesamt-Parser: nimmt entweder rohen Text oder Zeilen-Array.
export function parseInvoice(input) {
  const text = Array.isArray(input) ? input.join("\n") : String(input || "");
  const ibans = findIbans(text);
  return {
    iban: ibans[0] || "",
    ibans,
    bic: findBic(text),
    amountCents: findAmountCents(text),
    invoiceNumber: findInvoiceNumber(text),
    dueDate: findDueDate(text),
    creditorName: guessCreditor(text),
  };
}
