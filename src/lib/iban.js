// IBAN-Reinigung, Validierung (Prüfziffer/Mod-97) und BIC-Ableitung.
import { lookupBicByBlz } from "./blz.js";

// Erlaubte Längen je Land (Auszug SEPA-Raum; weitere bei Bedarf ergänzbar).
export const IBAN_LENGTHS = {
  DE: 22, AT: 20, CH: 21, LI: 21, LU: 20, NL: 18, BE: 16, FR: 27, MC: 27,
  IT: 27, ES: 24, PT: 25, IE: 22, GB: 22, PL: 28, CZ: 24, SK: 24, HU: 28,
  SI: 19, HR: 21, DK: 18, SE: 24, NO: 15, FI: 18, EE: 20, LV: 21, LT: 20,
  RO: 24, BG: 22, GR: 27, CY: 28, MT: 31, IS: 26,
};

// Entfernt alles außer A-Z und 0-9, macht Großbuchstaben.
// Behebt damit automatisch: Leerzeichen, Punkte, Zeilenumbrüche, Klein/Groß.
export function cleanIban(raw) {
  if (raw == null) return "";
  return String(raw).toUpperCase().replace(/[^A-Z0-9]/g, "");
}

// Mod-97 nach ISO 7064 / ISO 13616.
function mod97(iban) {
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  const numeric = rearranged.replace(/[A-Z]/g, (ch) => (ch.charCodeAt(0) - 55).toString());
  let remainder = 0;
  for (let i = 0; i < numeric.length; i += 7) {
    const block = String(remainder) + numeric.substring(i, i + 7);
    remainder = Number(block) % 97;
  }
  return remainder;
}

// Vollständige Prüfung: Struktur + Länge + Prüfziffer.
export function validateIban(raw) {
  const iban = cleanIban(raw);
  if (!iban) return { ok: false, iban, reason: "leer", code: "empty" };
  if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]+$/.test(iban))
    return { ok: false, iban, reason: "ungültiges Format", code: "format" };
  const country = iban.slice(0, 2);
  const expected = IBAN_LENGTHS[country];
  if (expected && iban.length !== expected)
    return { ok: false, iban, reason: `falsche Länge für ${country} (${iban.length}/${expected})`, code: "length" };
  if (mod97(iban) !== 1)
    return { ok: false, iban, reason: "Prüfziffer stimmt nicht", code: "checksum" };
  return { ok: true, iban, country };
}

// Hübsche Darstellung in 4er-Gruppen.
export function formatIban(iban) {
  return cleanIban(iban).replace(/(.{4})/g, "$1 ").trim();
}

// Liefert IBAN-Status inkl. abgeleiteter BIC + Bankname.
// online=true erlaubt Online-Lookup für ausländische IBANs (nur Erstattungs-Modul).
export async function inspectIban(raw, { online = false } = {}) {
  const v = validateIban(raw);
  if (!v.ok) return { ...v, bic: null, bank: null };
  const bicInfo = await lookupBicByBlz(v.iban, { online });
  return { ...v, bic: bicInfo?.bic || null, bank: bicInfo?.bank || null, bicSource: bicInfo?.source || null };
}
