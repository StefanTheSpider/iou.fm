// Stripe-Anbindung ohne externes Paket – direkt über die Stripe-REST-API + node:crypto.
// Nur SEPA-Lastschrift-Abos: Checkout (sepa_debit, subscription), Kundenportal, Webhook.
import crypto from "node:crypto";

const SECRET = process.env.STRIPE_SECRET_KEY || "";
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "";
const API = "https://api.stripe.com/v1";

export function stripeConfigured() { return Boolean(SECRET); }

// Objekt -> Stripe-Form-Encoding (verschachtelt: a[b][c]=v, arr[0]=v).
function formEncode(obj, prefix = "", out = []) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) {
      v.forEach((item, i) => {
        if (item !== null && typeof item === "object") formEncode(item, `${key}[${i}]`, out);
        else out.push(`${encodeURIComponent(`${key}[${i}]`)}=${encodeURIComponent(item)}`);
      });
    } else if (typeof v === "object") {
      formEncode(v, key, out);
    } else {
      out.push(`${encodeURIComponent(key)}=${encodeURIComponent(v)}`);
    }
  }
  return out.join("&");
}

async function stripeApi(path, params, method = "POST") {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${SECRET}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: method === "GET" ? undefined : formEncode(params || {}),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error?.message || `Stripe ${res.status}`);
  return json;
}

// Checkout-Session für ein SEPA-Lastschrift-Abo.
// B2B: VOR der Zahlung werden vollständige Firmendaten verpflichtend erfasst
// (Rechnungsadresse + Firmenname + USt-IdNr.), damit der Kunde in Stripe korrekt
// angelegt wird und die Rechnungserstellung sauber funktioniert.
export async function createCheckoutSession({ tenantId, plan, priceId, email, successUrl, cancelUrl }) {
  return stripeApi("/checkout/sessions", {
    mode: "subscription",
    payment_method_types: ["sepa_debit"],
    line_items: [{ price: priceId, quantity: 1 }],
    client_reference_id: tenantId,
    customer_email: email || undefined,
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: { tenantId, plan },
    subscription_data: { metadata: { tenantId, plan } },
    allow_promotion_codes: true,
    // Pflicht-Firmendaten für korrekte Rechnungen:
    billing_address_collection: "required",       // vollständige Rechnungsadresse
    tax_id_collection: { enabled: true },          // USt-IdNr. + Firmenname
    custom_fields: [
      { key: "company", label: { type: "custom", custom: "Firmenname" }, type: "text", optional: false },
    ],
    // Adresse/USt-IdNr. auf dem Kunden speichern (auch bei späterer Wiederverwendung):
    customer_update: { name: "auto", address: "auto" },
  });
}

// Kundenportal (Abo verwalten / kündigen / Zahlungsmittel ändern).
export async function createPortalSession({ customerId, returnUrl }) {
  return stripeApi("/billing_portal/sessions", { customer: customerId, return_url: returnUrl });
}

// Subscription laden (inkl. Items).
export async function getSubscription(subId) {
  return stripeApi(`/subscriptions/${subId}?expand[]=items.data.price`, null, "GET");
}

// Sitzplatz-Pakete einer Subscription setzen (Anzahl 5er-Pakete = packs).
// Legt das Seat-Item an, falls es noch nicht existiert, sonst Mengen-Update.
export async function setSeatPacks({ subId, seatPriceId, packs }) {
  const sub = await getSubscription(subId);
  const items = sub.items?.data || [];
  const existing = items.find((it) => it.price?.id === seatPriceId);
  const update = existing
    ? { items: [{ id: existing.id, quantity: Math.max(0, packs) }], proration_behavior: "create_prorations" }
    : { items: [{ price: seatPriceId, quantity: Math.max(1, packs) }], proration_behavior: "create_prorations" };
  return stripeApi(`/subscriptions/${subId}`, update);
}

// Webhook-Signatur prüfen (Stripe-Signature-Header) und Event-JSON zurückgeben.
export function verifyWebhook(rawBody, sigHeader) {
  if (!WEBHOOK_SECRET) return null;
  const parts = Object.fromEntries(String(sigHeader || "").split(",").map((p) => p.split("=")));
  const t = parts.t, v1 = parts.v1;
  if (!t || !v1) return null;
  const signed = `${t}.${rawBody}`;
  const expected = crypto.createHmac("sha256", WEBHOOK_SECRET).update(signed).digest("hex");
  const a = Buffer.from(v1), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  // Replay-Schutz: max. 5 Minuten alt
  if (Math.abs(Date.now() / 1000 - Number(t)) > 300) return null;
  try { return JSON.parse(rawBody); } catch { return null; }
}
