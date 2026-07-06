import { useMemo, useState, useEffect, useCallback } from "react";
import { formatEur } from "../lib/money.js";
import { toast } from "../lib/toast.js";

const deDate = (iso) => (iso ? String(iso).slice(0, 10).split("-").reverse().join(".") : "");
const csvCell = (s) => { const v = String(s ?? ""); return /[";\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; };

function downloadCsv(filename, text) {
  const blob = new Blob(["﻿" + text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.rel = "noopener";
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

// Versand-Archiv: ausgeführte (fulfilled) Bestellungen – Kunde, Bestellnr., Betrag,
// Veranstaltung, Veranstaltungsdatum. Wird separat/lazy vom Hub geladen (kann groß sein).
export default function Versand({ load = null }) {
  const [all, setAll] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");

  const refresh = useCallback(async () => {
    if (!load) return;
    setBusy(true); setErr("");
    try { const r = await load(); setAll((r && r.fulfillments) || []); }
    catch (e) { setErr(e.message || "Versand-Archiv konnte nicht geladen werden."); }
    finally { setBusy(false); }
  }, [load]);

  useEffect(() => { refresh(); /* beim Öffnen laden */ // eslint-disable-next-line
  }, []);

  const rows = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return all
      .filter((f) => !ql || `${f.orderNumber || ""} ${f.customer || ""} ${f.event || ""}`.toLowerCase().includes(ql))
      .slice()
      .sort((a, b) => String(b.eventDate || b.orderDate || "").localeCompare(String(a.eventDate || a.orderDate || "")));
  }, [all, q]);

  function exportCsv() {
    const head = ["Kunde", "Bestellnummer", "Betrag (EUR)", "Zahlungsmethode", "Veranstaltung", "Veranstaltungsdatum", "Kategorie", "Bestelldatum"];
    const body = rows.map((f) => [
      f.customer || "", f.orderNumber || "", ((f.amountCents || 0) / 100).toFixed(2).replace(".", ","),
      f.paymentMethod || "", f.event || "", deDate(f.eventDate), f.category || "", deDate(f.orderDate),
    ]);
    const csv = [head, ...body].map((r) => r.map(csvCell).join(";")).join("\r\n");
    downloadCsv(`Versand-Archiv_${new Date().toISOString().slice(0, 10)}.csv`, csv);
    toast(`Versand-Archiv exportiert (${rows.length} Bestellungen · Ordner „Downloads").`);
  }

  return (
    <div>
      <h1>Versand-Archiv</h1>
      <p className="sub">
        Alle in Shopify <strong>ausgeführten</strong> (versendeten) Bestellungen – mit Kunde, Bestellnummer, Betrag,
        Veranstaltung und Veranstaltungsdatum. Wird automatisch beim Abgleich befüllt.
      </p>

      <div className="card">
        <div className="toolbar" style={{ marginTop: 0 }}>
          <button className="btn ghost" onClick={refresh} disabled={busy}>{busy ? "Lädt…" : "Aktualisieren"}</button>
          <button className="btn" onClick={exportCsv} disabled={!rows.length}>Als CSV exportieren</button>
          <div className="spacer" />
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Suche: Bestellnr., Kunde oder Veranstaltung" style={{ minWidth: 260 }} />
          <span className="muted">{rows.length} Bestellungen</span>
        </div>
        {err && <p className="error-text" style={{ margin: "8px 0 0" }}>{err}</p>}
      </div>

      <div className="refunds">
        {rows.map((f) => (
          <div key={f.orderNumber} className="refund-card">
            <div className="refund-head">
              <div className="who-wrap">
                <strong>{f.customer || "—"}</strong>
                <div className="head-meta">
                  <span className="ord-input" style={{ padding: "2px 8px" }}>#{f.orderNumber}</span>
                  {f.event && <span className="pill">{f.event}</span>}
                  {f.eventDate && <span className="pill" title="Veranstaltungsdatum">🗓 {deDate(f.eventDate)}</span>}
                  {f.paymentMethod && <span className="muted" style={{ fontSize: 12 }}>{f.paymentMethod}</span>}
                </div>
              </div>
              <div className="spacer" />
              <div className="amt-wrap">
                <span className="refund-amount ok">{formatEur(f.amountCents)}</span>
                {f.category && <span className="amt-sub">{f.category}</span>}
              </div>
            </div>
          </div>
        ))}
        {!rows.length && (
          <div className="card muted" style={{ textAlign: "center", padding: 28 }}>
            Noch keine ausgeführten Bestellungen im Archiv. Sobald in Shopify Bestellungen als „ausgeführt/versendet" markiert sind, erscheinen sie hier (nach dem nächsten Abgleich).
          </div>
        )}
      </div>
    </div>
  );
}
