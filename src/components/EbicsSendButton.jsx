import { useState } from "react";
import { createEbicsClient, ebicsReadyToSend } from "../lib/ebics/index.js";

// Natives HTTP (Tauri) bevorzugen, damit kein CORS-Problem entsteht.
async function httpPost(url, body, headers = {}) {
  let doFetch = fetch;
  if (typeof window !== "undefined" && window.__TAURI_INTERNALS__) {
    try { const mod = await import("@tauri-apps/plugin-http"); if (mod?.fetch) doFetch = mod.fetch; } catch { /* Browser-fetch */ }
  }
  const res = await doFetch(url, { method: "POST", headers: { "Content-Type": "text/xml", ...headers }, body });
  return { status: res.status, text: await res.text() };
}

// Sendet den fertigen pain.001 direkt per EBICS an die Bank. Wird nur angezeigt, wenn die
// Bankanbindung aktiviert UND von der Bank freigeschaltet ist. Andernfalls bleibt der
// gewohnte Datei-Download der einzige Weg.
export default function EbicsSendButton({ data, xml, meta = {}, style }) {
  const cfg = data?.config?.ebics || {};
  const keys = data?.ebicsKeys || null;
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  if (!ebicsReadyToSend(cfg, keys)) return null;

  async function send() {
    setErr(""); setMsg(""); setBusy(true);
    try {
      const client = createEbicsClient({ cfg, keys, httpPost });
      const r = await client.uploadPayment(xml, meta);
      setMsg(`An die Bank übergeben (Auftrag ${r?.orderId || "—"}). Bitte in der photoTAN-App freigeben.`);
    } catch (e) {
      setErr(e.message || "EBICS-Versand fehlgeschlagen.");
    } finally { setBusy(false); }
  }

  return (
    <span style={{ display: "inline-flex", flexDirection: "column", gap: 4, ...style }}>
      <button className="btn" disabled={busy || !xml} onClick={send} title="SEPA-Auftrag direkt an die Bank übergeben">
        {busy ? "Wird gesendet…" : "Per EBICS an Bank senden"}
      </button>
      {err && <span className="error-text" style={{ margin: 0 }}>{err}</span>}
      {msg && <span className="note" style={{ margin: 0, color: "var(--ok, #3ddc97)" }}>{msg}</span>}
    </span>
  );
}
