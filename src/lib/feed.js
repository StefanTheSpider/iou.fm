// Shopify-Feed & -Integration gegen den Hub (Nacht-Cron liegt serverseitig).
import { HUB_URL } from "../config.js";
import { toast } from "./toast.js";

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

// Shopify-OAuth starten: liefert die Authorize-URL, die im Browser geöffnet wird.
export async function shopifyOAuthStart(session, shop) {
  const r = await fetch(api(`/api/tenants/${session.tenantId}/shopify/oauth-start`), {
    method: "POST", headers: { ...auth(session), "Content-Type": "application/json" }, body: JSON.stringify({ shop }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    if (j.error === "oauth_not_configured") throw new Error("Shopify-Verbindung ist serverseitig noch nicht eingerichtet (App-Registrierung fehlt).");
    if (j.error === "bad_shop") throw new Error("Bitte eine gültige Shop-Domain angeben (…myshopify.com).");
    throw new Error(`Verbindung konnte nicht gestartet werden (${r.status}).`);
  }
  return j.url;
}

// Belege per E-Mail: Inbox-Adresse + Weiterleitungs-Konfig + Archiv.
export async function getInbox(session) {
  const r = await fetch(api(`/api/tenants/${session.tenantId}/inbox`), { headers: auth(session) });
  return r.ok ? r.json() : null;
}
export async function saveInbox(session, cfg) {
  const r = await fetch(api(`/api/tenants/${session.tenantId}/inbox`), {
    method: "PUT", headers: { ...auth(session), "Content-Type": "application/json" }, body: JSON.stringify(cfg),
  });
  if (!r.ok) throw new Error(`Speichern fehlgeschlagen (${r.status}).`);
  return r.json();
}
export async function getBelege(session) {
  const r = await fetch(api(`/api/tenants/${session.tenantId}/belege`), { headers: auth(session) });
  return r.ok ? (await r.json()).belege || [] : [];
}
// Bytes einer abgelegten Beleg-Datei (für lokales Einlesen in den Rechnungen-Tab).
export async function fetchBelegFileBytes(session, beId, name) {
  const r = await fetch(api(`/api/tenants/${session.tenantId}/belege/${beId}/file/${encodeURIComponent(name)}`), { headers: auth(session) });
  if (!r.ok) throw new Error(`Datei konnte nicht geladen werden (${r.status}).`);
  return r.arrayBuffer();
}
// Abgelegte Dateien eines Belegs (Original-.eml, gerendertes PDF, Anhänge).
export async function getBelegFiles(session, beId) {
  const r = await fetch(api(`/api/tenants/${session.tenantId}/belege/${beId}/files`), { headers: auth(session) });
  return r.ok ? (await r.json()).files || [] : [];
}
// Eine Beleg-Datei laden und herunterladen. (Das Tauri-Fenster blockiert window.open
// für Blob-URLs, deshalb laden wir die Datei zuverlässig in „Downloads" – dort öffnet
// man PDF/.eml mit dem System-Viewer. Gleiches Muster wie der SEPA-Datei-Download.)
export async function openBelegFile(session, beId, name) {
  const r = await fetch(api(`/api/tenants/${session.tenantId}/belege/${beId}/file/${encodeURIComponent(name)}`), { headers: auth(session) });
  if (!r.ok) throw new Error(`Datei konnte nicht geladen werden (${r.status}).`);
  const blob = await r.blob();
  const objUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objUrl; a.download = name; a.rel = "noopener";
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(objUrl), 60000);
  toast(`„${name.replace(/^[0-9a-f-]{36}_/i, "")}" heruntergeladen · Ordner „Downloads"`);
}

// Rechnungs-PDFs an Steuerberater/DATEV mailen (Belege).
export async function sendInvoiceBelege(session, { to, files, subject, text }) {
  // `to` ist optional: ohne Angabe nutzt der Hub die zentral gepflegten Empfänger (Steuerberater/DATEV).
  const payload = { files, subject, text };
  if (Array.isArray(to) && to.length) payload.to = to;
  const r = await fetch(api(`/api/tenants/${session.tenantId}/invoices/send-belege`), {
    method: "POST", headers: { ...auth(session), "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    if (j.error === "mail_not_configured") throw new Error("E-Mail-Versand ist serverseitig nicht eingerichtet.");
    if (j.error === "no_recipient") throw new Error("Keine Empfänger-E-Mail hinterlegt.");
    if (j.error === "no_files") throw new Error("Keine PDF-Belege vorhanden (bitte vor dem Erstellen die PDFs laden).");
    throw new Error(j.detail || `Versand fehlgeschlagen (${r.status}).`);
  }
  return j;
}

// Rechnungs-PDFs eines SEPA-Laufs dauerhaft im Hub ablegen (für späteres Re-Senden).
export async function uploadRechnungBelege(session, batchId, files) {
  if (!batchId || !Array.isArray(files) || !files.length) return { ok: false, saved: 0 };
  const r = await fetch(api(`/api/tenants/${session.tenantId}/rechnung-belege/${batchId}`), {
    method: "POST", headers: { ...auth(session), "Content-Type": "application/json" }, body: JSON.stringify({ files }),
  });
  return r.ok ? r.json() : { ok: false, saved: 0 };
}
// Abgelegte Rechnungs-Belege eines Batches (erneut) an Steuerberater/DATEV senden.
export async function sendRechnungBelege(session, batchId) {
  const r = await fetch(api(`/api/tenants/${session.tenantId}/rechnung-belege/${batchId}/send`), {
    method: "POST", headers: { ...auth(session), "Content-Type": "application/json" }, body: "{}",
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    if (j.error === "mail_not_configured") throw new Error("E-Mail-Versand ist serverseitig nicht eingerichtet.");
    if (j.error === "no_recipient") throw new Error("Keine Empfänger-E-Mail hinterlegt (Stammdaten → Belege & Buchhaltung).");
    if (j.error === "no_files") throw new Error("Für diesen Lauf sind keine Belege gespeichert (vor diesem Update erstellt?).");
    throw new Error(j.detail || `Versand fehlgeschlagen (${r.status}).`);
  }
  return j;
}

// Vom Cron gesammelte Stornos/Refunds/Anfragen.
export async function getFeed(session) {
  if (!session?.tenantId) return null;
  const r = await fetch(api(`/api/tenants/${session.tenantId}/feed`), { headers: auth(session) });
  return r.ok ? r.json() : null;
}

// Versand-Archiv (ausgeführte Bestellungen) – separat/lazy, da potenziell groß.
export async function getFulfillments(session) {
  if (!session?.tenantId) return { fulfillments: [] };
  const r = await fetch(api(`/api/tenants/${session.tenantId}/fulfillments`), { headers: auth(session) });
  return r.ok ? r.json() : { fulfillments: [] };
}

// Abgleich jetzt anstoßen (Test/manuell).
export async function triggerSync(session) {
  const r = await fetch(api(`/api/tenants/${session.tenantId}/sync`), { method: "POST", headers: auth(session) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.detail || `Sync fehlgeschlagen (${r.status}).`);
  return j;
}

// Buchhalter-Monatsversand (Resend, serverseitig).
export async function getAccountant(session) {
  const r = await fetch(api(`/api/tenants/${session.tenantId}/accountant`), { headers: auth(session) });
  return r.ok ? r.json() : null;
}
export async function saveAccountant(session, { email, cc, enabled }) {
  const r = await fetch(api(`/api/tenants/${session.tenantId}/accountant`), {
    method: "PUT", headers: { ...auth(session), "Content-Type": "application/json" },
    body: JSON.stringify({ email, cc, enabled }),
  });
  if (!r.ok) throw new Error(`Speichern fehlgeschlagen (${r.status}).`);
  return r.json();
}
// In iou.fm getätigte Erstattungen (Zusammenfassung ohne IBAN) für den Buchhalter-Export.
export async function pushAppRefunds(session, refunds) {
  if (!session?.tenantId || !refunds?.length) return;
  try {
    await fetch(api(`/api/tenants/${session.tenantId}/app-refunds`), {
      method: "POST", headers: { ...auth(session), "Content-Type": "application/json" },
      body: JSON.stringify({ refunds }),
    });
  } catch { /* offline egal – läuft beim nächsten Mal */ }
}

export async function sendAccountantNow(session, month) {
  const r = await fetch(api(`/api/tenants/${session.tenantId}/accountant/send-now`), {
    method: "POST", headers: { ...auth(session), "Content-Type": "application/json" },
    body: JSON.stringify(month ? { month } : {}),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.detail || j.error || `Versand fehlgeschlagen (${r.status}).`);
  return j;
}
