// Lizenz-/Tarifmodell für iou.fm. Drei Tarife, 7 Tage kostenloser Test.
// Die echten Stripe-Preis-IDs kommen aus ENV (du legst die Produkte in Stripe an).
//
// Sanfter Rollout: Erst wenn BILLING_ENFORCE=1 gesetzt ist, sperrt die App nach
// Ablauf wirklich. Bis dahin nur Hinweis – so sperrst du dich beim Testen nicht aus.

export const TRIAL_DAYS = 7;

// Sitzplätze (Mitarbeiter-Logins): jede Lizenz enthält 5; weitere in 3er-Paketen (je 19,99 € netto).
export const BASE_SEATS = 5;
export const SEAT_PACK = 3;
export const SEAT_PACK_PRICE = "19,99 €";
export function seatPriceId() { return process.env.STRIPE_PRICE_SEATS || ""; }

// Sitzplätze aus den Subscription-Items berechnen (Basis 5 + Pakete * 5).
export function seatsFromSubscription(sub) {
  const items = sub?.items?.data || [];
  const seatId = seatPriceId();
  let packs = 0;
  for (const it of items) if (seatId && it?.price?.id === seatId) packs += Number(it.quantity || 0);
  return BASE_SEATS + packs * SEAT_PACK;
}

export const PLANS = {
  basis: {
    key: "basis", label: "Basis", price: "39,99 €", period: "/ Monat", priceEnv: "STRIPE_PRICE_BASIS",
    features: [
      "SEPA-Sammelüberweisungen (pain.001)",
      "Erstattungen & Stornos",
      "Shop-Anbindung (Shopify, WooCommerce, Shopware)",
      "DATEV-/CSV-Export + Archiv",
    ],
  },
  pro: {
    key: "pro", label: "Pro", price: "79,99 €", period: "/ Monat", priceEnv: "STRIPE_PRICE_PRO", popular: true,
    features: [
      "Alles aus Basis",
      "Lohnläufe (DATEV-PDF-Import)",
      "Rechnungen & E-Rechnungen (ZUGFeRD/XRechnung)",
      "Mehrere Benutzer + Buchhalter-Monatsversand",
    ],
  },
  bank: {
    key: "bank", label: "Bank", price: "99,99 €", period: "/ Monat", priceEnv: "STRIPE_PRICE_BANK",
    features: [
      "Alles aus Pro",
      "EBICS-Direktversand an die Bank",
      "Freigabe über die App deiner Bank",
      "Vier-Augen-Freigabe",
    ],
  },
};

export const PLAN_ORDER = ["basis", "pro", "bank"];

export function planExists(plan) { return Object.prototype.hasOwnProperty.call(PLANS, plan); }
export function priceIdForPlan(plan) { return process.env[PLANS[plan]?.priceEnv] || ""; }

// Stripe-Preis-ID -> Tarif-Key (für Webhook-Events).
export function planForPriceId(priceId) {
  for (const k of PLAN_ORDER) if (priceIdForPlan(k) && priceIdForPlan(k) === priceId) return k;
  return null;
}

export function billingEnforced() { return process.env.BILLING_ENFORCE === "1"; }

// Sonderstatus: der Anbieter (Owner) und seine eigenen Mandanten (z. B. Tix & Travel)
// zahlen nie. Freigeschaltet wird einmalig per Owner-ID (Secret) – siehe claim-owner-Route.
// Danach trägt der Mandant das Flag t.billingExempt. Zusätzlich optional über ENV:
//   EXEMPT_TENANTS = kommagetrennte Tenant-IDs
export function isExemptTenant(t) {
  if (!t) return false;
  if (t.billingExempt) return true;
  const list = (process.env.EXEMPT_TENANTS || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (list.includes(t.tenantId)) return true;
  return false;
}

// Welche Funktion ist im Tarif enthalten? (für Feature-Gating in der App)
export function planAllows(plan, feature) {
  const rank = { basis: 1, pro: 2, bank: 3 }[plan] || 0;
  if (feature === "ebics") return rank >= 3;          // nur Bank-Tarif
  if (feature === "lohn" || feature === "rechnungen") return rank >= 2; // ab Pro
  return rank >= 1;
}

// Lizenz-Sicht für einen Mandanten berechnen.
export function licenseView(t) {
  const lic = t.license || {};
  const now = Date.now();
  const trialEndsAt = t.trialEndsAt ? Date.parse(t.trialEndsAt) : null;
  const exempt = isExemptTenant(t); // Anbieter/Owner & eigene Mandanten zahlen nie

  let status = lic.status || (trialEndsAt ? "trialing" : "none");
  let active = false;

  if (exempt) { status = "exempt"; active = true; }
  else if (lic.status === "active") active = true;
  else if (lic.status === "past_due") active = true;           // Kulanz im Zahlungsverzug
  else if ((lic.status || "trialing") === "trialing" && trialEndsAt && now < trialEndsAt) active = true;

  const trialDaysLeft = trialEndsAt ? Math.max(0, Math.ceil((trialEndsAt - now) / 86400000)) : 0;

  return {
    plan: lic.plan || null,
    status,
    active,
    enforce: billingEnforced(),
    trialEndsAt: t.trialEndsAt || null,
    trialDaysLeft,
    currentPeriodEnd: lic.currentPeriodEnd || null,
    hasCustomer: !!t.stripeCustomerId,
    seatsAllowed: lic.seats || BASE_SEATS,
    isOwnerTenant: !!t.isOwnerTenant, // Vendor-Owner-Konto (per OWNER_ID freigeschaltet)
  };
}

// Webhook-Event auf den Mandanten anwenden (mutiert t.license / Stripe-IDs).
export function applyStripeEvent(t, event) {
  const type = event?.type || "";
  const obj = event?.data?.object || {};
  t.license = t.license || {};

  if (type === "checkout.session.completed") {
    if (obj.customer) t.stripeCustomerId = obj.customer;
    if (obj.subscription) t.stripeSubscriptionId = obj.subscription;
    const plan = obj.metadata?.plan || t.license.plan || null;
    t.license.plan = plan;
    t.license.status = "active";
    return true;
  }
  if (type === "customer.subscription.created" || type === "customer.subscription.updated") {
    t.stripeSubscriptionId = obj.id || t.stripeSubscriptionId;
    if (obj.customer) t.stripeCustomerId = obj.customer;
    // Tarif aus dem Plan-Item ableiten (Seat-Item ignorieren).
    const items = obj.items?.data || [];
    let plan = obj.metadata?.plan || t.license.plan || null;
    for (const it of items) { const p = planForPriceId(it?.price?.id); if (p) plan = p; }
    t.license.plan = plan;
    t.license.seats = seatsFromSubscription(obj);
    // Stripe-Status direkt übernehmen (active/trialing/past_due/canceled/unpaid/incomplete)
    t.license.status = obj.status || t.license.status;
    if (obj.current_period_end) t.license.currentPeriodEnd = new Date(obj.current_period_end * 1000).toISOString();
    return true;
  }
  if (type === "customer.subscription.deleted") {
    t.license.status = "canceled";
    return true;
  }
  if (type === "invoice.paid") {
    t.license.status = "active";
    return true;
  }
  if (type === "invoice.payment_failed") {
    t.license.status = "past_due";
    return true;
  }
  return false;
}
