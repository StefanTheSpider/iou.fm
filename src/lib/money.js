// Betrags- und Währungs-Parsing + EUR-Umrechnung (EZB-Tageskurs).

const CURRENCY_TOKENS = [
  { re: /€|eur/i, code: "EUR" },
  { re: /chf|sfr/i, code: "CHF" },
  { re: /\bft\b|huf/i, code: "HUF" },
  { re: /z[łl]|pln/i, code: "PLN" },
  { re: /£|gbp/i, code: "GBP" },
  { re: /\bkr\b|sek/i, code: "SEK" },
  { re: /czk|kč/i, code: "CZK" },
  { re: /\$|usd/i, code: "USD" },
];

// "1.797,00 €" -> { cents: 179700, currency: "EUR" }
// "347,12CHF"  -> { cents: 34712,  currency: "CHF" }
export function parseAmount(raw) {
  if (raw == null) return { cents: 0, currency: "EUR", valid: false };
  let s = String(raw).trim();
  if (!s) return { cents: 0, currency: "EUR", valid: false };

  let currency = "EUR";
  for (const t of CURRENCY_TOKENS) {
    if (t.re.test(s)) { currency = t.code; break; }
  }

  // Nur Ziffern, Punkt, Komma, Minus behalten.
  let num = s.replace(/[^0-9.,-]/g, "");
  const hasComma = num.includes(",");
  const hasDot = num.includes(".");
  if (hasComma && hasDot) {
    // deutsches Format: Punkt = Tausender, Komma = Dezimal
    num = num.replace(/\./g, "").replace(",", ".");
  } else if (hasComma) {
    num = num.replace(",", ".");
  } else if (hasDot) {
    // Punkt nur Dezimal, wenn genau 2 Nachkommastellen, sonst Tausender
    const parts = num.split(".");
    if (parts.length === 2 && parts[1].length === 2) {
      // bleibt Dezimalpunkt
    } else {
      num = num.replace(/\./g, "");
    }
  }
  const value = parseFloat(num);
  if (!isFinite(value)) return { cents: 0, currency, valid: false };
  return { cents: Math.round(value * 100), currency, valid: value > 0 };
}

// EZB-Tageskurs über frankfurter.app (verwendet die offiziellen
// EZB-Referenzkurse, kostenlos, ohne Schlüssel). Nur im Erstattungs-Modul
// (Cloud) aktiv – das Lohn-Modul rechnet ausschließlich in EUR.
const rateCache = new Map();
export async function ecbRateToEur(currency, date = "latest") {
  if (currency === "EUR") return 1;
  const cacheKey = `${currency}-${date}`;
  if (rateCache.has(cacheKey)) return rateCache.get(cacheKey);
  const url = `https://api.frankfurter.app/${date}?from=${currency}&to=EUR`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Kurs für ${currency} nicht abrufbar`);
  const json = await res.json();
  const rate = json?.rates?.EUR;
  if (!rate) throw new Error(`Kein EUR-Kurs für ${currency}`);
  rateCache.set(cacheKey, rate);
  return rate;
}

// Fremdwährungsbetrag (in Cent) in EUR-Cent umrechnen.
export async function toEurCents(cents, currency) {
  if (currency === "EUR") return { eurCents: cents, rate: 1 };
  const rate = await ecbRateToEur(currency);
  return { eurCents: Math.round(cents * rate), rate };
}

export function formatEur(cents) {
  return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" })
    .format((cents || 0) / 100);
}
