// Shopify-OAuth: „Mit Shopify verbinden" statt manuellem Token-Einfügen.
//
// Ablauf:
//   1. App ruft (authentifiziert) POST /api/tenants/:id/shopify/oauth-start { shop }
//      -> Hub liefert die Shopify-Authorize-URL mit signiertem `state` (HMAC).
//   2. App öffnet die URL im Browser, der Händler bestätigt bei Shopify.
//   3. Shopify leitet zurück auf GET /api/shopify/oauth/callback (öffentlich).
//      Hub prüft state + Shopify-HMAC, tauscht code -> access_token und legt den
//      Token verschlüsselt beim Mandanten ab (wie bei der manuellen Variante).
//
// Einmalig nötig (durch den Owner): eine Shopify-App registrieren (Partners),
// API-Key + Secret als ENV setzen, und die Redirect-URL whitelisten.
//   ENV: SHOPIFY_API_KEY, SHOPIFY_API_SECRET, SHOPIFY_SCOPES (optional),
//        PUBLIC_URL (öffentliche Hub-URL, z. B. https://ioufm-production.up.railway.app)
import crypto from "node:crypto";

const API_KEY = process.env.SHOPIFY_API_KEY || "";
const API_SECRET = process.env.SHOPIFY_API_SECRET || "";
const SCOPES = process.env.SHOPIFY_SCOPES || "read_orders,read_customers";
const PUBLIC_URL = (process.env.PUBLIC_URL || "https://ioufm-production.up.railway.app").replace(/\/+$/, "");
const STATE_SECRET = process.env.HUB_SECRET || "dev-state-secret";
const STATE_TTL_MS = 10 * 60 * 1000; // 10 Minuten

export function oauthConfigured() {
  return Boolean(API_KEY && API_SECRET);
}

export function redirectUri() {
  return `${PUBLIC_URL}/api/shopify/oauth/callback`;
}

// Shop-Domain normalisieren/prüfen: nur *.myshopify.com erlaubt.
export function normalizeShop(input) {
  let s = String(input || "").trim().toLowerCase();
  s = s.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (/^[a-z0-9][a-z0-9-]*$/.test(s)) s = `${s}.myshopify.com`; // nur Name angegeben
  return /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(s) ? s : null;
}

const b64url = (buf) => Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = (s) => Buffer.from(String(s).replace(/-/g, "+").replace(/_/g, "/"), "base64");

function signState(payload) {
  const data = b64url(JSON.stringify(payload));
  const mac = b64url(crypto.createHmac("sha256", STATE_SECRET).update(data).digest());
  return `${data}.${mac}`;
}

export function verifyState(state) {
  const [data, mac] = String(state || "").split(".");
  if (!data || !mac) return null;
  const expect = b64url(crypto.createHmac("sha256", STATE_SECRET).update(data).digest());
  const a = Buffer.from(mac), b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let payload;
  try { payload = JSON.parse(fromB64url(data).toString("utf8")); } catch { return null; }
  if (!payload || typeof payload.ts !== "number" || Date.now() - payload.ts > STATE_TTL_MS) return null;
  return payload; // { t: tenantId, shop, ts }
}

// Authorize-URL für die App bauen.
export function buildAuthUrl({ shop, tenantId }) {
  const state = signState({ t: tenantId, shop, ts: Date.now() });
  const p = new URLSearchParams({
    client_id: API_KEY,
    scope: SCOPES,
    redirect_uri: redirectUri(),
    state,
    "grant_options[]": "value", // Online-Token nicht erzwingen -> Offline (dauerhaft)
  });
  // Offline-Token (dauerhaft) ist der Standard ohne per-user grant; wir lassen grant_options leer-äquivalent.
  p.delete("grant_options[]");
  return `https://${shop}/admin/oauth/authorize?${p.toString()}`;
}

// Shopify-HMAC der Callback-Query prüfen (Signatur über die sortierte Query ohne hmac).
export function verifyShopifyHmac(query) {
  const hmac = query.hmac;
  if (!hmac) return false;
  const msg = Object.keys(query)
    .filter((k) => k !== "hmac" && k !== "signature")
    .sort()
    .map((k) => `${k}=${query[k]}`)
    .join("&");
  const digest = crypto.createHmac("sha256", API_SECRET).update(msg).digest("hex");
  const a = Buffer.from(digest), b = Buffer.from(String(hmac));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// code -> access_token tauschen.
export async function exchangeToken({ shop, code }) {
  const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ client_id: API_KEY, client_secret: API_SECRET, code }),
  });
  if (!res.ok) throw new Error(`token_exchange_failed_${res.status}`);
  const j = await res.json();
  if (!j.access_token) throw new Error("no_access_token");
  return j.access_token;
}
