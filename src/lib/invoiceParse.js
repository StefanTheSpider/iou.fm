// Reine Rechnungs-Heuristik (ohne PDF/Netz/KI) – aus Rechnungstext werden
// Zahlungsdaten geschätzt: IBAN, Betrag, Rechnungsnummer, Fälligkeit, Kreditor.
// Bewusst defensiv: liefert Vorschläge, der Nutzer bestätigt sie im Review.
import { cleanIban, validateIban } from "./iban.js";

const lc = (s) => String(s || "").toLowerCase();

// Viele PDFs liefern Text glyph-weise mit eingestreuten Leerzeichen, z. B.
// "6.545 , - Euro" oder "0 8 /20 2 6". Diese Leerzeichen INNERHALB von Zahlen
// reparieren wir – nur zwischen Ziffern und ., / - (zeilenweise, ohne Zeilenumbrüche
// zu überspringen), damit Beträge und Rechnungsnummern zuverlässig erkannt werden.
export function normalizeSpacedNumbers(text) {
  return String(text || "")
    .replace(/(\d)[ \t]+(?=\d)/g, "$1")                  // "0 8" -> "08", "20 2 6" -> "2026"
    .replace(/(\d)[ \t]*([.,/])[ \t]*(?=[\d\-–—])/g, "$1$2") // "6.545 ," -> "6.545,", "1 .045" -> "1.045"
    .replace(/([.,])[ \t]*([-–—])/g, "$1$2");            // ", -" -> ",-"
}

// --- IBAN -------------------------------------------------------------------
export function findIbans(text) {
  const t = String(text || "").toUpperCase();
  // Generöser Kandidat: Ländercode + 2 Prüfziffern, dann Buchstaben/Ziffern/Leerzeichen.
  // Wichtig: IBANs kleben in echten PDFs oft direkt am Folgetext (z. B. „…8286 00 Bismarckstr.").
  const re = /[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]){10,40}/g;
  const out = [];
  let m;
  while ((m = re.exec(t))) {
    const cleaned = cleanIban(m[0]);
    // Längsten GÜLTIGEN Prefix nehmen – schneidet angeklebten Folgetext sauber ab.
    for (let len = Math.min(cleaned.length, 34); len >= 15; len--) {
      const cand = cleaned.slice(0, len);
      if (validateIban(cand).ok) { if (!out.includes(cand)) out.push(cand); break; }
    }
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
  { re: /endsumme|endbetrag|gesamtbetrag|rechnungsbetrag|gesamtsumme/i, w: 90 },
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
  const re = /(?:rechnung(?:s)?[\s-]*(?:nr|nummer)\.?|invoice\s*(?:no|number)\.?|beleg(?:nr|nummer)\.?|r[ge]\.?[\s-]*(?:nr|nummer)\.?)\s*[:#]?\s*([A-Za-z0-9][A-Za-z0-9\/\-.]{2,30})/i;
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
// Namen vergleichbar machen: „&"/„and"/„u." → „und", Rechtsform & Satzzeichen raus.
// So gilt „Tix & Travel GmbH" == „Tix and Travel GmbH" (häufiger OCR-Unterschied).
const normName = (s) => lc(s)
  .replace(/&/g, " und ")
  .replace(/\b(and|u)\b/g, "und")
  .replace(/\b(gmbh|ug|ag|kg|ohg|mbh|mbb|co|haftungsbeschr(ä|ae)nkt|e\.?\s?k\.?|gbr|ltd|inc|e\.?\s?v\.?)\b/g, " ")
  .replace(/[^a-z0-9äöüß ]+/g, " ").replace(/\s+/g, " ").trim();
const isOwnName = (line, ownNames) => {
  const L = normName(line); if (L.length < 3) return false;
  return (ownNames || []).some((n) => { const nn = normName(n); return nn.length >= 3 && L.includes(nn); });
};
export function guessCreditor(text, ownNames = []) {
  const lines = String(text || "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const own = (ownNames || []).filter(Boolean);
  const LABEL_RE = /(rechnung|nummer|\bnr\b|datum|kunden|bearbeiter|seite|betrag|summe|telefon|\bfax\b|e-?mail|ust|umsatzsteuer|iban|bic|artikel|bezeichnung|menge|mwst|versand|zahlung|bestellung|original|leistung|lieferung|zeitraum)/i;
  const ADDR_RE = /(stra(ß|ss)e|str\.|\bweg\b|allee|platz|gasse|\bring\b|deutschland|österreich|schweiz|germany|austria)/i;
  const looksSpaced = (l) => { const t = l.split(/\s+/).filter(Boolean); return t.length >= 6 && t.filter((x) => x.length === 1).length / t.length > 0.5; };
  const STOP = /^(vom|von|der|die|das|und|für|den|dem|am|im|zum|zur|inkl|netto|brutto)$/i;
  const wordCount = (l) => l.split(/\s+/).filter((t) => /^[A-Za-zÄÖÜäöüß.&-]{2,}$/.test(t) && !STOP.test(t)).length;
  const clean = (l) => l.replace(/\s{2,}/g, " ").slice(0, 70).trim();
  // „Namensartige" Zeile: ≥2 echte Wörter, keine Beschriftung/Adresse/Zahl, keine Sperrschrift, nicht eigene Firma.
  const nameish = (l) => l && !/^\d/.test(l) && !LABEL_RE.test(l) && !ADDR_RE.test(l) && !looksSpaced(l) && wordCount(l) >= 2 && l.length <= 60 && !isOwnName(l, own);

  // 1) „Kontoinhaber/Zahlungsempfänger: <Name>" – für SEPA am korrektesten.
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/(?:konto\s*-?\s*inhaber|kto\.?-?\s*inhaber|inhaber|account\s*holder|zahlungsempfänger|payee|begünstigter)\s*[:\-]?\s*(.*)$/i);
    if (m) {
      let name = (m[1] || "").trim();
      if (!name && lines[i + 1]) name = lines[i + 1].trim();
      name = clean(name);
      if (name && name.length >= 2 && !isOwnName(name, own)) return name;
    }
  }

  // 2) Zeile(n) direkt nach „Bankverbindung/Bankdaten".
  for (let i = 0; i < lines.length - 1; i++) {
    if (/bankverbindung|bankdaten/i.test(lines[i])) {
      for (let j = i + 1; j <= i + 2 && j < lines.length; j++) {
        const c = lines[j];
        if (c && !/^(iban|bic|swift|bank(name)?|konto|ust|vat|steuer)\b/i.test(c) && !/^\d/.test(c) && !isOwnName(c, own)) return clean(c);
      }
    }
  }

  // 3) Adressblock „Name / Straße + Nr. / PLZ Ort" – erster, der NICHT die eigene Firma ist
  //    (klassischer Brief: Absender = Lieferant; der Empfänger = eigene Firma wird übersprungen).
  for (let i = 0; i < lines.length - 2; i++) {
    const a = lines[i], b = lines[i + 1], c = lines[i + 2];
    const streetLine = /\d/.test(b) && /(stra(ß|ss)e|str\.?|\bweg\b|allee|platz|gasse|\bring\b)/i.test(b);
    const plzOrt = /^\d{5}\s+\S/.test(c);
    if (nameish(a) && streetLine && plzOrt && !isOwnName(b, own) && !isOwnName(c, own)) return clean(a);
  }

  // 4) Erste Firmen-Zeile (Rechtsform), nicht eigene Firma.
  const named = lines.slice(0, 20).find((l) => FORM_RE.test(l) && l.length < 70 && !isOwnName(l, own));
  if (named) return clean(named);

  // 5) Absender in EINER Zeile: „Name, Straße, PLZ Ort" (Name = Teil vor dem ersten Komma).
  for (const l of lines.slice(0, 6)) {
    if (l.includes(",") && /\b\d{5}\b/.test(l) && !isOwnName(l, own) && !/^\d/.test(l)) {
      const name = l.split(",")[0].trim();
      if (name.length >= 2 && !/(stra(ß|ss)e|str\.|weg|allee|platz|gasse|ring)\b/i.test(name) && !/\d/.test(name)) return name.slice(0, 70);
    }
  }

  // 6) Häufigster namensartiger Eintrag oben – der Lieferant steht oft mehrfach drauf
  //    (Briefkopf + Absenderblock + Fußzeile). Pattern-unabhängig, robust bei Scans.
  const freq = new Map();
  for (const l of lines.slice(0, 30)) if (nameish(l)) { const k = clean(l); freq.set(k, (freq.get(k) || 0) + 1); }
  let best = "", bestN = 1;
  for (const [k, n] of freq) if (n > bestN) { best = k; bestN = n; }
  if (best) return best;

  // 7) Fallback: erste namensartige Zeile, sonst leer (Nutzer füllt manuell – IBAN wird gemerkt).
  const first = lines.slice(0, 8).find(nameish);
  return first ? clean(first) : "";
}

// Gesamt-Parser: nimmt entweder rohen Text oder Zeilen-Array.
// opts.ownNames / opts.ownIbans = eigene Firma & Konten (Empfänger), die ausgeschlossen werden.
export function parseInvoice(input, opts = {}) {
  const text = Array.isArray(input) ? input.join("\n") : String(input || "");
  // Zahlen-reparierte Variante für Beträge, Rechnungsnummer und IBAN (die echte
  // PDF-Textextraktion streut Leerzeichen ein). Namen bleiben auf dem Originaltext.
  const num = normalizeSpacedNumbers(text);
  const ownIbans = (opts.ownIbans || []).map((s) => String(s || "").replace(/\s/g, "").toUpperCase());
  const allIbans = findIbans(num);
  // Eigene Konten als Kreditor-IBAN ausschließen – Geld geht an den LIEFERANTEN.
  const ibans = allIbans.filter((i) => !ownIbans.includes(i));
  // Hinweis, dass die Rechnung evtl. schon (extern) bezahlt ist – iou.fm kennt nur
  // Zahlungen, die DURCH iou.fm liefen; externe (PayPal/Karte/…) kann es nicht wissen.
  const paidHint = /zahlungs(art|form|weise)\s*:?\s*(paypal|kreditkarte|kreditk\.|lastschrift|sofort\b|klarna|amazon|vorkasse|giropay|apple\s*pay|google\s*pay)|bereits\s+(bezahlt|beglichen|gezahlt)|bezahlt\s+am|status\s*:?\s*bezahlt|\bbezahlt\b|\bpaid\b/i.test(num) || /\bpaypal\b/i.test(num);
  return {
    iban: (ibans[0] || allIbans[0] || ""),
    ibans: ibans.length ? ibans : allIbans,
    noIban: allIbans.length === 0,
    paidHint: paidHint,
    bic: findBic(num),
    amountCents: findAmountCents(num),
    invoiceNumber: findInvoiceNumber(num),
    dueDate: findDueDate(num),
    creditorName: guessCreditor(text, opts.ownNames || []),
  };
}
