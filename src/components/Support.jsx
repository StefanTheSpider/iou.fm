import { useState, useEffect } from "react";
import { ensureVendorKeys, hasVendorKeys, vendorRequest, vendorGrants, openGrant,
  customerStatus, customerApprove, customerRevoke } from "../lib/support.js";

const SUPPORT_KEY_LS = "ioufm_support_key";
const deDateTime = (iso) => (iso ? new Date(iso).toLocaleString("de-DE") : "unbefristet");

// ===== Kunde: Freigabe-Dialog ===============================================
// Zeigt offene Support-Anfragen und erlaubt befristete Freigabe (E2E-Schlüssel).
export function SupportApprovalModal({ session, status, onClose, onChanged }) {
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const reqs = status?.requests || [];
  const grants = status?.grants || [];
  if (!reqs.length && !grants.length) return null;

  async function approve(r) {
    setErr(""); setBusy(r.id);
    try { await customerApprove(session, r.id, r.expiresAt); await onChanged(); }
    catch (e) { setErr(e.message || "Fehler."); } finally { setBusy(""); }
  }
  async function revoke(g) {
    setErr(""); setBusy(g.grantId);
    try { await customerRevoke(session, g.grantId); await onChanged(); }
    catch (e) { setErr(e.message || "Fehler."); } finally { setBusy(""); }
  }

  return (
    <div className="modal-overlay">
      <div className="modal-card" style={{ maxWidth: 520 }}>
        <h2 style={{ marginTop: 0 }}>Support-Zugang</h2>
        {reqs.map((r) => (
          <div key={r.id} className="card" style={{ marginBottom: 10 }}>
            <p style={{ margin: "0 0 6px" }}>
              <strong>{session.company || "Der Anbieter"}</strong> bittet um <strong>{r.scope === "read" ? "Lese-Zugang" : "vollen Zugang"}</strong> zu eurem Konto
              {r.expiresAt ? <> bis <strong>{deDateTime(r.expiresAt)}</strong></> : " (unbefristet)"}.
            </p>
            {r.note && <p className="note" style={{ marginTop: 0 }}>„{r.note}"</p>}
            <p className="note">Erst nach deiner Freigabe kann der Support eure Daten sehen. Löhne bleiben immer ausgeschlossen.</p>
            <div className="toolbar" style={{ marginBottom: 0 }}>
              <div className="spacer" />
              <button className="btn ghost" onClick={onClose} disabled={!!busy}>Später</button>
              <button className="btn" onClick={() => approve(r)} disabled={!!busy}>{busy === r.id ? "Gebe frei…" : "Zugang freigeben"}</button>
            </div>
          </div>
        ))}
        {grants.length > 0 && (
          <div className="card" style={{ marginBottom: 0 }}>
            <strong>Aktive Freigaben</strong>
            {grants.map((g) => (
              <div key={g.grantId} className="toolbar" style={{ marginBottom: 0 }}>
                <span className="note">{g.scope === "read" ? "Lesen" : "Voll"} · bis {deDateTime(g.expiresAt)}</span>
                <div className="spacer" />
                <button className="btn ghost small" onClick={() => revoke(g)} disabled={!!busy}>Widerrufen</button>
              </div>
            ))}
          </div>
        )}
        {err && <p className="error-text">{err}</p>}
        {!reqs.length && <div className="toolbar" style={{ marginBottom: 0 }}><div className="spacer" /><button className="btn" onClick={onClose}>Schließen</button></div>}
      </div>
    </div>
  );
}

// ===== Vendor (Owner): Kundenzugang verwalten ===============================
export function VendorSupport({ onOpenSession }) {
  const [supportKey, setSupportKey] = useState(() => localStorage.getItem(SUPPORT_KEY_LS) || "");
  const [keysReady, setKeysReady] = useState(hasVendorKeys());
  const [tenantId, setTenantId] = useState("");
  const [scope, setScope] = useState("full");
  const [days, setDays] = useState(2);
  const [grants, setGrants] = useState([]);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  function saveKey() { localStorage.setItem(SUPPORT_KEY_LS, supportKey.trim()); setMsg("SUPPORT_KEY lokal gespeichert."); }

  async function initKeys() {
    setErr(""); setMsg(""); setBusy("keys");
    try { const made = await ensureVendorKeys(supportKey.trim()); setKeysReady(true); setMsg(made ? "Support-Schlüsselpaar erstellt & Public-Key hochgeladen." : "Schlüssel vorhanden."); }
    catch (e) { setErr(e.message); } finally { setBusy(""); }
  }
  async function request() {
    setErr(""); setMsg(""); setBusy("req");
    try {
      const expiresAt = days > 0 ? new Date(Date.now() + days * 864e5).toISOString() : null;
      await vendorRequest(supportKey.trim(), tenantId.trim(), { scope, expiresAt, note: "Support-Anfrage" });
      setMsg("Anfrage gesendet – der Kunde muss in seiner App freigeben.");
    } catch (e) { setErr(e.message); } finally { setBusy(""); }
  }
  async function loadGrants() {
    setErr(""); setBusy("load");
    try { setGrants(await vendorGrants(supportKey.trim())); }
    catch (e) { setErr(e.message); } finally { setBusy(""); }
  }
  async function open(g) {
    setErr(""); setBusy(g.grantId);
    try { const s = await openGrant(g); onOpenSession(s); }
    catch (e) { setErr(e.message || "Öffnen fehlgeschlagen."); } finally { setBusy(""); }
  }

  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>Kundenzugang (Support)</h2>
      <p className="note">
        E2E-konform: Du forderst Zugang an, der Kunde gibt befristet frei (sein Schlüssel wird nur für deinen Support-Public-Key verschlüsselt).
        Der <strong>SUPPORT_KEY</strong> ist das Vendor-Credential (Railway-Variable) und bleibt nur lokal auf deinem Gerät.
      </p>
      <label className="field"><span>SUPPORT_KEY (Vendor)</span>
        <input type="password" value={supportKey} onChange={(e) => setSupportKey(e.target.value)} placeholder="aus Railway" /></label>
      <div className="toolbar">
        <button className="btn ghost" onClick={saveKey} disabled={!supportKey.trim()}>Lokal speichern</button>
        <button className="btn ghost" onClick={initKeys} disabled={!supportKey.trim() || !!busy}>{busy === "keys" ? "…" : keysReady ? "Schlüssel ok ✓" : "Schlüsselpaar erzeugen"}</button>
      </div>

      <h3 style={{ margin: "16px 0 4px", fontSize: 14 }}>Zugang anfordern</h3>
      <div className="row">
        <label className="field"><span>Mandanten-ID des Kunden</span>
          <input type="text" value={tenantId} onChange={(e) => setTenantId(e.target.value)} placeholder="UUID des Kunden-Mandanten" /></label>
        <label className="field"><span>Umfang</span>
          <select value={scope} onChange={(e) => setScope(e.target.value)}><option value="full">Voll</option><option value="read">Nur lesen</option></select></label>
        <label className="field"><span>Gültig (Tage)</span>
          <input type="number" min={0} max={30} value={days} onChange={(e) => setDays(Number(e.target.value))} /></label>
      </div>
      <div className="toolbar">
        <button className="btn" onClick={request} disabled={!tenantId.trim() || !supportKey.trim() || !!busy}>{busy === "req" ? "Sende…" : "Anfrage senden"}</button>
        <div className="spacer" />
        <button className="btn ghost" onClick={loadGrants} disabled={!supportKey.trim() || !!busy}>{busy === "load" ? "…" : "Freigaben laden"}</button>
      </div>

      {grants.length > 0 && (
        <div className="table-wrap" style={{ marginTop: 10 }}>
          <table>
            <thead><tr><th>Kunde</th><th>Mandant</th><th>Umfang</th><th>Gültig bis</th><th></th></tr></thead>
            <tbody>
              {grants.map((g) => (
                <tr key={g.grantId}>
                  <td>{g.company || "—"}</td><td className="mono">{g.tenantId.slice(0, 8)}…</td>
                  <td>{g.scope === "read" ? "Lesen" : "Voll"}</td><td>{deDateTime(g.expiresAt)}</td>
                  <td><button className="btn small" onClick={() => open(g)} disabled={!!busy}>{busy === g.grantId ? "…" : "Konto öffnen"}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {err && <p className="error-text">{err}</p>}
      {msg && <p className="note" style={{ color: "var(--ok, #3ddc97)" }}>{msg}</p>}
    </div>
  );
}
