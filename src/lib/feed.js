// Shopify-Feed & -Integration gegen den Hub (Nacht-Cron liegt serverseitig).
import { HUB_URL } from "../config.js";

const api = (p) => HUB_URL.replace(/\/+$/, "") + p;
const auth = (s) => ({ Authorization: `Bearer ${s.accessKey}` });

// Shopify-Zugang + Tag-Regeln serverseitig hinterlegen (für den Cron).
export async function saveIntegration(session, { domain, token, tags }) {
  const body = { tags };
  if (domain !== undefined || token) body.shopify = { domain, token }; // leerer Token = behalten
  const r = await fetch(api(`/api/tenants/${session.tenantId}/integration`), {
    method: "PUT", headers: { ...auth(session), "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`Speichern fehlgeschlagen (${r.status}).`);
  return r.json();
}

export async function getIntegration(session) {
  const r = await fetch(api(`/api/tenants/${session.tenantId}/integration`), { headers: auth(session) });
  return r.ok ? r.json() : null;
}

// Vom Cron gesammelte Stornos/Refunds/Anfragen.
export async function getFeed(session) {
  if (!session?.tenantId) return null;
  const r = await fetch(api(`/api/tenants/${session.tenantId}/feed`), { headers: auth(session) });
  return r.ok ? r.json() : null;
}

// Abgleich jetzt anstoßen (Test/manuell).
export async function triggerSync(session) {
  const r = await fetch(api(`/api/tenants/${session.tenantId}/sync`), { method: "POST", headers: auth(session) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.detail || `Sync fehlgeschlagen (${r.status}).`);
  return j;
}
