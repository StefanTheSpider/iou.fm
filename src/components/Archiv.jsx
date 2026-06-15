import { useState, useMemo, Fragment } from "react";
import { formatEur } from "../lib/money.js";
import { downloadXml } from "../lib/sepa.js";
import { flatten, toCsv, toDatev, kindLabel, downloadText } from "../lib/datevExport.js";

const deDate = (iso) => (iso ? String(iso).split("-").reverse().join(".") : "—");

// Historie aller erzeugten SEPA-Dateien (Löhne, Erstattungen, Sammelüberweisung)
// mit Filtern + Export für die Buchhaltung (DATEV / CSV). Mitarbeiter sehen nur,
// was wann überwiesen wurde; Export & erneuter Download sind Admin-Aktionen.
export default function Archiv({ data, canPay = false, onSendRechnungBelege = null }) {
  // Löhne tauchen NIE im Archiv auf – für niemanden (auch nicht für Admins).
  // Rechnungen sieht nur der Admin (canPay), nicht normale Mitarbeiter.
  const batches = (data.batches || []).filter((b) => b.kind !== "lohn" && (canPay || b.kind !== "rechnung"));
  const [fType, setFType] = useState("alle");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [fAccount, setFAccount] = useState("alle");
  const [q, setQ] = useState("");
  const [openId, setOpenId] = useState(null);
  const [dl, setDl] = useState("");
  const [sendBusy, setSendBusy] = useState("");
  function reDownload(b) {
    downloadXml(b.xml, b.filename);
    setDl(`✓ „${b.filename}" wurde gespeichert (Ordner „Downloads").`);
    setTimeout(() => setDl(""), 4000);
  }
  async function resendBelege(b) {
    if (!onSendRechnungBelege) return;
    setSendBusy(b.id); setDl("");
    try { const res = await onSendRechnungBelege(b.id); setDl(`✓ ${res?.sent || ""} Beleg(e) aus „${b.filename}" an DATEV/Steuerberater gesendet.`); }
    catch (e) { setDl("⚠️ " + (e.message || "Versand fehlgeschlagen.")); }
    finally { setSendBusy(""); setTimeout(() => setDl(""), 6000); }
  }

  const accountList = useMemo(() => [...new Set(batches.map((b) => b.accountLabel).filter(Boolean))], [batches]);

  const filtered = useMemo(() => batches
    .filter((b) =>
      (fType === "alle" || b.kind === fType) &&
      (!from || (b.execDate || "") >= from) &&
      (!to || (b.execDate || "") <= to) &&
      (fAccount === "alle" || b.accountLabel === fAccount) &&
      (!q || `${b.filename} ${b.accountLabel} ${(b.payments || []).map((p) => p.name).join(" ")}`.toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => (b.execDate || "").localeCompare(a.execDate || "")), [batches, fType, from, to, fAccount, q]);

  const sumCents = filtered.reduce((s, b) => s + (b.sumCents || 0), 0);
  const payCount = filtered.reduce((s, b) => s + (b.count || 0), 0);

  function exportCsv() { downloadText(toCsv(flatten(filtered)), `Historie_${from || "alle"}_${to || "heute"}.csv`); }
  function exportDatev() { downloadText(toDatev(flatten(filtered), data.config?.datev || {}), `DATEV_Buchungsstapel_${from || "alle"}_${to || "heute"}.csv`); }

  return (
    <div>
      <h1>Archiv / Historie</h1>
      <p className="sub">Alle erzeugten Überweisungen – wann, an wen, wie viel. Filterbar und für die Buchhaltung exportierbar (DATEV / CSV).</p>

      <div className="card">
        <div className="toolbar" style={{ marginTop: 0 }}>
          <label className="muted" style={{ display: "flex", gap: 6, alignItems: "center" }}>Typ
            <select value={fType} onChange={(e) => setFType(e.target.value)}>
              <option value="alle">alle</option>
              <option value="erstattung">Erstattungen</option>
              <option value="sammel">Sammelüberweisung</option>
              {canPay && <option value="rechnung">Rechnungen</option>}
            </select>
          </label>
          <label className="muted" style={{ display: "flex", gap: 6, alignItems: "center" }}>von
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          <label className="muted" style={{ display: "flex", gap: 6, alignItems: "center" }}>bis
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
          <label className="muted" style={{ display: "flex", gap: 6, alignItems: "center" }}>Konto
            <select value={fAccount} onChange={(e) => setFAccount(e.target.value)}>
              <option value="alle">alle</option>
              {accountList.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </label>
          <input type="text" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Suche (Empfänger, Datei…)" style={{ maxWidth: 220 }} />
        </div>
      </div>

      <div className="summary-bar">
        <div className="stat"><div className="num">{filtered.length}</div><div className="lbl">SEPA-Dateien</div></div>
        <div className="stat"><div className="num">{payCount}</div><div className="lbl">Zahlungen</div></div>
        <div className="stat"><div className="num">{formatEur(sumCents)}</div><div className="lbl">Summe</div></div>
        <div className="spacer" style={{ flex: 1 }} />
        {canPay && (
          <div className="inline-edit" style={{ alignSelf: "center" }}>
            <button className="btn ghost" onClick={exportCsv} disabled={!filtered.length}>CSV exportieren</button>
            <button className="btn" onClick={exportDatev} disabled={!filtered.length}>DATEV-Buchungsstapel</button>
          </div>
        )}
      </div>

      {dl && <p className="note" style={{ color: "var(--ok, #3ddc97)", margin: "0 0 10px" }}>{dl}</p>}

      <div className="table-wrap">
        <table>
          <thead>
            <tr><th></th><th>Ausführung</th><th>Erstellt</th><th>Typ</th><th>Konto</th><th>Zahlungen</th><th className="amount">Summe</th><th>Datei</th><th></th></tr>
          </thead>
          <tbody>
            {filtered.map((b) => (
              <Fragment key={b.id}>
                <tr style={{ cursor: "pointer" }} onClick={() => setOpenId(openId === b.id ? null : b.id)}>
                  <td style={{ width: 24 }}>{openId === b.id ? "▾" : "▸"}</td>
                  <td>{deDate(b.execDate)}</td><td className="muted">{deDate(b.createdAt)}</td>
                  <td><span className="pill">{kindLabel(b.kind)}</span></td>
                  <td>{b.accountLabel}</td><td>{b.count}</td>
                  <td className="amount">{formatEur(b.sumCents)}</td>
                  <td className="muted">{b.filename}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {canPay && b.xml && <button className="btn ghost small" onClick={(e) => { e.stopPropagation(); reDownload(b); }}>erneut laden</button>}
                    {canPay && b.kind === "rechnung" && onSendRechnungBelege && <button className="btn ghost small" style={{ marginLeft: 6 }} disabled={sendBusy === b.id} onClick={(e) => { e.stopPropagation(); resendBelege(b); }}>{sendBusy === b.id ? "Sende…" : "An DATEV senden"}</button>}
                  </td>
                </tr>
                {openId === b.id && (b.payments || []).map((p, i) => (
                  <tr key={b.id + "-" + i} style={{ background: "var(--bg)" }}>
                    <td></td><td colSpan={3} className="muted">{p.name}</td>
                    <td colSpan={2} className="muted mono">{p.iban}</td>
                    <td className="amount">{formatEur(p.amountCents)}</td>
                    <td colSpan={2} className="muted">{p.purpose}</td>
                  </tr>
                ))}
              </Fragment>
            ))}
            {filtered.length === 0 &&<tr><td colSpan={9} className="muted" style={{ textAlign: "center", padding: 28 }}>Keine Überweisungen im gewählten Zeitraum.</td></tr>}
          </tbody>
        </table>
      </div>
      {!canPay && <p className="note">Hinweis: Export &amp; erneuter Download sind Admins vorbehalten.</p>}
    </div>
  );
}
