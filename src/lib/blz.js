// BIC-Ableitung aus der IBAN.
//
// DE: Die Bankleitzahl steckt in Stelle 5–12 der IBAN. Nachgeschlagen wird im
// gebündelten Bankenverzeichnis (src/data/blz_de.js, ~2150 Institute). Banken,
// die dort fehlen (v. a. einige Commerzbank-Filialen und Direktbanken), deckt
// das Supplement unten ab. Läuft komplett offline.
//
// AT: kleines Starter-Verzeichnis (5-stellige Bankleitzahl).
// Ausland: optionaler Online-Lookup (nur im Erstattungs-Modul aktiv).
import BLZ_DE from "../data/blz_de.js";

// Ergänzungen für Banken, die im Verzeichnis fehlen.
const BLZ_DE_SUPPLEMENT = {
  // Commerzbank-Filialen (Haupt-BLZ je Region) -> zentrale BIC ist gültig
  "10040000": { bic: "COBADEFFXXX", bank: "Commerzbank, Berlin" },
  "20040000": { bic: "COBADEFFXXX", bank: "Commerzbank, Hamburg" },
  "30040000": { bic: "COBADEFFXXX", bank: "Commerzbank, Düsseldorf" },
  "60040071": { bic: "COBADEFFXXX", bank: "Commerzbank, Stuttgart" },
  "70040041": { bic: "COBADEFFXXX", bank: "Commerzbank, München" },
  "76040061": { bic: "COBADEFFXXX", bank: "Commerzbank, Nürnberg" },
  "85040000": { bic: "COBADEFFXXX", bank: "Commerzbank, Dresden" },
  // Direktbanken
  "10011001": { bic: "NTSBDEB1XXX", bank: "N26 Bank, Berlin" },
  "10010178": { bic: "REVODEB2XXX", bank: "Revolut Bank (DE)" },
  "10010123": { bic: "TRBKDEBBXXX", bank: "Trade Republic / Solaris, Berlin" },
};

const BLZ_AT = {
  "20111": { bic: "GIBAATWWXXX", bank: "Erste Bank, Wien" },
  "12000": { bic: "BKAUATWWXXX", bank: "UniCredit Bank Austria" },
  "14200": { bic: "BAWAATWWXXX", bank: "BAWAG P.S.K." },
};

export function bankCodeFromIban(iban) {
  const country = iban.slice(0, 2);
  if (country === "DE") return iban.slice(4, 12); // 8-stellig
  if (country === "AT") return iban.slice(4, 9); // 5-stellig
  return null;
}

async function onlineLookup(iban) {
  // Platzhalter: später IBAN/BIC-Dienst fürs Erstattungs-Modul (Cloud).
  return null;
}

export async function lookupBicByBlz(iban, { online = false } = {}) {
  const country = iban.slice(0, 2);
  const code = bankCodeFromIban(iban);
  if (country === "DE" && code) {
    const e = BLZ_DE[code] || BLZ_DE_SUPPLEMENT[code];
    if (e) return { ...e, source: "verzeichnis-de" };
  }
  if (country === "AT" && code && BLZ_AT[code]) return { ...BLZ_AT[code], source: "verzeichnis-at" };
  if (online) {
    const r = await onlineLookup(iban);
    if (r) return { ...r, source: "online" };
  }
  return null; // BIC unbekannt – für EUR-SEPA unkritisch, IBAN genügt.
}
