// camt.052/053 auslesen – nur die Salden (kein Buchungsdetail nötig für die Kontostandanzeige).
//
// In einem camt-Kontoauszug steht der Saldo in <Bal>-Blöcken. Codes (Tp/CdOrPrtry/Cd):
//   OPBD = Opening Booked (Anfangssaldo)
//   CLBD = Closing Booked  (Schlusssaldo – das ist „der Kontostand")
//   ITBD = Interim Booked  (Zwischensaldo, v. a. in camt.052 untertags)
//   CLAV / ITAV = verfügbarer Saldo
// Bewusst leichtgewichtig per Regex geparst (kein DOM nötig, läuft überall identisch).

const CLOSING_PRIORITY = ["CLBD", "CLAV", "ITBD", "ITAV", "PRCD"];

function pickTag(block, tag) {
  const m = block.match(new RegExp(`<(?:\\w+:)?${tag}\\b[^>]*>([\\s\\S]*?)</(?:\\w+:)?${tag}>`));
  return m ? m[1] : null;
}

// Liefert alle Salden als Liste { code, amount (Zahl), currency, creditDebit ('CRDT'|'DBIT'), signed }.
export function parseCamtBalances(xml) {
  const s = String(xml || "");
  const blocks = s.match(/<(?:\w+:)?Bal\b[^>]*>[\s\S]*?<\/(?:\w+:)?Bal>/g) || [];
  const out = [];
  for (const b of blocks) {
    const code = (pickTag(b, "Cd") || pickTag(b, "Prtry") || "").trim();
    const amtM = b.match(/<(?:\w+:)?Amt\b[^>]*\bCcy="([^"]+)"[^>]*>([\s\S]*?)<\/(?:\w+:)?Amt>/);
    if (!amtM) continue;
    const currency = amtM[1];
    const amount = parseFloat(String(amtM[2]).trim());
    const cdi = (pickTag(b, "CdtDbtInd") || "CRDT").trim().toUpperCase();
    const signed = cdi === "DBIT" ? -Math.abs(amount) : Math.abs(amount);
    out.push({ code, amount, currency, creditDebit: cdi, signed });
  }
  return out;
}

// Der „Kontostand": bevorzugt Schlusssaldo (CLBD), sonst nächstbeste Saldenart.
// Rückgabe: { code, signed, currency, creditDebit } oder null.
export function parseCamtBalance(xml) {
  const all = parseCamtBalances(xml);
  if (!all.length) return null;
  for (const code of CLOSING_PRIORITY) {
    const hit = all.find((b) => b.code === code);
    if (hit) return hit;
  }
  return all[all.length - 1];
}

// IBAN des Kontos aus dem camt (für die Anzeige „welches Konto").
export function parseCamtAccountIban(xml) {
  const m = String(xml || "").match(/<(?:\w+:)?Acct>[\s\S]*?<(?:\w+:)?IBAN>([\s\S]*?)<\/(?:\w+:)?IBAN>/);
  return m ? m[1].trim() : null;
}
