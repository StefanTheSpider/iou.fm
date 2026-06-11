import { useState, useRef } from "react";
import { parseAmount, formatEur } from "../lib/money.js";
import { validateIban, cleanIban, formatIban, inspectIban } from "../lib/iban.js";
import { buildSepaXml, downloadXml } from "../lib/sepa.js";
import { extractInvoice } from "../lib/invoicePdf.js";

const today = () => new Date().toISOString().slice(0, 10);
const deDate = (iso) => (iso ? String(iso).split("-").reverse().join(".") : "—");
const norm = (n) => String(n ?? "").trim();

// Rechnungs-Modul: PDFs einlesen -> Zahlungsdaten prüfen -> eine SEPA-Datei.
// Standard ohne KI: E-Rechnung/Heuristik + Lieferanten-Gedächtnis + Review.
export default function Rechnungen({ data, updateData, canPay = true, userName = "" }) {
  const accounts = data.accounts || [];
  const rows = data.invoices || [];
  const creditors = data.creditors || {};          // IBAN -> { name, bic }
  const opts = data.config?.invoiceOpts || {};      // { useDueDate, skonto, approval }
  const fileRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [confirmDel, setConfirmDel] = useState(null);
  const [warn, setWarn] = useState(null);           // Doppelzahlungs-Warnung
  const [fStatus, setFStatus] = useState("offen");

  const setInvoices = (fn) => updateData((d) => ({ ...d, invoices: fn(d.invoices || []) }));
  const patchRow = (id, patch) => setInvoices((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const removeRow = (id) => { setInvoices((rs) => rs.filter((x) => x.id !== id)); setConfirmDel(null); };

  // Bereits bezahlte Rechnungsnummern (aus früheren Rechnungs-Batches).
  const paidSet = new Set(
    (data.batches || []).filter((b) => b.kind === "rechnung")
      .flatMap((b) => (b.payments || []).map((p) => norm(p.invoiceNumber).toLowerCase()).filter(Boolean))
  );

  async function ibanMeta(iban) {
    const v = validateIban(iban);
    if (!v.ok) return { ibanValid: false, ibanReason: v.reason || "ungültig", bic: "" };
    let bic = "";
    try { bic = (await inspectIban(iban, { online: false })).bic || ""; } catch { /* offline */ }
    return { ibanValid: true, ibanReason: "", bic };
  }

  async function addFiles(fileList) {
    setError(""); setBusy(true);
    try {
      for (const file of Array.from(fileList || [])) {
        if (!/\.pdf$/i.test(file.name)) continue;
        let ex;
        try { ex = await extractInvoice(file); }
        catch (e) { setError(`„${file.name}": ${e.message}`); continue; }
        const iban = ex.iban ? cleanIban(ex.iban) : "";
        const known = creditors[iban];
        const meta = iban ? await ibanMeta(iban) : { ibanValid: false, ibanReason: "", bic: "" };
        const creditorName = (known?.name) || ex.creditorName || "";
        const invoiceNumber = ex.invoiceNumber || "";
        const row = {
          id: crypto.randomUUID(), fileName: ex.fileName || file.name, source: ex.source || "heuristik",
          creditorName, iban, ibanValid: meta.ibanValid, ibanReason: meta.ibanReason,
          bic: meta.bic || ex.bic || known?.bic || "",
          amount: ex.amountCents ? (ex.amountCents / 100).toFixed(2) : "",
          invoiceNumber, dueDate: ex.dueDate || "",
          purpose: `Rechnung ${invoiceNumber}${creditorName ? " " + creditorName : ""}`.trim(),
          skontoPct: "", note: "", status: "offen", selected: true,
          createdBy: userName || "—", createdAt: today(),
        };
        // eslint-disable-next-line no-loop-func
        setInvoices((rs) => [row, ...rs]);
        if (invoiceNumber && paidSet.has(invoiceNumber.toLowerCase())) {
          setWarn({ row, reason: "paid" });
        }
      }
    } finally { setBusy(false); if (fileRef.current) fileRef.current.value = ""; }
  }

  async function onIbanChange(id, value) {
    patchRow(id, { iban: value });
    const meta = await ibanMeta(value);
    patchRow(id, meta);
  }

  function rowCents(r) {
    const base = parseAmount(r.amount).cents;
    const sk = Number(r.skontoPct) || 0;
    return opts.skonto && sk > 0 ? Math.round(base * (1 - sk / 100)) : base;
  }
  const computed = rows.map((r) => ({ r, cents: rowCents(r), eligible: r.status === "offen" && r.ibanValid && rowCents(r) > 0 && r.selected !== false }));
  const eligible = computed.filter((c) => c.eligible);
  const sumEligible = eligible.reduce((s, c) => s + c.cents, 0);
  const visible = computed.filter(({ r }) => fStatus === "alle" || r.status === fStatus);

  function defaultExecDate() {
    if (opts.useDueDate) {
      const due = eligible.map((c) => c.r.dueDate).filter(Boolean).sort();
      if (due.length) return due[0] < today() ? today() : due[0]; // nie in der Vergangenheit
    }
    return today();
  }

  function createSepa(accountId, execDate) {
    const account = accounts.find((a) => a.id === accountId);
    if (!account || !validateIban(account.iban).ok) { setError("Bitte gültiges Auftraggeberkonto wählen."); return; }
    if (!eligible.length) { setError("Keine zahlbaren Rechnungen ausgewählt."); return; }
    const payments = eligible.map(({ r, cents }) => ({
      name: r.creditorName || "Empfänger", iban: cleanIban(r.iban), bic: r.bic, amountCents: cents,
      purpose: r.purpose || `Rechnung ${r.invoiceNumber}`, endToEndId: r.invoiceNumber || "NOTPROVIDED",
      invoiceNumber: r.invoiceNumber, dueDate: r.dueDate, note: r.note,
    }));
    const xml = buildSepaXml({ debtor: { name: account.name, iban: account.iban, bic: account.bic }, executionDate: execDate, payments, category: null });
    const [y, m, d] = execDate.split("-");
    const filename = `${d}_${m}_${y.slice(2)}_Rechnungen_SEPA.xml`;
    downloadXml(xml, filename);

    const batchId = crypto.randomUUID();
    const ids = new Set(eligible.map((c) => c.r.id));
    const newCreditors = { ...creditors };
    for (const { r } of eligible) if (r.iban && validateIban(r.iban).ok) newCreditors[cleanIban(r.iban)] = { name: r.creditorName, bic: r.bic };

    updateData((dd) => ({
      ...dd,
      invoices: (dd.invoices || []).map((r) => ids.has(r.id) ? { ...r, status: "erledigt", erledigtAm: today(), batchId } : r),
      creditors: newCreditors,
      batches: [{
        id: batchId, kind: "rechnung", createdAt: today(), execDate,
        accountLabel: account.label, count: payments.length, sumCents: sumEligible, filename, xml,
        payments: payments.map((p) => ({ name: p.name, iban: p.iban, amountCents: p.amountCents, purpose: p.purpose, invoiceNumber: p.invoiceNumber })),
      }, ...(dd.batches || [])],
    }), true);
    setShowModal(false); setError("");
    setSaved(`✓ „${filename}" gespeichert (Ordner „Downloads"). ${payments.length} Rechnung${payments.length === 1 ? "" : "en"}, Summe ${formatEur(sumEligible)}. Liegt auch im Archiv.`);
  }

  return (
    <div>
      <h1>Rechnungen</h1>
      <p className="sub">Rechnungs-PDFs einlesen, Zahlungsdaten prüfen und als eine SEPA-Datei auszahlen. E-Rechnungen (ZUGFeRD/XRechnung) werden exakt gelesen, sonst per Mustererkennung – immer mit Kontrolle.</p>

      <div className="card">
        <div className="toolbar" style={{ marginTop: 0 }}>
          <input ref={fileRef} type="file" accept="application/pdf" multiple style={{ display: "none" }}
            onChange={(e) => addFiles(e.target.files)} />
          <button className="btn" onClick={() => fileRef.current?.click()} disabled={busy}>{busy ? "Lese …" : "Rechnungs-PDFs laden"}</button>
          <span className="note">Mehrere PDFs auf einmal möglich. Bekannte Lieferanten werden automatisch erkannt.</span>
        </div>
        {error && <p className="error-text">{error}</p>}
        {saved && <p className="note" style={{ color: "var(--ok, #3ddc97)" }}>{saved}</p>}
      </div>

      <div className="summary-bar">
        <div className="stat"><div className="num">{eligible.length}</div><div className="lbl">zahlbar ausgewählt</div></div>
        <div className="stat"><div className="num">{formatEur(sumEligible)}</div><div className="lbl">Summe</div></div>
        <div className="spacer" style={{ flex: 1 }} />
        {canPay
          ? <button className="btn" disabled={!eligible.length} onClick={() => setShowModal(true)}>SEPA-Datei erstellen ({eligible.length})</button>
          : <span className="note" style={{ alignSelf: "center" }}>Nur Admins erstellen die SEPA-Datei (Vier-Augen-Prinzip).</span>}
      </div>

      <div className="toolbar">
        <label className="muted" style={{ display: "flex", gap: 6, alignItems: "center" }}>Status
          <select value={fStatus} onChange={(e) => setFStatus(e.target.value)}>
            <option value="offen">offen</option><option value="erledigt">erledigt</option><option value="alle">alle</option>
          </select>
        </label>
        <span className="muted">{visible.length} Einträge</span>
      </div>

      {visible.map(({ r, cents }) => (
        <div className="card" key={r.id}>
          <div className="toolbar" style={{ marginTop: 0, alignItems: "center" }}>
            {r.status === "offen" && <input type="checkbox" checked={r.selected !== false} onChange={(e) => patchRow(r.id, { selected: e.target.checked })} />}
            <strong>{r.creditorName || "— Lieferant —"}</strong>
            <span className="pill">{r.source === "e-rechnung" ? "E-Rechnung" : "PDF"}</span>
            {r.invoiceNumber && <span className="note">Nr. {r.invoiceNumber}</span>}
            {r.createdBy && <span className="note">· erfasst von {r.createdBy}</span>}
            <div className="spacer" />
            <span className="refund-amount ok">{formatEur(cents)}</span>
            <span className={`pill ${r.status === "offen" ? "warn" : "ok"}`}>{r.status}</span>
            <button className="btn ghost small" onClick={() => setConfirmDel(r.id)}>✕</button>
          </div>
          <div className="row">
            <label className="field"><span>Lieferant</span>
              <input type="text" value={r.creditorName} onChange={(e) => patchRow(r.id, { creditorName: e.target.value })} /></label>
            <label className="field" style={{ minWidth: 280 }}><span>IBAN</span>
              <input type="text" value={r.iban} onChange={(e) => onIbanChange(r.id, e.target.value)} placeholder="DE…" />
              <span className="note">{r.iban ? (r.ibanValid ? `✓ ${formatIban(r.iban)}${r.bic ? " · " + r.bic : ""}` : `⚠︎ ${r.ibanReason || "ungültig"}`) : ""}</span>
            </label>
            <label className="field"><span>Betrag (€)</span>
              <input type="text" value={r.amount} onChange={(e) => patchRow(r.id, { amount: e.target.value })} /></label>
            {opts.skonto && <label className="field" style={{ maxWidth: 110 }}><span>Skonto %</span>
              <input type="number" min={0} max={20} value={r.skontoPct} onChange={(e) => patchRow(r.id, { skontoPct: e.target.value })} /></label>}
            {opts.useDueDate && <label className="field" style={{ maxWidth: 160 }}><span>Fällig am</span>
              <input type="date" value={r.dueDate || ""} onChange={(e) => patchRow(r.id, { dueDate: e.target.value })} /></label>}
            <label className="field"><span>Rechnungsnr.</span>
              <input type="text" value={r.invoiceNumber} onChange={(e) => patchRow(r.id, { invoiceNumber: e.target.value })} /></label>
            <label className="field col-full"><span>Verwendungszweck</span>
              <input type="text" value={r.purpose} onChange={(e) => patchRow(r.id, { purpose: e.target.value })} /></label>
            <label className="field col-full"><span>Interner Kommentar</span>
              <input type="text" value={r.note} placeholder="z. B. Freigabe durch …, Bestellbezug" onChange={(e) => patchRow(r.id, { note: e.target.value })} /></label>
          </div>
        </div>
      ))}
      {visible.length === 0 && <div className="card muted" style={{ textAlign: "center", padding: 28 }}>Noch keine Rechnungen – lade oben PDFs.</div>}

      {showModal && <SepaModal accounts={accounts} count={eligible.length} sumCents={sumEligible} defaultDate={defaultExecDate()} onClose={() => setShowModal(false)} onCreate={createSepa} />}
      {confirmDel && <ConfirmModal name={(rows.find((x) => x.id === confirmDel)?.creditorName) || "diese Rechnung"} onCancel={() => setConfirmDel(null)} onConfirm={() => removeRow(confirmDel)} />}
      {warn && <DuplicateModal row={warn.row} onClose={() => setWarn(null)} onRemove={() => { removeRow(warn.row.id); setWarn(null); }} />}
    </div>
  );
}

function SepaModal({ accounts, count, sumCents, defaultDate, onClose, onCreate }) {
  const [acc, setAcc] = useState(accounts[0]?.id || "");
  const [date, setDate] = useState(defaultDate);
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 60 }} onClick={onClose}>
      <div className="card" style={{ width: 460, maxWidth: "92vw" }} onClick={(e) => e.stopPropagation()}>
        <h2 style={{ marginTop: 0 }}>SEPA-Datei erstellen</h2>
        <p className="note">{count} Rechnung{count === 1 ? "" : "en"} · Summe <strong>{formatEur(sumCents)}</strong>.</p>
        <label className="field"><span>Auftraggeberkonto</span>
          <select value={acc} onChange={(e) => setAcc(e.target.value)}>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.label} — {formatIban(a.iban)}</option>)}
          </select></label>
        <label className="field"><span>Ausführungsdatum</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <div className="toolbar" style={{ marginBottom: 0 }}>
          <button className="btn ghost" onClick={onClose}>Abbrechen</button>
          <div className="spacer" />
          <button className="btn" disabled={!acc} onClick={() => onCreate(acc, date)}>Datei erstellen</button>
        </div>
      </div>
    </div>
  );
}

function ConfirmModal({ name, onCancel, onConfirm }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 60 }} onClick={onCancel}>
      <div className="card" style={{ width: 420, maxWidth: "90vw" }} onClick={(e) => e.stopPropagation()}>
        <h2 style={{ marginTop: 0 }}>Eintrag entfernen?</h2>
        <p className="note">„{name}" wird aus der Liste entfernt.</p>
        <div className="toolbar" style={{ marginBottom: 0 }}>
          <button className="btn ghost" onClick={onCancel}>Abbrechen</button><div className="spacer" />
          <button className="btn danger" onClick={onConfirm}>Entfernen</button>
        </div>
      </div>
    </div>
  );
}

function DuplicateModal({ row, onClose, onRemove }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.72)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 80, padding: 20 }} onClick={onClose}>
      <div className="card" style={{ width: 560, maxWidth: "94vw", border: "2px solid #ff5f5f" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontSize: 40, lineHeight: 1, marginBottom: 6 }}>⚠️</div>
        <h2 style={{ marginTop: 0, color: "#ff7b7b" }}>Diese Rechnung wurde schon bezahlt!</h2>
        <p style={{ fontSize: 15 }}>Rechnungsnummer <strong>{row.invoiceNumber}</strong>{row.creditorName ? <> ({row.creditorName})</> : ""} taucht bereits in einer früheren SEPA-Datei auf. Erneut zahlen = <strong>Doppelzahlung</strong>.</p>
        <p className="note" style={{ fontSize: 14 }}>Du kannst sie trotzdem in der Liste lassen (z. B. Teilzahlung/Korrektur) oder direkt entfernen.</p>
        <div className="toolbar" style={{ marginBottom: 0, marginTop: 8 }}>
          <button className="btn danger" onClick={onRemove}>Entfernen</button><div className="spacer" />
          <button className="btn" onClick={onClose}>In Liste behalten</button>
        </div>
      </div>
    </div>
  );
}
