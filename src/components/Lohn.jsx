import { useState, useMemo, useRef } from "react";
import { pdfToLines, parseDatev, tidyName } from "../lib/datev.js";
import { inspectIban, formatIban, validateIban } from "../lib/iban.js";
import { parseAmount, formatEur } from "../lib/money.js";
import { buildSepaXml, downloadXml } from "../lib/sepa.js";
import EbicsSendButton from "./EbicsSendButton.jsx";

export default function Lohn({ data, updateData, canPay = true, ebicsAllowed = false }) {
  const [parsed, setParsed] = useState(null);
  const [rows, setRows] = useState([]);
  const [selected, setSelected] = useState(() => new Set());
  const [holdGf, setHoldGf] = useState(false);
  const [debtorId, setDebtorId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [drag, setDrag] = useState(false);
  const [lastSepa, setLastSepa] = useState(null); // { xml, filename } – für optionalen EBICS-Versand
  const fileRef = useRef(null);

  const accounts = data.accounts || [];
  const gfIbans = data.gfIbans || []; // gemerkte Geschäftsführer-IBANs

  async function handleFile(file) {
    if (!file) return;
    setError(""); setBusy(true);
    try {
      const lines = await pdfToLines(file);
      const result = parseDatev(lines);
      if (!result.payments.length) throw new Error("Keine Empfängerzeilen erkannt. Ist das eine DATEV-Abstimmliste?");

      // Empfänger anreichern: IBAN prüfen + BIC ableiten, GF aus Merkliste, Betrag parsen.
      const enriched = [];
      for (const p of result.payments) {
        const info = await inspectIban(p.ibanRaw, { online: false });
        const amount = parseAmount(p.amountRaw);
        enriched.push({
          id: crypto.randomUUID(),
          nameRaw: p.nameRaw,
          displayName: tidyName(p.nameRaw),
          iban: info.iban,
          ibanValid: info.ok,
          ibanReason: info.reason || "",
          bic: info.bic || "",
          bank: info.bank || "",
          amount,
          isGf: gfIbans.includes(info.iban),
        });
      }
      setRows(enriched);
      setParsed(result);

      // Auftraggeberkonto vorwählen: passendes gespeichertes Konto, sonst „aus PDF".
      const match = accounts.find((a) => a.iban === (result.debtor.iban || "").replace(/\s/g, ""));
      const pdfDebtorValid = validateIban(result.debtor.iban).ok;
      setDebtorId(match ? match.id : pdfDebtorValid ? "__pdf__" : accounts[0]?.id || "");

      // Standard: alle gültigen auswählen.
      setSelected(new Set(enriched.filter((r) => r.ibanValid).map((r) => r.id)));
      setHoldGf(false);
    } catch (e) {
      setError(e.message || "Fehler beim Einlesen der PDF.");
      setParsed(null); setRows([]);
    } finally {
      setBusy(false);
    }
  }

  const debtor = useMemo(() => {
    if (debtorId === "__pdf__" && parsed) return { ...parsed.debtor, label: "aus PDF" };
    return accounts.find((a) => a.id === debtorId) || null;
  }, [debtorId, accounts, parsed]);

  function selectable(r) {
    return r.ibanValid && r.amount.valid && !(holdGf && r.isGf);
  }

  function toggle(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function setAll(on) {
    if (!on) return setSelected(new Set());
    setSelected(new Set(rows.filter(selectable).map((r) => r.id)));
  }

  function onHoldGf(on) {
    setHoldGf(on);
    if (on) {
      setSelected((prev) => {
        const next = new Set(prev);
        rows.forEach((r) => { if (r.isGf) next.delete(r.id); });
        return next;
      });
    }
  }

  function fixIban(id, value) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, _editIban: value } : r)));
  }
  async function applyFix(id) {
    const r = rows.find((x) => x.id === id);
    if (!r) return;
    let info;
    try { info = await inspectIban(r._editIban ?? r.iban, { online: false }); }
    catch { setRows((prev) => prev.map((x) => x.id === id ? { ...x, ibanValid: false, ibanReason: "IBAN-Prüfung fehlgeschlagen – bitte erneut versuchen." } : x)); return; }
    setRows((prev) => prev.map((x) => x.id === id ? {
      ...x, iban: info.iban, ibanValid: info.ok, ibanReason: info.reason || "",
      bic: info.bic || x.bic, isGf: gfIbans.includes(info.iban), _editIban: undefined,
    } : x));
  }

  // Geschäftsführer je Zeile markieren – gemerkt pro IBAN für künftige Importe.
  function toggleGf(id) {
    const r = rows.find((x) => x.id === id);
    if (!r) return;
    const next = !r.isGf;
    setRows((prev) => prev.map((x) => (x.id === id ? { ...x, isGf: next } : x)));
    updateData((d) => {
      const set = new Set(d.gfIbans || []);
      if (next) set.add(r.iban); else set.delete(r.iban);
      return { ...d, gfIbans: [...set] };
    });
  }

  const stats = useMemo(() => {
    const sel = rows.filter((r) => selected.has(r.id) && selectable(r));
    const sumCents = sel.reduce((s, r) => s + r.amount.cents, 0);
    const invalid = rows.filter((r) => !r.ibanValid).length;
    const heldGf = rows.filter((r) => r.isGf && holdGf).length;
    return { count: sel.length, sumCents, invalid, heldGf, selRows: sel };
  }, [rows, selected, holdGf]);

  function generate() {
    if (!debtor) return setError("Bitte ein Auftraggeberkonto wählen.");
    const v = validateIban(debtor.iban);
    if (!v.ok) return setError("Das Auftraggeberkonto hat keine gültige IBAN.");
    if (!stats.selRows.length) return setError("Keine Zeilen ausgewählt.");

    const execIso = parsed.executionDate || new Date().toISOString().slice(0, 10);
    const [y, m] = execIso.split("-");
    const purpose = `Gehalt ${m}/${y}`;
    const payments = stats.selRows.map((r) => ({
      name: r.displayName,
      iban: r.iban,
      bic: r.bic,
      amountCents: r.amount.cents,
      purpose,
      endToEndId: "NOTPROVIDED",
    }));
    const xml = buildSepaXml({
      debtor: { name: debtor.name, iban: v.iban, bic: debtor.bic },
      executionDate: execIso,
      payments,
      category: "SALA",
    });
    const [yy, mm, dd] = execIso.split("-");
    const filename = `${dd}_${mm}_${yy.slice(2)}_Lohn_SEPA.xml`;
    downloadXml(xml, filename);

    // Ins Archiv (Historie für die Buchhaltung) schreiben – inkl. Einzelpositionen.
    const batch = {
      id: crypto.randomUUID(), kind: "lohn",
      createdAt: new Date().toISOString().slice(0, 10), execDate: execIso,
      accountLabel: debtor.label || debtor.name, count: payments.length, sumCents: stats.sumCents,
      filename, payments: payments.map((p) => ({ name: p.name, iban: p.iban, amountCents: p.amountCents, purpose: p.purpose })), xml,
    };
    updateData((d) => ({ ...d, batches: [batch, ...(d.batches || [])] }), true);
    setLastSepa({ xml, filename });
    setError("");
  }

  // ---------- Render ----------
  if (!parsed) {
    return (
      <div>
        <h1>Löhne</h1>
        <p className="sub">DATEV-Abstimmliste (PDF) hochladen – Empfänger, Beträge und Auftraggeberbank werden automatisch ausgelesen.</p>
        <div
          className={`dropzone ${drag ? "drag" : ""}`}
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); handleFile(e.dataTransfer.files[0]); }}
          onClick={() => fileRef.current?.click()}
          role="button"
        >
          {busy ? "Lese PDF…" : "📄 DATEV-PDF hierher ziehen oder klicken zum Auswählen"}
          <input ref={fileRef} type="file" accept="application/pdf,.pdf" style={{ display: "none" }}
            onChange={(e) => handleFile(e.target.files[0])} />
        </div>
        {error && <p className="error-text" style={{ marginTop: 12 }}>{error}</p>}
        <p className="note" style={{ marginTop: 16 }}>
          Name, IBAN, Betrag und Auftraggeberbank kommen aus der PDF, die BIC wird automatisch ergänzt.
          Geschäftsführer markierst du nach dem Einlesen je Zeile mit „GF" – die App merkt sich das pro IBAN für den nächsten Monat.
        </p>
      </div>
    );
  }

  const allSelectableSelected = rows.filter(selectable).every((r) => selected.has(r.id)) && stats.count > 0;

  return (
    <div>
      <h1>Löhne</h1>
      <p className="sub">
        Aus PDF: {parsed.payments.length} Empfänger · Ausführungsdatum {parsed.executionDateDe || "—"}
        {parsed.reference ? ` · Ref. ${parsed.reference}` : ""}
      </p>

      <div className="card">
        <label className="field" style={{ maxWidth: 480 }}>
          <span>Auftraggeberkonto (von welchem überwiesen wird)</span>
          <select value={debtorId} onChange={(e) => setDebtorId(e.target.value)}>
            {parsed.debtor.iban && (
              <option value="__pdf__">Aus PDF: {parsed.debtor.name} – {formatIban(parsed.debtor.iban)}</option>
            )}
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.label} – {formatIban(a.iban)}</option>
            ))}
          </select>
        </label>
        {!debtor && <p className="error-text">Kein gültiges Auftraggeberkonto – bitte unter Stammdaten anlegen.</p>}
      </div>

      <div className="summary-bar">
        <div className="stat"><div className="num">{stats.count}</div><div className="lbl">ausgewählt</div></div>
        <div className="stat"><div className="num">{formatEur(stats.sumCents)}</div><div className="lbl">Auszahlsumme</div></div>
        {stats.heldGf > 0 && <div className="stat"><div className="num">{stats.heldGf}</div><div className="lbl">GF zurückgehalten</div></div>}
        {stats.invalid > 0 && <div className="stat"><div className="num" style={{ color: "var(--red)" }}>{stats.invalid}</div><div className="lbl">ungültige IBAN</div></div>}
      </div>

      <div className="toolbar">
        <button className="btn ghost small" onClick={() => setAll(!allSelectableSelected)}>
          {allSelectableSelected ? "Alle abwählen" : "Alle auswählen"}
        </button>
        <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input type="checkbox" checked={holdGf} onChange={(e) => onHoldGf(e.target.checked)} />
          Geschäftsführer-Gehälter zurückhalten
        </label>
        <div className="spacer" />
        {canPay ? (
          <button className="btn" onClick={generate} disabled={!stats.count || !debtor}>
            SEPA-Lohndatei herunterladen ({stats.count})
          </button>
        ) : (
          <span className="note">Nur Admins erstellen die SEPA-Lohndatei.</span>
        )}
        {canPay && lastSepa && (
          <EbicsSendButton data={data} xml={lastSepa.xml} meta={{ kind: "lohn", filename: lastSepa.filename }} allowed={ebicsAllowed} style={{ marginLeft: 8 }} />
        )}
      </div>

      {error && <p className="error-text">{error}</p>}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th className="checkbox-cell"></th>
              <th>Empfänger</th>
              <th>IBAN</th>
              <th>BIC</th>
              <th>Status</th>
              <th className="amount">Betrag</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const canSelect = selectable(r);
              const held = holdGf && r.isGf;
              return (
                <tr key={r.id} className={`${!r.ibanValid ? "invalid" : ""} ${held ? "held" : ""}`}>
                  <td className="checkbox-cell">
                    <input type="checkbox" disabled={!canSelect}
                      checked={selected.has(r.id)} onChange={() => toggle(r.id)} />
                  </td>
                  <td>
                    {r.displayName}{" "}
                    <button className={`pill ${r.isGf ? "gf" : ""}`} onClick={() => toggleGf(r.id)}
                      style={{ border: "none", cursor: "pointer", opacity: r.isGf ? 1 : 0.45 }}
                      title="Als Geschäftsführer markieren – Gehalt zurückhaltbar">GF</button>
                  </td>
                  <td>
                    {r.ibanValid ? formatIban(r.iban) : (
                      <div className="inline-edit">
                        <input type="text" defaultValue={r.iban}
                          onChange={(e) => fixIban(r.id, e.target.value)} />
                        <button className="btn ghost small" onClick={() => applyFix(r.id)}>Prüfen</button>
                      </div>
                    )}
                  </td>
                  <td>{r.bic || <span className="muted">—</span>}</td>
                  <td>
                    {r.ibanValid
                      ? <span className="pill ok">🟢 gültig</span>
                      : <span className="pill bad">🔴 {r.ibanReason} – fragen</span>}
                  </td>
                  <td className="amount">
                    {r.amount.currency !== "EUR"
                      ? <span className="pill warn">{r.amount.currency}</span>
                      : formatEur(r.amount.cents)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="toolbar">
        <button className="btn ghost small" onClick={() => { setParsed(null); setRows([]); }}>
          ← Andere PDF laden
        </button>
        <p className="note" style={{ margin: 0 }}>
          Rote Zeilen (ungültige IBAN) werden nicht ausgezahlt, bis sie korrigiert sind. Fremdwährung (selten bei Gehältern) wird markiert.
        </p>
      </div>
    </div>
  );
}
