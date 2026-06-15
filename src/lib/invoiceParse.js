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
// deutsch: 1.234,56 / 1234,56 UND „1.234,-" / „5.500,–" (volle Euro mit Strich).
const AMOUNT_RE = /(\d{1,3}(?:\.\d{3})+|\d+),(\d{2}|[-–—])(?=\D|$)/g;
export function amountToCents(s) {
  const m = String(s).match(/(\d{1,3}(?:\.\d{3})+|\d+),(\d{2}|[-–—])/);
  if (!m) return 0;
  const euros = parseInt(m[1].replace(/\./g, ""), 10);
  const cents = /^\d{2}$/.test(m[2]) ? parseInt(m[2], 10) : 0; // „,-" = 00 Cent
  return Math.round(euros * 100 + cents);
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
  const re = /(?:rechnung(?:s)?[\s-]*(?:nr|nummer)\.?|invoice\s*(?:no|number)\.?|beleg(?:nr|nummer)\.?|r[ge]\.?[\s-]*nr\.?)\s*[:#]?\s*([A-Za-z0-9][A-Za-z0-9\/\-.]{2,30})/i;
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

// --- Kreditor (Lieferant) ---------------------------------------------------
// Wichtig: der EMPFÄNGER (die eigene Firma) steht ebenfalls oben auf der Rechnung
// und darf NICHT als Lieferant erkannt werden. `ownNames` (Auftraggeber-/Firmen-
// namen) werden deshalb aus allen Kandidaten ausgeschlossen.
const FORM_RE = /\b(gmbh|ug|ag|kg|ohg|e\.?\s?k\.?|gbr|ltd|inc|e\.?\s?v\.?|mbh|mbb|partg|partnerschaft|co\.?\s?kg)\b/i;
const isOwnName = (line, ownNames) => {
  const L = lc(line);
  return ownNames.some((n) => { const nn = lc(n).trim(); return nn.length >= 3 && L.includes(nn); });
};
export function guessCreditor(text, ownNames = []) {
  const lines = String(text || "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const own = (ownNames || []).filter(Boolean);

  // 1) „Kontoinhaber/Inhaber/Zahlungsempfänger: <Name>" – für SEPA am korrektesten
  //    (der Cdtr-Name muss zum Kontoinhaber passen).
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/(?:konto\s*-?\s*inhaber|kto\.?-?\s*inhaber|inhaber|account\s*holder|zahlungsempfänger|payee|begünstigter)\s*[:\-]?\s*(.*)$/i);
    if (m) {
      let name = (m[1] || "").trim();
      if (!name && lines[i + 1]) name = lines[i + 1].trim(); // Name evtl. in der Folgezeile
      name = name.replace(/\s{2,}/g, " ").slice(0, 70).trim();
      if (name && name.length >= 2 && !isOwnName(name, own)) return name;
    }
  }

  // 2) Zeile(n) direkt nach „Bankverbindung/Bankdaten" – dort steht oft der Absender.
  for (let i = 0; i < lines.length - 1; i++) {
    if (/bankverbindung|bankdaten/i.test(lines[i])) {
      for (let j = i + 1; j <= i + 2 && j < lines.length; j++) {
        const c = lines[j];
        if (c && !/^(iban|bic|swift|bank(name)?|konto|ust|vat|steuer)\b/i.test(c) && !/^\d/.test(c) && !isOwnName(c, own)) {
          return c.replace(/\s{2,}/g, " ").slice(0, 70).trim();
        }
      }
    }
  }

  // 3) Erste Firmen-Zeile (Rechtsform), die NICHT die eigene Firma ist
  //    (klassischer Briefkopf: Firmenname als eigene Zeile oben).
  const named = lines.slice(0, 20).find((l) => FORM_RE.test(l) && l.length < 70 && !isOwnName(l, own));
  if (named) return named.replace(/\s{2,}/g, " ").trim();

  // 4) Absender-Zeile im Briefkopf, Name+Adresse in EINER Zeile
  //    (z. B. „brandmade, Zaunwickenweg 1a, 21147 Hamburg"): Name = Teil vor dem ersten Komma.
  for (const l of lines.slice(0, 3)) {
    if (l.includes(",") && /\b\d{5}\b/.test(l) && !isOwnName(l, own) && !/^\d/.test(l)) {
      const name = l.split(",")[0].trim();
      // nur wenn der Teil vor dem Komma KEINE Straße/Hausnummer ist
      if (name.length >= 2 && !/(stra(ß|ss)e|str\.|weg|allee|platz|gasse|ring)\b/i.test(name) && !/\d/.test(name)) return name.slice(0, 70);
    }
  }

  // 5) Fallback: erste Zeile, die nicht die eigene Firma/Adresse ist.
  const first = lines.find((l) => !isOwnName(l, own) && !/^\d/.test(l));
  return (first || lines[0] || "").slice(0, 70);
}

// Gesamt-Parser: nimmt entweder rohen Text oder Zeilen-Array.
// opts.ownNames / opts.ownIbans = eigene Firma & Konten (Empfänger), die ausgeschlossen werden.
export function parseInvoice(input, opts = {}) {
  const text = Array.isArray(input) ? input.join("\n") : String(input || "");
  const ownIbans = (opts.ownIbans || []).map((s) => String(s || "").replace(/\s/g, "").toUpperCase());
  const allIbans = findIbans(text);
  // Eigene Konten als Kreditor-IBAN ausschließen – Geld geht an den LIEFERANTEN.
  const ibans = allIbans.filter((i) => !ownIbans.includes(i));
  return {
    iban: (ibans[0] || allIbans[0] || ""),
    ibans: ibans.length ? ibans : allIbans,
    bic: findBic(text),
    amountCents: findAmountCents(text),
    invoiceNumber: findInvoiceNumber(text),
    dueDate: findDueDate(text),
    creditorName: guessCreditor(text, opts.ownNames || []),
  };
}
