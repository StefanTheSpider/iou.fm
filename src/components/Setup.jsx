import { useState } from "react";
import { inspectIban, formatIban } from "../lib/iban.js";

// Pflicht-Ersteinrichtung durch den Admin, bevor die App nutzbar ist:
// mindestens ein Auftraggeberkonto + Wahl des zweiten Moduls.
export default function Setup({ data, updateData, onComplete }) {
  const accounts = data.accounts || [];
  const mode = data.config?.payoutMode || "erstattung";
  const [label, setLabel] = useState("");
  const [name, setName] = useState("");
  const [ibanVal, setIbanVal] = useState("");
  const [ibanInfo, setIbanInfo] = useState(null);
  const [error, setError] = useState("");

  async function checkIban(v) {
    if (!v.trim()) { setIbanInfo(null); return null; }
    try {
      const r = await inspectIban(v, { online: false });
      setIbanInfo(r); return r;
    } catch {
      const r = { ok: false, reason: "IBAN-Prüfung fehlgeschlagen – bitte erneut versuchen." };
      setIbanInfo(r); return r;
    }
  }

  async function addAccount(e) {
    e.preventDefault();
    const info = await checkIban(ibanVal);
    if (!info?.ok) { setError(info?.reason || "Bitte eine gültige IBAN eingeben."); return; }
    updateData((d) => ({
      ...d,
      accounts: [...(d.accounts || []), {
        id: crypto.randomUUID(), label: label.trim() || name.trim(), name: name.trim(),
        iban: info.iban, bic: info.bic || "", bank: info.bank || "",
      }],
    }));
    setLabel(""); setName(""); setIbanVal(""); setIbanInfo(null); setError("");
  }

  const setMode = (m) => updateData((d) => ({ ...d, config: { ...(d.config || {}), payoutMode: m } }));

  function finish() {
    if (accounts.length === 0) { setError("Bitte mindestens ein Auftraggeberkonto anlegen."); return; }
    onComplete();
  }

  return (
    <div style={{ maxWidth: 760, margin: "0 auto" }}>
      <h1>Einrichtung</h1>
      <p className="sub">Bevor es losgeht, richte deine Firma einmal ein. Alles lässt sich später unter <strong>Stammdaten</strong> ändern oder ergänzen.</p>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>1 · Auftraggeberkonto {accounts.length > 0 ? `(${accounts.length})` : ""}</h2>
        <p className="note">Von welchem Konto überwiesen wird – mindestens eins ist erforderlich.</p>
        {accounts.length > 0 && (
          <div className="table-wrap" style={{ marginBottom: 14 }}>
            <table>
              <thead><tr><th>Bezeichnung</th><th>Auftraggeber</th><th>IBAN</th><th>BIC</th></tr></thead>
              <tbody>{accounts.map((a) => (
                <tr key={a.id}><td>{a.label}</td><td>{a.name}</td><td>{formatIban(a.iban)}</td><td>{a.bic || <span className="muted">—</span>}</td></tr>
              ))}</tbody>
            </table>
          </div>
        )}
        <form onSubmit={addAccount}>
          <div className="row">
            <label className="field"><span>Bezeichnung</span>
              <input type="text" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="z. B. Hauptkonto" /></label>
            <label className="field"><span>Auftraggeber-Name</span>
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Muster GmbH" /></label>
          </div>
          <label className="field"><span>IBAN</span>
            <input className="mono" type="text" value={ibanVal} onChange={(e) => setIbanVal(e.target.value)}
              onBlur={(e) => checkIban(e.target.value)} placeholder="DE…" /></label>
          <div className="toolbar" style={{ margin: 0 }}>
            {ibanInfo && (ibanInfo.ok
              ? <span className="pill ok">🟢 {ibanInfo.bic || "gültig"}</span>
              : <span className="pill bad">🔴 {ibanInfo.reason}</span>)}
            <div className="spacer" />
            <button className="btn" type="submit">Konto hinzufügen</button>
          </div>
        </form>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>2 · Welches zweite Modul?</h2>
        <label className="field" style={{ maxWidth: 400 }}><span>Modul-Profil</span>
          <select value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="erstattung">Erstattungen (Shop / Rückzahlungen)</option>
            <option value="sammel">Sammelüberweisung (allgemein)</option>
          </select></label>
        <p className="note">„Löhne" (DATEV-PDF) ist immer verfügbar. Shopify-Anbindung, Darstellung und weitere Benutzer richtest du bei Bedarf später unter Stammdaten ein.</p>
      </div>

      {error && <p className="error-text">{error}</p>}
      <div className="toolbar">
        {accounts.length === 0 && <span className="note" style={{ margin: 0 }}>Lege zuerst oben mindestens ein Auftraggeberkonto an, dann geht es weiter.</span>}
        <div className="spacer" />
        <button className="btn" onClick={finish} disabled={accounts.length === 0}>Einrichtung abschließen →</button>
      </div>
    </div>
  );
}
