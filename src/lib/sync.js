// Sync-Transport gegen den Hub. Authentifizierung steckt in der Session
// (tenantId + accessKey aus dem Login). Es wird nur sharedSubset übertragen –
// Ende-zu-Ende verschlüsselt; Löhne bleiben lokal.
import { HUB_URL } from "../config.js";
import { sharedSubset, mergeShared, syncEncrypt, syncDecryptRaw, getRev, setRev } from "./vault.js";

const api = (p) => HUB_URL.replace(/\/+$/, "") + p;

async function getDoc(session) {
  const r = await fetch(api(`/api/tenants/${session.tenantId}/doc`), {
    headers: { Authorization: `Bearer ${session.accessKey}` },
  });
  if (!r.ok) throw new Error(`Laden fehlgeschlagen (${r.status}).`);
  return r.json();
}
function putDoc(session, payload, baseRev) {
  return fetch(api(`/api/tenants/${session.tenantId}/doc`), {
    method: "PUT",
    headers: { Authorization: `Bearer ${session.accessKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ baseRev, payload, company: session.company || "" }),
  });
}

// Server -> lokal: geteilten Stand holen und (Löhne erhaltend) einmischen.
export async function pull(session) {
  if (!session?.tenantId) return null;
  const doc = await getDoc(session);
  let data = session.data;
  if (doc.payload) {
    const shared = await syncDecryptRaw(session, doc.payload);
    data = mergeShared(session.data, shared);
  }
  setRev(session.tenantId, doc.rev);
  return { data, rev: doc.rev, company: doc.company };
}

// Lokal -> Server: nur sharedSubset, mit Konflikt-Merge.
export async function push(session) {
  if (!session?.tenantId) return null;
  const payload = await syncEncrypt(session, sharedSubset(session.data));
  let r = await putDoc(session, payload, getRev(session.tenantId));
  if (r.status === 409) {
    const remote = await r.json();
    let data = session.data;
    if (remote.payload) data = mergeShared(session.data, await syncDecryptRaw(session, remote.payload));
    setRev(session.tenantId, remote.rev);
    const merged = await syncEncrypt({ ...session, data }, sharedSubset(data));
    r = await putDoc(session, merged, remote.rev);
    if (!r.ok) throw new Error("Sync-Konflikt – bitte erneut speichern.");
    const b = await r.json();
    setRev(session.tenantId, b.rev);
    return { data, rev: b.rev };
  }
  if (!r.ok) throw new Error(`Sync fehlgeschlagen (${r.status}).`);
  const b = await r.json();
  setRev(session.tenantId, b.rev);
  return { data: session.data, rev: b.rev };
}
