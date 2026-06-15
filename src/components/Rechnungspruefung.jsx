import { useState } from "react";
import { inspectIban, formatIban, cleanIban } from "../lib/iban.js";
import { formatEur } from "../lib/money.js";
import { emptyLine, invoiceTotals, parsePastedLines } from "../lib/invoice.js";

// Rechnungsprüfung: Positionen erfassen, angenommene Menge bestätigen/kürzen,
// freigegebenen Betrag in die Sammelüberweisung übernehmen.
export default function Rechnungspruefung({ data, updateData }) {
  const suppliers = data.suppliers || [];
  const [supplierId, setSupplierId] = useState("");
  const [name, setName] = useState("");
  const [ibanVal, setIbanVal] = useState("");
  const [ibanInfo, setIbanInfo] = useState(null);
  const [invNr, setInvNr] = useState("");
  const [lines, setLines] = useState([emptyLine()]);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [paste, setPaste] = useState("");
  const [info, setInfo] = useState("");
  const [error, setError] = useState("");

  function pickSupplier(id) {
    setSupplierId(id);
    const s = suppliers.find((x) => x.id === id);
    if (s) { setName(s.name); setIbanVal(s.iban); inspectIban(s.iban).then(setIbanInfo).catch(() => setIbanInfo({ ok: false, reason: "IBAN-Prüfung fehlgeschlagen." })); }
  }
  async function checkIban(v) {
    if (!v.trim()) { setIbanInfo(null); return null; }
    try { const r = await inspectIban(v, { online: false }); setIbanInfo(r); return r; }
    catch { const r = { ok: false, reason: "IBAN-Prüfung fehlgeschlagen." }; setIbanInfo(r); return r; }
  }

  function setLine(id, patch) { setLines((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l))); }
  function addLine() { setLines((ls) => [...ls, emptyLine()]); }
  function delLine(id) { setLines((ls) => (ls.length > 1 ? ls.filter((l) => l.id !== id) : ls)); }
  function applyPaste() {
    const parsed = parsePastedLines(paste);
    if (parsed.length) { setLines((ls) => [...ls.filter((l) => l.desc || l.price), ...parsed]); setPaste(""); setPasteOpen(false); setError(""); }
    else setError("Keine Positionen erkannt. Format pro Zeile: Bezeichnung ; Menge ; Einzelpreis.");
  }

  const totals = invoiceTotals(lines);

  async function toPayout() {
    setError(""); setInfo("");
    const ibInfo = ibanInfo?.ok ? ibanInfo : await checkIban(ibanVal);
    if (!name.trim()) return setError("Bitte Lieferant/Empfänger angeben.");
    if (!ibInfo?.ok) return setError("Bitte gültige IBAN des Lieferanten angeben.");
    if (totals.approvedCents <= 0) return setError("Freigegebener Betrag ist 0 – bitte Positionen prüfen.");

    const purpose = `Rechnung ${invNr || ""} ${name}`.replace(/\s+/g, " ").trim();
    const row = {
      id: crypto.randomUUID(), orderNumber: invNr || "", customerName: name.trim(),
      method: "ueberweisung", art: "erstattung",
      iban: cleanIban(ibInfo.iban), ibanValid: true, bic: ibInfo.bic || "",
      paid: (totals.approvedCents / 100).toFixed(2), currency: "EUR",
      mode: "full", feePct: "30", fixed: "", purpose,
      status: "offen", erledigtAm: null, batchId: null, selected: true,
    };
    updateData((d) => ({ ...d, refunds: [row, ...(d.refunds || [])] }));
    setInfo(`Übernommen: ${formatEur(totals.approvedCents)} für ${name.trim()} → im Sammelüberweisungs-/Erstattungs-Tab zur Auszahlung bereit.`);
    setInvNr(""); setLines([emptyLine()]);
  }

  return (
    <div>
      <h1>Rechnungsprüfung</h1>
      <p className="sub">Rechnung erfassen, je Position die tatsächlich angenommene Menge bestätigen/kürzen – der freigegebene Betrag wird in die Sammelüberweisung übernommen.</p>

      <div className="card">
        <div className="row">
          <label className="field"><span>Lieferant (aus Stammdaten)</span>
            <select value={supplierId} onChange={(e) => pickSupplier(e.target.value)}>
              <option value="">— frei eingeben —</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select></label>
          <label className="field"><span>Lieferant / Empfänger</span>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Lieferant GmbH" /></label>
          <label className="field"><span>Rechnungsnr.</span>
            <input type="text" value={invNr} onChange={(e) => setInvNr(e.target.value)} placeholder="z. B. 2024-114" /></label>
        </div>
        <label className="field" style={{ maxWidth: 480 }}><span>IBAN des Lieferanten</span>
          <input className="mono" type="text" value={ibanVal} onChange={(e) => setIbanVal(e.target.value)} onBlur={(e) => checkIban(e.target.value)} placeholder="DE…" />
          {ibanInfo && (ibanInfo.ok ? <span className="pill ok" style={{ marginTop: 4 }}>🟢 {ibanInfo.bic || "gültig"}</span> : <span className="pill bad" style={{ marginTop: 4 }}>🔴 {ibanInfo.reason}</span>)}
        </label>
      </div>

      <div className="toolbar">
        <button className="btn ghost small" onClick={addLine}>+ Position</button>
        <button className="btn ghost small" onClick={() => setPasteOpen((v) => !v)}>CSV/Excel einfügen</button>
        <div className="spacer" />
        <span className="muted">Tipp: leeres Feld „angenommen" = volle Menge. Abgelehnte Ware auf 0 setzen.</span>
      </div>

      {pasteOpen && (
        <div className="card">
          <p className="note" style={{ marginTop: 0 }}>Pro Zeile: <code>Bezeichnung ; Menge ; Einzelpreis</code> (oder Tab-getrennt). Aus Excel kopieren geht direkt.</p>
          <textarea value={paste} onChange={(e) => setPaste(e.target.value)} rows={5}
            style={{ width: "100%", background: "var(--raised)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 9, padding: 10, fontFamily: "var(--mono)" }}
            placeholder={"Lachs 5kg;5;20,00\nBrot;10;2,50"} />
          <div className="toolbar" style={{ marginBottom: 0 }}><div className="spacer" /><button className="btn" onClick={applyPaste}>Übernehmen</button></div>
        </div>
      )}

      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>Bezeichnung</th><th className="amount">Menge</th><th className="amount">Einzelpreis €</th><th className="amount">angenommen</th><th className="amount">Rechnung</th><th className="amount">freigegeben</th><th></th></tr>
          </thead>
          <tbody>
            {totals.rows.map(({ line, invoicedCents, approvedCents, accepted, qty }) => {
              const reduced = accepted < qty;
              return (
                <tr key={line.id} className={reduced ? "invalid" : ""}>
                  <td><input type="text" value={line.desc} style={{ width: 220 }} onChange={(e) => setLine(line.id, { desc: e.target.value })} placeholder="Artikel" /></td>
                  <td className="amount"><input className="mono" type="text" value={line.qty} style={{ width: 60, textAlign: "right" }} onChange={(e) => setLine(line.id, { qty: e.target.value })} /></td>
                  <td className="amount"><input className="mono" type="text" value={line.price} style={{ width: 80, textAlign: "right" }} onChange={(e) => setLine(line.id, { price: e.target.value })} placeholder="0,00" /></td>
                  <td className="amount"><input className="mono" type="text" value={line.accepted} style={{ width: 70, textAlign: "right" }} onChange={(e) => setLine(line.id, { accepted: e.target.value })} placeholder={String(qty)} /></td>
                  <td className="amount">{formatEur(invoicedCents)}</td>
                  <td className="amount" style={reduced ? { color: "var(--amber)" } : undefined}>{formatEur(approvedCents)}</td>
                  <td><button className="btn danger small" onClick={() => delLine(line.id)}>✕</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="summary-bar">
        <div className="stat"><div className="num">{formatEur(totals.invoicedCents)}</div><div className="lbl">Rechnungssumme</div></div>
        <div className="stat"><div className="num" style={{ color: "var(--accent)" }}>{formatEur(totals.approvedCents)}</div><div className="lbl">freigegeben</div></div>
        {totals.diffCents > 0 && <div className="stat"><div className="num" style={{ color: "var(--amber)" }}>−{formatEur(totals.diffCents)}</div><div className="lbl">gekürzt/abgelehnt</div></div>}
        <div className="spacer" style={{ flex: 1 }} />
        <button className="btn" onClick={toPayout} style={{ alignSelf: "center" }}>In Sammelüberweisung übernehmen</button>
      </div>

      {error && <p className="error-text">{error}</p>}
      {info && <p className="pill ok" style={{ display: "inline-block" }}>{info}</p>}
    </div>
  );
}
