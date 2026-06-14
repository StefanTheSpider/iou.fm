// Lizenz/Abo gegen den Hub (Stripe SEPA-Abo). Zahlungsdaten gibt der Kunde nur bei
// Stripe ein – die App öffnet nur die gehostete Bezahlseite.
import { HUB_URL } from "../config.js";

const api = (p) => HUB_URL.replace(/\/+$/, "") + p;
const auth = (s) => ({ Authorization: `Bearer ${s.accessKey}` });

// Anzeige-Infos der Tarife (müssen zu billing.mjs im Hub passen). Alle Preise NETTO (B2B).
export const PRICE_NOTE = "Alle Preise netto, zzgl. USt.";
export const PLAN_INFO = [
  { key: "basis", label: "Basis", price: "39,99 €", period: "/ Monat", features: [
    "SEPA-Sammelüberweisungen (pain.001)",
    "Erstattungen & Stornos",
    "Shop-Anbindung (Shopify, WooCommerce, Shopware)",
    "DATEV-/CSV-Export + Archiv",
    "2 Mitarbeiter inklusive",
  ] },
  { key: "pro", label: "Pro", price: "79,99 €", period: "/ Monat", popular: true, features: [
    "Alles aus Basis",
    "Lohnläufe (DATEV-PDF-Import)",
    "Rechnungen & E-Rechnungen",
    "3 Mitarbeiter inklusive",
  ] },
  { key: "bank", label: "Bank", price: "99,99 €", period: "/ Monat", features: [
    "Alles aus Pro",
    "EBICS-Direktversand an die Bank",
    "Freigabe über die App deiner Bank",
    "5 Mitarbeiter inklusive",
  ] },
];

// Inklusiv-Plätze gestaffelt nach Tarif (muss zu billing.mjs passen). Weitere in 3er-Paketen.
export const SEAT_INFO = { baseByPlan: { basis: 2, pro: 3, bank: 5 }, baseFallback: 2, pack: 3, packPrice: "19,99 €" };
export function baseSeatsForPlan(plan) { return SEAT_INFO.baseByPlan[plan] ?? SEAT_INFO.baseFallback; }

// Darf dieser Lizenzstatus EBICS nutzen? (nur Bank-Tarif zahlend oder Sonderstatus)
export function licenseAllowsEbics(license) {
  if (!license) return false;
  if (license.status === "exempt") return true;
  return !!(license.active && license.plan === "bank");
}

export async function getLicense(session) {
  if (!session?.tenantId) return null;
  const r = await fetch(api(`/api/tenants/${session.tenantId}/license`), { headers: auth(session) });
  return r.ok ? r.json() : null;
}

async function postBilling(session, sub, payload) {
  const r = await fetch(api(`/api/tenants/${session.tenantId}/billing/${sub}`), {
    method: "POST", headers: { ...auth(session), "Content-Type": "application/json" }, body: JSON.stringify(payload || {}),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    if (j.error === "billing_not_configured") throw new Error("Abo-Funktion ist serverseitig noch nicht eingerichtet.");
    if (j.error === "price_missing") throw new Error("Für diesen Tarif ist in Stripe noch kein Preis hinterlegt.");
    if (j.error === "no_subscription") throw new Error("Es ist noch kein Abo vorhanden.");
    if (j.error === "seats_not_configured") throw new Error("Sitzplatz-Paket ist in Stripe noch nicht eingerichtet.");
    throw new Error(j.detail || `Fehler (${r.status}).`);
  }
  return j;
}

export const startCheckout = (session, plan, email) => postBilling(session, "checkout", { plan, email });
export const openPortal = (session) => postBilling(session, "portal", {});
export const setSeatPacks = (session, packs) => postBilling(session, "seats", { packs });

// Owner-Status per Owner-ID (Secret) freischalten – einmalig.
export async function claimOwner(session, ownerId) {
  const r = await fetch(api(`/api/tenants/${session.tenantId}/claim-owner`), {
    method: "POST", headers: { ...auth(session), "Content-Type": "application/json" }, body: JSON.stringify({ ownerId }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    if (j.error === "owner_id_not_set") throw new Error("Auf dem Server ist keine Owner-ID hinterlegt (Railway-Variable OWNER_ID fehlt).");
    if (j.error === "bad_owner_id") throw new Error("Owner-ID stimmt nicht.");
    throw new Error(j.detail || `Fehler (${r.status}).`);
  }
  return j;
}
