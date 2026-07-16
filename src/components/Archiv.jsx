import { useState, useMemo, Fragment } from "react";
import { formatEur } from "../lib/money.js";
import { downloadXml } from "../lib/sepa.js";
import { flatten, toCsv, toDatev, kindLabel, downloadText } from "../lib/datevExport.js";

const deDate = (iso) => (iso ? String(iso).split("-").reverse().join(".") : "—");

// Feste Farbe je Überweisungstyp – damit Erstattung/Rechnung/Sammel auf einen Blick
// auseinanderzuhalten sind (verhindert Verwechslung bei ähnlichen Summen).
const KIND_COLOR = {
  erstattung: { bd: "#5b8cff", bg: "rgba(91,140,255,.18)", fg: "#bcd0ff" },  // blau
  rechnung:   { bd: "#e7b15a", bg: "rgba(231,177,90,.18)", fg: "#f0c889" },  // bernstein
  sammel:     { bd: "#b98cff", bg: "rgba(185,140,255,.18)", fg: "#d8c4ff" }, // violett
};
const kindColor = (k) => KIND_COLOR[k] || { bd: "var(--border-strong)", bg: "var(--raised-2)", fg: "var(--muted)" };

// Erstattungsart je Position lesbar machen: Voll (100 %) / Teil (mit Stornogebühr) / Fester Betrag.
const refundModeLabel = (p) => {
  if (!p || !p.refundMode) return "";
  if (p.refundMode === "full") return "Voll (100 %)";
  if (p.refundMode === "fee") return `Teil${p.feePct ? ` (${p.feePct} % Gebühr)` : " (Stornogebühr)"}`;
  if (p.refundMode === "fixed") return "Fester Betrag";
  return "";
};

// Treffer im Text gelb markieren (alle Vorkommen), damit man die gesuchte Bestellnummer
// nicht mehr suchen muss. Gibt einen String (kein Treffer) oder ein Array aus Text + <mark> zurück.
function highlight(text, q) {
  const s = String(text ?? "");
  const needle = String(q || "").trim().toLowerCase();
  if (!needle) return s;
  const low = s.toLowerCase();
  if (!low.includes(needle)) return s;
  const out = [];
  let i = 0, k = 0;
  while (true) {
    const j = low.indexOf(needle, i);
    if (j === -1) { out.push(s.slice(i)); break; }
    if (j > i) out.push(s.slice(i, j));
    out.push(<mark key={k++} style={{ background: "#e7b15a", color: "#1a1d23", borderRadius: 3, padding: "0 2px", fontWeight: 700 }}>{s.slice(j, j + needle.length)}</mark>);
    i = j + needle.length;
  }
  return out;
}

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
    try { const res = await onSendRechnungBelege(b.id); setDl(`✓ ${res?.sent || ""} Beleg(e) aus „${b.filename}" an den Steuerberater gesendet.`); }
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
      (!q || `${b.filename} ${b.accountLabel} ${(b.payments || []).map((p) => `${p.name} ${p.invoiceNumber || ""} ${p.purpose || ""}`).join(" ")}`.toLowerCase().includes(q.toLowerCase())))
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
          <input type="text" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Suche (Empfänger, Bestellnr., Verwendungszweck, Datei…)" style={{ maxWidth: 280 }} />
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
            {filtered.map((b) => {
              const c = kindColor(b.kind);
              const ql = q.trim().toLowerCase();
              // Bei aktiver Suche automatisch aufklappen – der Treffer soll sofort sichtbar sein.
              const isOpen = openId === b.id || !!ql;
              const isHit = (p) => !!ql && `${p.name} ${p.iban} ${p.invoiceNumber || ""} ${p.purpose || ""}`.toLowerCase().includes(ql);
              return (
              <Fragment key={b.id}>
                <tr style={{ cursor: "pointer" }} onClick={() => setOpenId(openId === b.id ? null : b.id)}>
                  <td style={{ width: 24, borderLeft: `4px solid ${c.bd}` }}>{isOpen ? "▾" : "▸"}</td>
                  <td>{deDate(b.execDate)}</td><td className="muted">{deDate(b.createdAt)}</td>
                  <td><span className="pill" style={{ background: c.bg, color: c.fg }}>{kindLabel(b.kind)}</span></td>
                  <td>{b.accountLabel}</td><td>{b.count}</td>
                  <td className="amount">{formatEur(b.sumCents)}</td>
                  <td className="muted">{highlight(b.filename, ql)}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {canPay && b.xml && <button className="btn ghost small" onClick={(e) => { e.stopPropagation(); reDownload(b); }}>erneut laden</button>}
                    {canPay && b.kind === "rechnung" && onSendRechnungBelege && <button className="btn ghost small" style={{ marginLeft: 6 }} disabled={sendBusy === b.id} onClick={(e) => { e.stopPropagation(); resendBelege(b); }}>{sendBusy === b.id ? "Sende…" : "An Steuerberater senden"}</button>}
                  </td>
                </tr>
                {isOpen && (b.payments || []).map((p, i) => {
                  const ml = refundModeLabel(p);
                  const hit = isHit(p);
                  return (
                  <Fragment key={b.id + "-" + i}>
                    <tr style={{ background: hit ? "rgba(231,177,90,.12)" : "var(--bg)" }}>
                      <td style={{ borderLeft: `4px solid ${hit ? "#e7b15a" : c.bd}` }}></td><td colSpan={3} className="muted">{highlight(p.name, ql)}</td>
                      <td colSpan={2} className="muted mono">{highlight(p.iban, ql)}</td>
                      <td className="amount">{formatEur(p.amountCents)}</td>
                      <td colSpan={2} className="muted">{highlight(p.purpose, ql)}{ml && <span className="pill" style={{ marginLeft: 8 }}>{ml}</span>}</td>
                    </tr>
                    {p.note && (
                      <tr style={{ background: "var(--bg)" }}>
                        <td style={{ borderLeft: `4px solid ${c.bd}` }}></td>
                        <td colSpan={8} className="muted" style={{ fontSize: 12, fontStyle: "italic" }}>💬 Interner Kommentar: {p.note}</td>
                      </tr>
                    )}
                  </Fragment>
                );
                })}
              </Fragment>
            );
            })}
            {filtered.length === 0 &&<tr><td colSpan={9} className="muted" style={{ textAlign: "center", padding: 28 }}>Keine Überweisungen im gewählten Zeitraum.</td></tr>}
          </tbody>
        </table>
      </div>
      {!canPay && <p className="note">Hinweis: Export &amp; erneuter Download sind Admins vorbehalten.</p>}
    </div>
  );
}
