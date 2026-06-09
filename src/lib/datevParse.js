// Reine Parse-Logik der DATEV-Abstimmliste (ohne PDF-Abhängigkeit, testbar).

// Textfragmente (mit x/y aus dem PDF) zu Zeilen gruppieren. Wichtig: Spalten
// einer Zeile liegen oft 1–2 px versetzt, deshalb mit Toleranz clustern statt
// exakt nach y zu runden.
export function linesFromItems(items, tol = 3) {
  const list = items
    .filter((i) => i.str && i.str.trim())
    .map((i) => ({ x: i.x, y: i.y, str: i.str }))
    .sort((a, b) => b.y - a.y || a.x - b.x);
  const lines = [];
  let cur = null;
  for (const it of list) {
    if (!cur || Math.abs(cur.y - it.y) > tol) {
      cur = { y: it.y, items: [it] };
      lines.push(cur);
    } else {
      cur.items.push(it);
    }
  }
  return lines
    .map((l) => l.items.sort((a, b) => a.x - b.x).map((i) => i.str).join(" ").replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

const IBAN_RE = /[A-Z]{2}\d{2}[A-Z0-9 ]{8,40}?(?=\s*$|\s{2,})/;
const IBAN_RE_LOOSE = /[A-Z]{2}\d{2}[A-Z0-9 ]{8,40}/;
const AMOUNT_END_RE = /(-?\d{1,3}(?:\.\d{3})*,\d{2})\s*$/;

function findLabel(lines, label) {
  const re = new RegExp(label + "\\s*:?\\s*(.+)", "i");
  for (const l of lines) {
    const m = l.match(re);
    if (m) return m[1].trim();
  }
  return "";
}

export function parseDatev(lines) {
  const auftraggeber = findLabel(lines, "Auftraggeber") || "";
  let bic = "", iban = "", executionDate = "", reference = "";

  for (const l of lines) {
    if (!bic) { const m = l.match(/BIC:?\s*([A-Z]{6}[A-Z0-9]{2,5})/); if (m) bic = m[1]; }
    if (!iban) { const m = l.match(/IBAN:?\s*([A-Z]{2}\d{2}[A-Z0-9 ]{10,40})/); if (m) iban = m[1].replace(/\s+/g, ""); }
    if (!executionDate) { const m = l.match(/Ausf[üu]hrungsdatum:?\s*(\d{2}\.\d{2}\.\d{4})/i); if (m) executionDate = m[1]; }
    if (!reference) { const m = l.match(/Referenznummer:?\s*(\d+)/i); if (m) reference = m[1]; }
  }

  const payments = [];
  for (const l of lines) {
    if (/Gesamtsumme|Zahlungsvorg/i.test(l)) continue;       // Summenzeile
    const amtM = l.match(AMOUNT_END_RE);                      // Betrag am Zeilenende
    if (!amtM) continue;
    const rest = l.slice(0, amtM.index).trim();
    if (/IBAN/i.test(rest)) continue;                        // Kopfzeile
    let ibanM = rest.match(IBAN_RE) || rest.match(IBAN_RE_LOOSE);
    if (!ibanM) continue;
    const name = rest.slice(0, ibanM.index).replace(/^\d+\s+/, "").trim();
    if (!name) continue;
    payments.push({
      nameRaw: name,
      ibanRaw: ibanM[0].replace(/\s+/g, ""),
      amountRaw: amtM[1],
    });
  }

  return {
    debtor: { name: auftraggeber, iban, bic },
    executionDate: toIsoDate(executionDate),
    executionDateDe: executionDate,
    reference,
    payments,
  };
}

export function toIsoDate(de) {
  const m = (de || "").match(/(\d{2})\.(\d{2})\.(\d{4})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : "";
}

export function tidyName(raw) {
  if (!raw) return "";
  const cleaned = raw.replace(/\s+/g, " ").trim();
  const isAllCaps = cleaned === cleaned.toUpperCase();
  let parts = cleaned.split(" ");
  if (parts.length === 2 && isAllCaps) parts = [parts[1], parts[0]];
  return parts.map((w) => (isAllCaps ? w.charAt(0) + w.slice(1).toLowerCase() : w)).join(" ");
}
