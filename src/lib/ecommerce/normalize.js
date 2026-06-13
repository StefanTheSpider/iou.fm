// Gemeinsame Normalisierung für alle Shop-Systeme, damit Erstattungen plattform-
// unabhängig dieselbe Datenstruktur bekommen.

// "Herbert Grönemeyer_Frankfurt_So. 13.06.2027_..." -> "Herbert Grönemeyer Frankfurt"
export function deriveEventLabel(title) {
  if (!title) return "";
  const parts = String(title).split("_").map((s) => s.trim()).filter(Boolean);
  if (parts.length >= 2) return `${parts[0]} ${parts[1]}`;
  return parts[0] || "";
}

// Zahlart aus Gateway-/Zahlungs-Texten ableiten (festgeschrieben).
export function methodFromText(...parts) {
  const g = parts.filter(Boolean).map((x) => String(x).toLowerCase()).join(" ");
  if (g.includes("paypal")) return "paypal";
  if (g.includes("klarna")) return "klarna";
  if (g.includes("gift") || g.includes("gutschein") || g.includes("voucher")) return "gutschein";
  if (g.includes("card") || g.includes("credit") || g.includes("kredit") || g.includes("stripe") ||
      g.includes("mollie") || g.includes("adyen") || g.includes("amazon") || g.includes("shopify_payments") ||
      g.includes("sofort") || g.includes("apple") || g.includes("google")) return "kreditkarte";
  // bank / sepa / überweisung / invoice / rechnung / vorkasse -> SEPA
  return "ueberweisung";
}

// Einheitliche Order-Struktur (wie sie die App / Erstattungen erwartet).
export function normalizeOrder({ orderNumber, customerName, totalCents, currency, eventTitle, method }) {
  const num = String(orderNumber ?? "").replace(/^#/, "").trim();
  const eventShort = deriveEventLabel(eventTitle);
  return {
    orderName: num ? `#${num}` : "",
    orderNumber: num,
    customerName: customerName || "",
    totalCents: Number.isFinite(totalCents) ? totalCents : 0,
    currency: currency || "EUR",
    eventTitle: eventTitle || "",
    eventShort,
    method: method || "ueberweisung",
    suggestedPurpose: `Erstattung ${num} ${eventShort}`.trim(),
  };
}
