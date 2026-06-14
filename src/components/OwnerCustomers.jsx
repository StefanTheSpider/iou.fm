import { useState, useEffect } from "react";

// Owner-only: Liste aller zahlenden iou.fm-Kunden (aus Stripe). Nur sichtbar im
// per OWNER_ID freigeschalteten Owner-Konto. Zeigt Firma, E-Mail, Tarif, Status, MRR.
const STATUS = {
  active: "Aktiv", trialing: "Testphase", past_due: "Zahlung offen",
  unpaid: "Unbezahlt", canceled: "Gekündigt", incomplete: "Unvollständig",
  incomplete_expired: "Abgelaufen", paused: "Pausiert",
};

export default function OwnerCustomers({ billing }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    setErr(""); setBusy(true);
    try { setData(await billing.customers()); } catch (e) { setErr(e.message || "Fehler."); } finally { setBusy(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const nf = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });
  const list = data?.customers || [];

  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>Meine Kunden <span className="muted" style={{ fontSize: 12, fontWeight: 400 }}>· Owner</span></h2>
      <p className="note">Alle zahlenden iou.fm-Kunden (live aus Stripe). Nur in deinem Owner-Konto sichtbar.</p>

      <div className="toolbar" style={{ marginBottom: 10 }}>
        <span className="note">{data ? `${data.count} Kunde(n) · MRR ${nf.format(data.mrr || 0)}` : (busy ? "Lädt …" : "—")}</span>
        <div className="spacer" />
        <button className="btn ghost" disabled={busy} onClick={load}>{busy ? "Lädt …" : "Aktualisieren"}</button>
      </div>

      {err && <p className="error-text">{err}</p>}

      {list.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Firma</th><th>E-Mail</th><th>Tarif</th><th>Status</th><th>€/Monat</th><th>Kunde seit</th></tr></thead>
            <tbody>
              {list.map((c, i) => (
                <tr key={i}>
                  <td>{c.company || "—"}</td>
                  <td>{c.email || "—"}</td>
                  <td>{c.plan}</td>
                  <td>{(STATUS[c.status] || c.status)}{c.cancelAtPeriodEnd ? " (endet)" : ""}</td>
                  <td>{nf.format(c.monthly || 0)}</td>
                  <td>{c.since ? new Date(c.since).toLocaleDateString("de-DE") : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data && list.length === 0 && <p className="note" style={{ marginTop: 8 }}>Noch keine zahlenden Kunden in Stripe.</p>}
    </div>
  );
}
