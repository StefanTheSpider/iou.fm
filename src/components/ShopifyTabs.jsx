import { useState } from "react";
import * as XLSX from "xlsx";
import { formatEur } from "../lib/money.js";

const deDate = (iso) => (iso ? new Date(iso).toLocaleDateString("de-DE") : "—");
const gw = (g) => ({ paypal: "PayPal", klarna: "Klarna", "shopify_payments": "Kreditkarte", bank: "Überweisung" }[g] || (g || "—"));

// ---- Tab: offene Rückerstattungs-Anfragen (für Mitarbeiter) ----------------
export function Anfragen({ feed, onRefresh, busy }) {
  const [status, setStatus] = useState("offen");
  const reqs = (feed?.requests || []).filter((r) => status === "alle" || r.status === status);
  return (
    <div>
      <h1>Rückerstattungs-Anfragen</h1>
      <p className="sub">Von Kunden angefragte Rückerstattungen (per Tag aus Shopify), z. B. PayPal/Klarna – mit Status. Wird nächtlich abgeglichen.</p>
      <div className="toolbar">
        <label className="muted" style={{ display: "flex", gap: 6, alignItems: "center" }}>Status
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="offen">offen</option>
            <option value="erstattet">erstattet</option>
            <option value="storniert">storniert</option>
            <option value="alle">alle</option>
          </select>
        </label>
        <span className="muted">{reqs.length} Anfragen</span>
        <div className="spacer" />
        {onRefresh && <button className="btn ghost small" onClick={onRefresh} disabled={busy}>{busy ? "Lädt…" : "Aktualisieren"}</button>}
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Bestellnr.</th><th>Kunde</th><th>Veranstaltung</th><th>Zahlart</th><th>Kategorie</th><th className="amount">Betrag</th><th>Status</th></tr></thead>
          <tbody>
            {reqs.map((r) => (
              <tr key={r.orderNumber}>
                <td className="mono">{r.orderNumber}</td><td>{r.customer}</td><td>{r.event}</td>
                <td>{gw(r.gateway)}</td><td>{r.category}</td>
                <td className="amount">{formatEur(r.amountCents)}</td>
                <td><span className={`pill ${r.status === "offen" ? "warn" : "ok"}`}>{r.status}</span></td>
              </tr>
            ))}
            {reqs.length === 0 && <tr><td colSpan={7} className="muted" style={{ textAlign: "center", padding: 24 }}>Keine Anfragen in dieser Ansicht.</td></tr>}
          </tbody>
        </table>
      </div>
      {feed?.syncedAt && <p className="note">Letzter Shopify-Abgleich: {new Date(feed.syncedAt).toLocaleString("de-DE")}</p>}
    </div>
  );
}

// ---- Tab: Stornos & Erstattungen (Shopify) + Buchhaltungs-Export -----------
const CATS = ["Sport DE", "Konzerte DE", "Österreich", "Reisen", "Unzugeordnet"];

export function Stornos({ feed, canPay, onRefresh, busy }) {
  const [art, setArt] = useState("alle");
  const [cat, setCat] = useState("alle");
  const cancellations = (feed?.cancellations || []).map((c) => ({ ...c, art: "Stornierung" }));
  const refunds = (feed?.refunds || []).map((r) => ({ ...r, art: "Erstattung" }));
  const all = [...cancellations, ...refunds]
    .filter((r) => (art === "alle" || r.art === art) && (cat === "alle" || r.category === cat))
    .sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  const sum = all.reduce((s, r) => s + (r.amountCents || 0), 0);

  function exportIrina() {
    const rows = [...cancellations, ...refunds];
    const wb = XLSX.utils.book_new();
    for (const c of CATS) {
      const data = rows.filter((r) => r.category === c).sort((a, b) => (a.date || "").localeCompare(b.date || ""))
        .map((r) => ({
          Art: r.art,
          Veranstaltung: r.event,
          Datum: deDate(r.date),
          Kunde: r.customer,
          Bestellnummer: r.orderNumber,
          "Betrag (EUR)": (r.amountCents / 100).toFixed(2).replace(".", ","),
        }));
      if (!data.length && c === "Unzugeordnet") continue;
      const ws = XLSX.utils.json_to_sheet(data.length ? data : [{ Hinweis: "keine Einträge im Zeitraum" }]);
      XLSX.utils.book_append_sheet(wb, ws, c.slice(0, 31));
    }
    XLSX.writeFile(wb, `Stornos_Erstattungen_${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  return (
    <div>
      <h1>Stornos &amp; Erstattungen</h1>
      <p className="sub">Aus Shopify abgeglichene Stornierungen und Rückerstattungen (mit echtem Datum/Betrag), kategorisiert für die Buchhaltung.</p>
      <div className="summary-bar">
        <div className="stat"><div className="num">{all.length}</div><div className="lbl">Einträge</div></div>
        <div className="stat"><div className="num">{formatEur(sum)}</div><div className="lbl">Summe</div></div>
        <div className="spacer" style={{ flex: 1 }} />
        {canPay && <button className="btn" onClick={exportIrina} disabled={!cancellations.length && !refunds.length}>Excel für Buchhaltung (3 Blätter)</button>}
      </div>
      <div className="toolbar">
        <label className="muted" style={{ display: "flex", gap: 6, alignItems: "center" }}>Art
          <select value={art} onChange={(e) => setArt(e.target.value)}>
            <option value="alle">alle</option><option value="Stornierung">Stornierungen</option><option value="Erstattung">Erstattungen</option>
          </select>
        </label>
        <label className="muted" style={{ display: "flex", gap: 6, alignItems: "center" }}>Kategorie
          <select value={cat} onChange={(e) => setCat(e.target.value)}>
            <option value="alle">alle</option>{CATS.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <span className="muted">{all.length} Einträge</span>
        <div className="spacer" />
        {onRefresh && <button className="btn ghost small" onClick={onRefresh} disabled={busy}>{busy ? "Lädt…" : "Aktualisieren"}</button>}
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Datum</th><th>Art</th><th>Veranstaltung</th><th>Kunde</th><th>Bestellnr.</th><th>Kategorie</th><th className="amount">Betrag</th></tr></thead>
          <tbody>
            {all.map((r, i) => (
              <tr key={r.orderNumber + "-" + r.art + "-" + i}>
                <td>{deDate(r.date)}</td>
                <td><span className={`pill ${r.art === "Stornierung" ? "warn" : "ok"}`}>{r.art}</span></td>
                <td>{r.event}</td><td>{r.customer}</td><td className="mono">{r.orderNumber}</td><td>{r.category}</td>
                <td className="amount">{formatEur(r.amountCents)}</td>
              </tr>
            ))}
            {all.length === 0 && <tr><td colSpan={7} className="muted" style={{ textAlign: "center", padding: 24 }}>Noch kein Abgleich – unter Stammdaten Shopify + Tags hinterlegen und „Jetzt abgleichen".</td></tr>}
          </tbody>
        </table>
      </div>
      {feed?.syncedAt && <p className="note">Letzter Shopify-Abgleich: {new Date(feed.syncedAt).toLocaleString("de-DE")}</p>}
    </div>
  );
}
