// Support-Zugang (Vendor <-> Kunde), E2E-konform.
// Kunde gibt seinen Mandanten-Schlüssel (DEK) NUR verschlüsselt für den Support-
// Public-Key und nur befristet frei. Der Hub sieht die Daten nie im Klartext.
import { HUB_URL } from "../config.js";
import { syncDecryptRaw } from "./vault.js";

const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const RSA = { name: "RSA-OAEP", hash: "SHA-256" };
const VENDOR_PRIV = "ioufm_support_privkey_v1"; // nur auf dem Vendor-Gerät

async function hub(path, { method = "GET", key, body } = {}) {
  return fetch(HUB_URL + path, {
    method,
    headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(key ? { Authorization: `Bearer ${key}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
}

export async function getSupportPubKey() {
  const r = await hub("/api/support/pubkey");
  if (!r.ok) return null;
  return (await r.json()).pubKeyJwk;
}

// ----- Vendor: Schlüsselpaar (RSA-OAEP) -------------------------------------
export async function ensureVendorKeys(supportKey) {
  let priv = null;
  try { priv = JSON.parse(localStorage.getItem(VENDOR_PRIV)); } catch {}
  if (priv) return false; // bereits vorhanden
  const kp = await crypto.subtle.generateKey(
    { name: "RSA-OAEP", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true, ["encrypt", "decrypt"]);
  const pubJwk = await crypto.subtle.exportKey("jwk", kp.publicKey);
  const privJwk = await crypto.subtle.exportKey("jwk", kp.privateKey);
  localStorage.setItem(VENDOR_PRIV, JSON.stringify(privJwk));
  const r = await hub("/api/support/pubkey", { method: "PUT", key: supportKey, body: { pubKeyJwk: pubJwk } });
  if (!r.ok) { localStorage.removeItem(VENDOR_PRIV); throw new Error("Public-Key-Upload fehlgeschlagen (SUPPORT_KEY?)."); }
  return true; // neu erstellt
}
export const hasVendorKeys = () => !!localStorage.getItem(VENDOR_PRIV);
async function vendorPrivKey() {
  const jwk = JSON.parse(localStorage.getItem(VENDOR_PRIV) || "null");
  if (!jwk) throw new Error("Kein Support-Schlüssel auf diesem Gerät.");
  return crypto.subtle.importKey("jwk", jwk, RSA, false, ["decrypt"]);
}

// ----- Vendor: Anfrage stellen / Grants laden / Konto öffnen ----------------
export async function vendorRequest(supportKey, tenantId, { scope = "full", expiresAt = null, note = "" } = {}) {
  const r = await hub("/api/support/request", { method: "POST", key: supportKey, body: { tenantId, scope, expiresAt, note } });
  if (!r.ok) throw new Error("Anfrage fehlgeschlagen (" + r.status + ").");
  return (await r.json()).requestId;
}
export async function vendorGrants(supportKey) {
  const r = await hub("/api/support/grants", { key: supportKey });
  if (!r.ok) throw new Error("Grants laden fehlgeschlagen (" + r.status + ").");
  return (await r.json()).grants || [];
}

// Öffnet einen freigegebenen Mandanten als befristete Support-Sitzung.
export async function openGrant(grant) {
  const priv = await vendorPrivKey();
  const rawDek = await crypto.subtle.decrypt(RSA, priv, unb64(grant.wrappedDek));
  const dek = await crypto.subtle.importKey("raw", rawDek, { name: "AES-GCM" }, true, ["encrypt", "decrypt"]);
  const probe = { dek, tenantId: grant.tenantId, accessKey: grant.accessKey };
  let data = {}, company = grant.company || "";
  const r = await hub(`/api/tenants/${grant.tenantId}/doc`, { key: grant.accessKey });
  if (r.ok) {
    const doc = await r.json();
    company = doc.company || company;
    if (doc.payload) { try { data = await syncDecryptRaw(probe, doc.payload); } catch { data = {}; } }
  }
  return {
    dek, tenantId: grant.tenantId, accessKey: grant.accessKey, authHash: "", company,
    currentUser: { username: "Support", role: "admin", owner: false, support: true },
    users: [], data,
    supportGrant: { grantId: grant.grantId, scope: grant.scope, expiresAt: grant.expiresAt, tenantId: grant.tenantId, company },
  };
}

// ----- Kunde: offene Anfragen sehen / freigeben / widerrufen ----------------
export async function customerStatus(session) {
  const r = await hub(`/api/tenants/${session.tenantId}/support-requests`, { key: session.accessKey });
  if (!r.ok) return { requests: [], grants: [] };
  return await r.json();
}
export async function customerApprove(session, requestId, expiresAt) {
  const pubJwk = await getSupportPubKey();
  if (!pubJwk) throw new Error("Kein Support-Schlüssel hinterlegt.");
  const pub = await crypto.subtle.importKey("jwk", pubJwk, RSA, false, ["encrypt"]);
  const rawDek = await crypto.subtle.exportKey("raw", session.dek);
  const wrapped = await crypto.subtle.encrypt(RSA, pub, rawDek);
  const r = await hub(`/api/tenants/${session.tenantId}/support-grant`, {
    method: "POST", key: session.accessKey, body: { requestId, wrappedDek: b64(wrapped), expiresAt },
  });
  if (!r.ok) throw new Error("Freigabe fehlgeschlagen (" + r.status + ").");
}
export async function customerRevoke(session, grantId = null) {
  await hub(`/api/tenants/${session.tenantId}/support-revoke`, {
    method: "POST", key: session.accessKey, body: { grantId },
  });
}
