import { useState } from "react";
import { inspectIban, formatIban, validateIban, cleanIban } from "../lib/iban.js";
import { parseAmount, formatEur } from "../lib/money.js";
import { computeRefund, REFUND_MODES } from "../lib/refund.js";
import { buildSepaXml, downloadXml } from "../lib/sepa.js";
import { fetchShopifyOrder } from "../lib/shopify.js";

const today = () => new Date().toISOString().slice(0, 10);
const deDate = (iso) => (iso ? iso.split("-").reverse().join(".") : "");
const DEV = typeof import.meta !== "undefined" && import.meta.env && import.meta.env.DEV;

const METHODS = [
  { id: "ueberweisung", label: "Überweisung (SEPA)" },
  { id: "paypal", label: "PayPal" },
  { id: "klarna", label: "Klarna" },
  { id: "kreditkarte", label: "Kreditkarte" },
  { id: "gutschein", label: "Gutschein" },
  { id: "stornorechnung", label: "Stornorechnung" },
];
const methodLabel = (id) => METHODS.find((m) => m.id === id)?.label || id;

function emptyRow(defaults = {}) {
  return {
    id: crypto.randomUUID(),
    orderNumber: "", customerName: "",
    method: "ueberweisung",
    refundViaSepa: false,         // Karten-/PayPal-Zahlung bewusst per Überweisung erstatten
    art: "erstattung",            // erstattung | storno (für Buchhaltung)
    iban: "", ibanValid: false, ibanReason: "", bic: "",
    paid: "", currency: "EUR",
    mode: defaults.mode || "fee", feePct: defaults.feePct ?? "30", fixed: "",
    purpose: "",
    status: "offen",             // offen | erledigt
    erledigtAm: null,            // Datum: SEPA-Generierung bzw. Rückerstattung/Storno
    batchId: null,
    selected: true,
    ...defaults.row,
  };
}

export default function Erstattungen({ data, updateData, profile = "erstattung", canPay = true }) {
  const isErstattung = profile !== "sammel";
  const accounts = data.accounts || [];
  const shopify = data.shopify || {};
  const shopifyConnected = !!(shopify.domain && shopify.token);

  const rows = data.refunds || [];
  const [defMode, setDefMode] = useState("fee");
  const [defFee, setDefFee] = useState("30");
  const [orderInput, setOrderInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [fMethod, setFMethod] = useState("alle");
  const [fStatus, setFStatus] = useState("offen");
  const [showModal, setShowModal] = useState(false);

  // Alle Änderungen laufen über data.refunds → der Speichern-Button erscheint.
  const setRefunds = (fn) => updateData((d) => ({ ...d, refunds: fn(d.refunds || []) }));
  function patchRow(id, patch) { setRefunds((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r))); }
  function removeRow(id) {
    const r = (data.refunds || []).find((x) => x.id === id);
    const who = (r && (r.customerName || r.orderNumber)) || "dieser Eintrag";
    if (!window.confirm(`Eintrag „${who}" wirklich löschen?\n\nDas lässt sich nicht rückgängig machen. Bereits erledigte Zahlungen bleiben im Archiv erhalten.`)) return;
    setRefunds((rs) => rs.filter((x) => x.id !== id));
  }
  function addEmpty() { setRefunds((rs) => [emptyRow(isErstattung ? { mode: defMode, feePct: defFee } : { mode: "full" }), ...rs]); }

  // IBAN live prüfen, aber Eingabe roh lassen (kein Desync, keine Meldung bei leer).
  async function onIbanChange(id, value) {
    patchRow(id, { iban: value });
    if (!value.trim()) { patchRow(id, { ibanValid: false, ibanReason: "", bic: "" }); return; }
    const info = await inspectIban(value, { online: false });
    patchRow(id, { ibanValid: info.ok, ibanReason: info.reason || "", bic: info.bic || "" });
  }

  async function importOrder() {
    setError(""); const num = orderInput.trim(); if (!num) return;
    setBusy(true);
    try {
      const o = await fetchShopifyOrder({ domain: shopify.domain, token: shopify.token, orderNumber: num });
      setRefunds((rs) => [emptyRow({
        mode: defMode, feePct: defFee,
        row: { orderNumber: o.orderNumber, customerName: o.customerName, method: o.method || "ueberweisung", paid: (o.totalCents / 100).toFixed(2), currency: o.currency, purpose: o.suggestedPurpose },
      }), ...rs]);
      setOrderInput("");
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  function calc(r) {
    const paidCents = parseAmount(r.paid).cents;
    const value = r.mode === "fixed" ? parseAmount(r.fixed).cents : Number(r.feePct);
    const refund = computeRefund({ paidCents, mode: r.mode, value });
    const isEur = r.currency === "EUR";
    const sepaMode = r.method === "ueberweisung" || r.refundViaSepa;
    const sepaEligible = sepaMode && r.status === "offen" && r.ibanValid && refund.valid && isEur;
    return { paidCents, refund, isEur, sepaMode, sepaEligible };
  }

  const computed = rows.map((r) => ({ r, ...calc(r) }));
  const eligible = computed.filter((c) => c.sepaEligible && c.r.selected !== false);
  const sumEligible = eligible.reduce((s, c) => s + c.refund.refundCents, 0);

  const visible = computed.filter(({ r }) =>
    (fMethod === "alle" || r.method === fMethod) &&
    (fStatus === "alle" || r.status === fStatus)
  );

  // Nicht-SEPA als erstattet/storniert markieren (Buchhaltungs-Nachweis).
  function markDone(id, art) {
    patchRow(id, { status: "erledigt", art, erledigtAm: today() });
  }
  function reopen(id) { patchRow(id, { status: "offen", erledigtAm: null, batchId: null }); }

  function createSepa(accountId, execDate) {
    const account = accounts.find((a) => a.id === accountId);
    if (!account || !validateIban(account.iban).ok) { setError("Bitte gültiges Auftraggeberkonto wählen."); return; }
    if (!eligible.length) { setError("Keine offenen Überweisungen ausgewählt."); return; }

    const payments = eligible.map(({ r, refund }) => ({
      name: r.customerName, iban: cleanIban(r.iban), bic: r.bic, amountCents: refund.refundCents,
      purpose: r.purpose || `Erstattung ${r.orderNumber}`, endToEndId: r.orderNumber || "NOTPROVIDED",
    }));
    const xml = buildSepaXml({
      debtor: { name: account.name, iban: account.iban, bic: account.bic },
      executionDate: execDate, payments, category: null,
    });
    const gen = today();
    const [y, m, d] = execDate.split("-");
    const filename = `${d}_${m}_${y.slice(2)}_Erstattung_SEPA.xml`;
    downloadXml(xml, filename);

    const batchId = crypto.randomUUID();
    const ids = new Set(eligible.map((c) => c.r.id));
    const batch = {
      id: batchId, kind: isErstattung ? "erstattung" : "sammel", createdAt: gen, execDate,
      accountLabel: account.label, count: payments.length, sumCents: sumEligible, filename, xml,
      payments: payments.map((p) => ({ name: p.name, iban: p.iban, amountCents: p.amountCents, purpose: p.purpose })),
    };
    // Aktion: sofort speichern – „erledigt"-Status & Datei-Archiv dürfen nicht verloren gehen.
    updateData((dd) => ({
      ...dd,
      refunds: (dd.refunds || []).map((r) => ids.has(r.id) ? { ...r, status: "erledigt", art: "erstattung", erledigtAm: gen, batchId } : r),
      batches: [batch, ...(dd.batches || [])],
    }), true);
    setShowModal(false);
    setError("");
  }

  const offenCount = computed.filter((c) => c.sepaEligible).length;

  return (
    <div>
      <h1>{isErstattung ? "Erstattungen" : "Sammelüberweisung"}</h1>
      <p className="sub">
        {isErstattung
          ? "Alle Rückerstattungen & Stornos – pro Zahlart, mit Datum. Nur offene Überweisungen fließen in eine SEPA-Datei."
          : "Empfänger erfassen (Name, IBAN, Betrag, Verwendungszweck) und als eine SEPA-Datei auszahlen."}
      </p>

      <div className="card">
        <div className="toolbar" style={{ marginTop: 0 }}>
          {isErstattung && (shopifyConnected ? (
            <>
              <input type="text" value={orderInput} onChange={(e) => setOrderInput(e.target.value)}
                placeholder="Bestellnummer z. B. 1024" style={{ maxWidth: 200 }}
                onKeyDown={(e) => e.key === "Enter" && importOrder()} />
              <button className="btn" onClick={importOrder} disabled={busy}>{busy ? "Lädt…" : "Aus Shopify laden"}</button>
            </>
          ) : (
            <span className="note" style={{ margin: 0 }}>Shopify nicht verbunden – unter <strong>Stammdaten</strong> Domain + Token eintragen, um Bestellungen zu laden.</span>
          ))}
          <button className="btn ghost" onClick={addEmpty}>{isErstattung ? "+ Leere Zeile" : "+ Empfänger"}</button>
          <div className="spacer" />
          {isErstattung && (
            <label className="muted" style={{ display: "flex", gap: 6, alignItems: "center" }}>Standard
              <select value={defMode} onChange={(e) => setDefMode(e.target.value)}>
                {REFUND_MODES.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
              </select>
              {defMode === "fee" && <input type="text" value={defFee} onChange={(e) => setDefFee(e.target.value)} style={{ width: 46 }} />}
            </label>
          )}
        </div>
        {error && <p className="error-text" style={{ margin: "8px 0 0" }}>{error}</p>}
      </div>

      <div className="summary-bar">
        <div className="stat"><div className="num">{offenCount}</div><div className="lbl">{isErstattung ? "offene Überweisungen" : "offene Zahlungen"}</div></div>
        <div className="stat"><div className="num">{formatEur(sumEligible)}</div><div className="lbl">Summe ausgewählt</div></div>
        <div className="spacer" style={{ flex: 1 }} />
        {canPay ? (
          <button className="btn" disabled={!eligible.length} onClick={() => setShowModal(true)} style={{ alignSelf: "center" }}>
            SEPA-Datei erstellen ({eligible.length})
          </button>
        ) : (
          <span className="note" style={{ alignSelf: "center" }}>Nur Admins erstellen die SEPA-Datei.</span>
        )}
      </div>

      <div className="toolbar">
        {isErstattung && (
          <label className="muted" style={{ display: "flex", gap: 6, alignItems: "center" }}>Zahlart
            <select value={fMethod} onChange={(e) => setFMethod(e.target.value)}>
              <option value="alle">alle</option>
              {METHODS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </label>
        )}
        <label className="muted" style={{ display: "flex", gap: 6, alignItems: "center" }}>Status
          <select value={fStatus} onChange={(e) => setFStatus(e.target.value)}>
            <option value="offen">offen</option>
            <option value="erledigt">erledigt</option>
            <option value="alle">alle</option>
          </select>
        </label>
        <span className="muted">{visible.length} Einträge</span>
      </div>

      <div className="refunds">
        {visible.map(({ r, refund, isEur, sepaMode, sepaEligible }) => {
          const ibanLen = (r.iban || "").replace(/[^0-9A-Za-z]/g, "").length;
          const showInvalid = sepaMode && !r.ibanValid && ibanLen >= 15;
          return (
            <div key={r.id} className={`refund-card ${showInvalid ? "invalid" : ""} ${r.status === "erledigt" ? "done" : ""}`}>
              <div className="refund-head">
                {sepaMode && r.status === "offen" && (
                  <input type="checkbox" disabled={!sepaEligible} checked={!!(sepaEligible && r.selected !== false)}
                    onChange={(e) => patchRow(r.id, { selected: e.target.checked })} title="in SEPA-Datei aufnehmen" />
                )}
                <div className="who-wrap">
                  <input className="who-input" value={r.customerName} placeholder={isErstattung ? "Name / Kontoinhaber" : "Empfänger"}
                    onChange={(e) => patchRow(r.id, { customerName: e.target.value })} />
                  {isErstattung && (
                    <div className="head-meta">
                      <input className="ord-input" value={r.orderNumber} placeholder="Best.-Nr."
                        onChange={(e) => patchRow(r.id, { orderNumber: e.target.value })} />
                      <span className="pill">{methodLabel(r.method)}</span>
                      {r.refundViaSepa && r.method !== "ueberweisung" && <span className="pill warn">→ per Überweisung</span>}
                    </div>
                  )}
                </div>
                <div className="spacer" />
                <div className="amt-wrap">
                  <span className={`refund-amount ${refund.valid ? "ok" : ""}`}>{refund.valid ? formatEur(refund.refundCents) : "—"}</span>
                  {isErstattung && r.paid && <span className="amt-sub">von {formatEur(parseAmount(r.paid).cents)}</span>}
                </div>
                {r.status === "erledigt" ? (
                  <span className="pill ok">{sepaMode ? "SEPA erstellt" : (r.art === "storno" ? "storniert" : "erstattet")} · {deDate(r.erledigtAm)}</span>
                ) : sepaMode ? (
                  <div className="inline-edit">
                    <span className="pill warn">offen</span>
                    {r.refundViaSepa && r.method !== "ueberweisung" && (
                      <button className="btn ghost small" title="Doch nicht per Überweisung erstatten" onClick={() => patchRow(r.id, { refundViaSepa: false, selected: false })}>↩︎</button>
                    )}
                  </div>
                ) : (
                  <div className="inline-edit">
                    <button className="btn ghost small" onClick={() => markDone(r.id, "erstattung")}>erstattet</button>
                    <button className="btn ghost small" onClick={() => markDone(r.id, "storno")}>storniert</button>
                    <button className="btn small" title="Stattdessen per SEPA-Überweisung auf ein Konto zurückzahlen (IBAN nötig)" onClick={() => patchRow(r.id, { refundViaSepa: true, selected: true })}>per Überweisung</button>
                  </div>
                )}
                {r.status === "erledigt"
                  ? <button className="btn ghost small" onClick={() => reopen(r.id)} title="wieder öffnen">↺</button>
                  : <button className="btn danger small" onClick={() => removeRow(r.id)}>✕</button>}
              </div>

              <div className="refund-grid">
                {isErstattung && (
                  <label className="f"><span>Zahlart</span>
                    <div className="locked-field" title="Kommt aus der Bestellung und ist festgeschrieben">
                      {methodLabel(r.method)} <span className="lock-ico">🔒</span>
                    </div></label>
                )}
                <label className="f"><span>{isErstattung ? "Gezahlt (€)" : "Betrag (€)"}</span>
                  <input className="mono" type="text" value={r.paid} placeholder="0,00"
                    onChange={(e) => patchRow(r.id, { paid: e.target.value })} />
                  {!isEur && <span className="pill warn">{r.currency} – kein SEPA</span>}</label>
                {sepaMode && (
                  <label className="f col-wide"><span>IBAN</span>
                    <input className="mono" type="text" value={r.iban} placeholder="DE…"
                      onChange={(e) => onIbanChange(r.id, e.target.value)} />
                    {r.ibanValid
                      ? <span className="pill ok">🟢 {r.bic || "gültig"}</span>
                      : showInvalid && <span className="pill bad">🔴 IBAN ungültig{isErstattung ? " – Kunde fragen" : ""}</span>}
                  </label>
                )}
                {isErstattung && (
                  <label className="f"><span>Erstattungsart</span>
                    <div className="refund-art">
                      <select value={r.mode} onChange={(e) => patchRow(r.id, { mode: e.target.value })}>
                        {REFUND_MODES.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                      </select>
                      {r.mode === "fee" && <input className="mono" type="text" value={r.feePct} onChange={(e) => patchRow(r.id, { feePct: e.target.value })} title="Gebühr %" />}
                      {r.mode === "fixed" && <input className="mono" type="text" value={r.fixed} placeholder="€" onChange={(e) => patchRow(r.id, { fixed: e.target.value })} />}
                    </div></label>
                )}
                <label className="f col-full"><span>Verwendungszweck</span>
                  <input type="text" value={r.purpose} onChange={(e) => patchRow(r.id, { purpose: e.target.value })} /></label>
              </div>
            </div>
          );
        })}
        {visible.length === 0 && <div className="card muted" style={{ textAlign: "center", padding: 28 }}>Keine Einträge in dieser Ansicht.</div>}
      </div>

      {showModal && (
        <SepaModal accounts={accounts} count={eligible.length} sumCents={sumEligible}
          onClose={() => setShowModal(false)} onCreate={createSepa} />
      )}
    </div>
  );
}

function SepaModal({ accounts, count, sumCents, onClose, onCreate }) {
  const [accountId, setAccountId] = useState(accounts[0]?.id || "");
  const [execDate, setExecDate] = useState(today());
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }} onClick={onClose}>
      <div className="card" style={{ width: 460, maxWidth: "90vw" }} onClick={(e) => e.stopPropagation()}>
        <h2 style={{ marginTop: 0 }}>SEPA-Datei erstellen</h2>
        <p className="note">
          {count} offene Überweisung{count === 1 ? "" : "en"} · Summe <strong>{formatEur(sumCents)}</strong>.
          Diese Einträge werden danach als „SEPA erstellt" markiert (mit Datum) und nicht erneut einbezogen.
        </p>
        <label className="field"><span>Auftraggeberkonto (von welchem überwiesen wird)</span>
          <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            <option value="">— wählen —</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.label} – {formatIban(a.iban)}</option>)}
          </select>
        </label>
        <label className="field"><span>Ausführungsdatum</span>
          <input type="date" value={execDate} onChange={(e) => setExecDate(e.target.value)} /></label>
        {accounts.length === 0 && <p className="error-text">Kein Auftraggeberkonto vorhanden – bitte unter Stammdaten anlegen.</p>}
        <div className="toolbar" style={{ marginBottom: 0 }}>
          <button className="btn ghost" onClick={onClose}>Abbrechen</button>
          <div className="spacer" />
          <button className="btn" disabled={!accountId} onClick={() => onCreate(accountId, execDate)}>Erstellen & herunterladen</button>
        </div>
      </div>
    </div>
  );
}
