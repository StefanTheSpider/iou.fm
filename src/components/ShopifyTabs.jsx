import { useState } from "react";
import * as XLSX from "xlsx";
import { formatEur } from "../lib/money.js";

const deDate = (iso) => (iso ? new Date(iso).toLocaleDateString("de-DE") : "—");
const gw = (g) => ({ paypal: "PayPal", klarna: "Klarna", "shopify_payments": "Kreditkarte", bank: "Überweisung" }[g] || (g || "—"));

// ---- Tab: offene Rückbuchungen / Zahlungsreklamationen (für Mitarbeiter) ----
// Quelle: Shopify-Disputes (chargeback_status needs_response / under_review).
export function Anfragen({ feed, onRefresh, busy }) {
  const [art, setArt] = useState("alle");
  const reqs = (feed?.requests || []).filter((r) => art === "alle" || r.art === art);
  const st = feed?.disputeStats;
  return (
    <div>
      <h1>Offene Rückbuchungen</h1>
      <p className="sub">Zahlungsreklamationen aus Shopify (Anfrage der Bank bzw. echte Rückbuchung) – diesen müsst ihr fristgerecht <strong>widersprechen</strong>. Live-Snapshot, nächtlich aktualisiert. Gelöste Fälle verschwinden automatisch.</p>
      {st && (
        <div className="summary-bar">
          <div className="stat"><div className="num">{st.open ?? reqs.length}</div><div className="lbl">offen</div></div>
          <div className="stat"><div className="num" style={{ color: "var(--ok, #3ddc97)" }}>{st.won}</div><div className="lbl">gewonnen</div></div>
          <div className="stat"><div className="num" style={{ color: "var(--danger, #ff6b6b)" }}>{st.lost}</div><div className="lbl">verloren</div></div>
          <div className="stat"><div className="num">{st.winRate != null ? st.winRate + " %" : "—"}</div><div className="lbl">Gewinnquote</div></div>
          {(st.accepted > 0 || st.chargeRefunded > 0) && (
            <div className="stat"><div className="num">{st.accepted + st.chargeRefunded}</div><div className="lbl">akzeptiert/erstattet</div></div>
          )}
        </div>
      )}
      {st && (st.inquiry || st.chargeback) && (
        <p className="note" style={{ marginTop: -4 }}>
          {st.inquiry && <>Anfragen: {st.inquiry.won} gew. / {st.inquiry.lost} verl.{st.inquiry.winRate != null ? ` (${st.inquiry.winRate} %)` : ""}</>}
          {st.inquiry && st.chargeback ? "  ·  " : ""}
          {st.chargeback && <>Rückbuchungen: {st.chargeback.won} gew. / {st.chargeback.lost} verl.{st.chargeback.winRate != null ? ` (${st.chargeback.winRate} %)` : ""}</>}
        </p>
      )}
      {st?.byYear?.length > 0 && (
        <details style={{ margin: "8px 0 16px" }}>
          <summary style={{ cursor: "pointer", fontWeight: 600 }}>Historie pro Jahr (gesamte Shop-Laufzeit)</summary>
          <div className="table-wrap" style={{ marginTop: 8 }}>
            <table>
              <thead><tr>
                <th>Jahr</th><th className="amount">Fälle</th><th className="amount">gewonnen</th><th className="amount">verloren</th>
                <th className="amount">Quote</th><th className="amount">Anfragen</th><th className="amount">Rückbuchungen</th>
              </tr></thead>
              <tbody>
                {st.byYear.map((y) => (
                  <tr key={y.year}>
                    <td className="mono">{y.year}</td>
                    <td className="amount">{y.decided}</td>
                    <td className="amount" style={{ color: "var(--ok, #3ddc97)" }}>{y.won}</td>
                    <td className="amount" style={{ color: "var(--danger, #ff6b6b)" }}>{y.lost}</td>
                    <td className="amount">{y.winRate != null ? y.winRate + " %" : "—"}</td>
                    <td className="amount">{y.inquiry?.winRate != null ? y.inquiry.winRate + " %" : "—"}</td>
                    <td className="amount">{y.chargeback?.winRate != null ? y.chargeback.winRate + " %" : "—"}</td>
                  </tr>
                ))}
                <tr style={{ fontWeight: 700, borderTop: "2px solid var(--border, #333)" }}>
                  <td>Gesamt</td>
                  <td className="amount">{st.decided}</td>
                  <td className="amount" style={{ color: "var(--ok, #3ddc97)" }}>{st.won}</td>
                  <td className="amount" style={{ color: "var(--danger, #ff6b6b)" }}>{st.lost}</td>
                  <td className="amount">{st.winRate != null ? st.winRate + " %" : "—"}</td>
                  <td className="amount">{st.inquiry?.winRate != null ? st.inquiry.winRate + " %" : "—"}</td>
                  <td className="amount">{st.chargeback?.winRate != null ? st.chargeback.winRate + " %" : "—"}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="note" style={{ marginTop: 4 }}>Jahr = Bestelljahr. Quote = gewonnen / (gewonnen + verloren); akzeptierte/erstattete Fälle zählen nicht in die Quote.</p>
        </details>
      )}
      <div className="toolbar">
        <label className="muted" style={{ display: "flex", gap: 6, alignItems: "center" }}>Art
          <select value={art} onChange={(e) => setArt(e.target.value)}>
            <option value="alle">alle</option>
            <option value="Rückbuchung">nur Rückbuchungen</option>
            <option value="Anfrage">nur Anfragen</option>
          </select>
        </label>
        <span className="muted">{reqs.length} offen</span>
        <div className="spacer" />
        {onRefresh && <button className="btn ghost small" onClick={onRefresh} disabled={busy}>{busy ? "Lädt…" : "Aktualisieren"}</button>}
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Bestellnr.</th><th>Kunde</th><th>Veranstaltung</th><th>Zahlart</th><th>Art</th><th>Status</th><th className="amount">Betrag</th></tr></thead>
          <tbody>
            {reqs.map((r) => (
              <tr key={r.disputeId || r.orderNumber}>
                <td className="mono">{r.orderNumber}</td><td>{r.customer}</td><td>{r.event}</td>
                <td>{gw(r.gateway)}</td>
                <td><span className={`pill ${r.art === "Rückbuchung" ? "warn" : ""}`}>{r.art}</span></td>
                <td><span className="pill warn">{r.phase}</span></td>
                <td className="amount">{formatEur(r.amountCents)}</td>
              </tr>
            ))}
            {reqs.length === 0 && <tr><td colSpan={7} className="muted" style={{ textAlign: "center", padding: 24 }}>Keine offenen Rückbuchungen. (Falls erwartet: unter Stammdaten Shopify hinterlegen und „Jetzt abgleichen".)</td></tr>}
          </tbody>
        </table>
      </div>
      {feed?.syncedAt && <p className="note">Letzter Shopify-Abgleich: {new Date(feed.syncedAt).toLocaleString("de-DE")}</p>}
    </div>
  );
}

// ---- Tab: Stornos & Erstattungen (Shopify) + Buchhaltungs-Export -----------
const CATS = ["Sport DE", "Konzerte DE", "Österreich", "Reisen", "Unzugeordnet"];

const eurCsv = (c) => (Math.round(c || 0) / 100).toFixed(2).replace(".", ",");

// Eine Zeile pro Vorgang, ohne Doppelzählung: Storno+Refund derselben Bestellung
// => "Storniert & erstattet" (nur die Erstattung zählt). + App/SEPA-Erstattungen.
function combinedRows(feed) {
  const cancels = feed?.cancellations || [];
  const refunds = feed?.refunds || [];
  const appR = feed?.appRefunds || [];
  const cancelled = new Set(cancels.map((c) => c.orderNumber));
  const refunded = new Set(refunds.map((r) => r.orderNumber));
  const vz = (verb, n, ev) => `${verb} ${n || ""}${ev ? " " + ev : ""}`.trim();
  return [
    ...refunds.map((r) => ({ art: cancelled.has(r.orderNumber) ? "Storniert & erstattet" : "Erstattung",
      event: r.event, date: r.date, customer: r.customer, orderNumber: r.orderNumber, category: r.category,
      amountCents: r.amountCents, paidCents: r.paidCents ?? r.amountCents, purpose: r.purpose || vz("Erstattung", r.orderNumber, r.event) })),
    ...cancels.filter((c) => !refunded.has(c.orderNumber)).map((c) => ({ art: "Stornierung",
      event: c.event, date: c.date, customer: c.customer, orderNumber: c.orderNumber, category: c.category,
      amountCents: c.amountCents, paidCents: c.amountCents, purpose: vz("Stornierung", c.orderNumber, c.event) })),
    ...appR.map((r) => ({ art: "Erstattung (App/SEPA)", event: r.event, date: r.date, customer: r.customer,
      orderNumber: r.orderNumber, category: r.category || "Unzugeordnet", amountCents: r.amountCents,
      paidCents: r.paidCents ?? r.amountCents, purpose: r.purpose || vz("Erstattung", r.orderNumber, r.event) })),
  ];
}

export function Stornos({ feed, canPay, onRefresh, busy }) {
  const [art, setArt] = useState("alle");
  const [cat, setCat] = useState("alle");
  const combined = combinedRows(feed);
  const all = combined
    .filter((r) => (art === "alle" || r.art === art) && (cat === "alle" || r.category === cat))
    .sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  const sum = all.reduce((s, r) => s + (r.amountCents || 0), 0);

  function exportIrina() {
    const wb = XLSX.utils.book_new();
    for (const c of CATS) {
      const data = combined.filter((r) => r.category === c).sort((a, b) => (a.date || "").localeCompare(b.date || ""))
        .map((r) => ({
          Art: r.art, Veranstaltung: r.event, Datum: deDate(r.date), Kunde: r.customer,
          Bestellnummer: r.orderNumber, Verwendungszweck: r.purpose,
          "Urspr. gezahlt (EUR)": eurCsv(r.paidCents),
          "Erstattet/Storniert (EUR)": eurCsv(r.amountCents),
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
      <p className="sub">Aus Shopify abgeglichene Stornierungen und Rückerstattungen (mit echtem Datum/Betrag), kategorisiert für die Buchhaltung. Storno + Erstattung derselben Bestellung erscheinen als <em>eine</em> Zeile (keine Doppelzählung).</p>
      <div className="summary-bar">
        <div className="stat"><div className="num">{all.length}</div><div className="lbl">Einträge</div></div>
        <div className="stat"><div className="num">{formatEur(sum)}</div><div className="lbl">Summe erstattet/storniert</div></div>
        <div className="spacer" style={{ flex: 1 }} />
        {canPay && <button className="btn" onClick={exportIrina} disabled={!combined.length}>Excel für Buchhaltung</button>}
      </div>
      <div className="toolbar">
        <label className="muted" style={{ display: "flex", gap: 6, alignItems: "center" }}>Art
          <select value={art} onChange={(e) => setArt(e.target.value)}>
            <option value="alle">alle</option>
            <option value="Stornierung">Stornierungen</option>
            <option value="Erstattung">Erstattungen (Shopify)</option>
            <option value="Storniert & erstattet">Storniert &amp; erstattet</option>
            <option value="Erstattung (App/SEPA)">Erstattungen (App/SEPA)</option>
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
          <thead><tr><th>Datum</th><th>Art</th><th>Veranstaltung</th><th>Kunde</th><th>Bestellnr.</th><th>Kategorie</th><th>Verwendungszweck</th><th className="amount">Urspr. gezahlt</th><th className="amount">Erstattet/Storno</th></tr></thead>
          <tbody>
            {all.map((r, i) => (
              <tr key={r.orderNumber + "-" + r.art + "-" + i}>
                <td>{deDate(r.date)}</td>
                <td><span className={`pill ${r.art === "Stornierung" ? "warn" : "ok"}`}>{r.art}</span></td>
                <td>{r.event}</td><td>{r.customer}</td><td className="mono">{r.orderNumber}</td><td>{r.category}</td>
                <td>{r.purpose}</td>
                <td className="amount">{formatEur(r.paidCents)}</td>
                <td className="amount">{formatEur(r.amountCents)}</td>
              </tr>
            ))}
            {all.length === 0 && <tr><td colSpan={9} className="muted" style={{ textAlign: "center", padding: 24 }}>Noch kein Abgleich – unter Stammdaten Shopify + Tags hinterlegen und „Jetzt abgleichen".</td></tr>}
          </tbody>
        </table>
      </div>
      {feed?.syncedAt && <p className="note">Letzter Shopify-Abgleich: {new Date(feed.syncedAt).toLocaleString("de-DE")}</p>}
    </div>
  );
}
