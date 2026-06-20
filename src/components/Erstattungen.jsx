import { useState } from "react";
import { inspectIban, formatIban, validateIban, cleanIban } from "../lib/iban.js";
import { parseAmount, formatEur } from "../lib/money.js";
import { computeRefund, REFUND_MODES } from "../lib/refund.js";
import { buildSepaXml, downloadXml } from "../lib/sepa.js";
import { fetchOrder, ecommerceConfig, ecommerceConfigured, platformLabel } from "../lib/ecommerce/index.js";
import EbicsSendButton from "./EbicsSendButton.jsx";
import { toastError } from "../lib/toast.js";

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
    note: "",                     // interner Grund der Erstattung
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

export default function Erstattungen({ data, updateData, profile = "erstattung", canPay = true, feed = null, onAppRefunds = null, userName = "", ebicsAllowed = false }) {
  const isErstattung = profile !== "sammel";
  const cancelledSet = new Set((feed?.cancellations || []).map((c) => c.orderNumber));
  const cancelInfo = (num) => (feed?.cancellations || []).find((c) => c.orderNumber === String(num).replace(/^#/, ""));
  // Bereits erstattet? (Shopify-Refund ODER per App/SEPA ausgezahlt) – Doppelzahlungs-Schutz.
  const norm = (n) => String(n ?? "").replace(/^#/, "").trim();
  const refundedInfo = (num) => {
    const n = norm(num);
    const app = (feed?.appRefunds || []).find((r) => norm(r.orderNumber) === n);
    if (app) return { ...app, source: "App/SEPA" };
    const shop = (feed?.refunds || []).find((r) => norm(r.orderNumber) === n);
    if (shop) return { ...shop, source: "Shopify" };
    return null;
  };
  const accounts = data.accounts || [];
  const { platform, config: ecoConfig } = ecommerceConfig(data);
  const shopConnected = ecommerceConfigured(data);
  const shopName = platformLabel(platform);

  const rows = data.refunds || [];
  const [defMode, setDefMode] = useState("fee");
  const [defFee, setDefFee] = useState("30");
  const [orderInput, setOrderInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const fail = (m) => { setError(m); toastError(m); };  // zentral + mittig sichtbar
  const [fMethod, setFMethod] = useState("alle");
  const [fStatus, setFStatus] = useState("offen");
  const [q, setQ] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [saved, setSaved] = useState("");
  const [lastSepa, setLastSepa] = useState(null); // { xml, filename } – für optionalen EBICS-Versand
  const [confirmDel, setConfirmDel] = useState(null);
  const [warnOrder, setWarnOrder] = useState(null); // { o, cancelled, refunded } – Doppelzahlungs-Warnung
  const [blockOrder, setBlockOrder] = useState(null); // per Überweisung bestellt, NIE bezahlt → harte Sperre

  // Alle Änderungen laufen über data.refunds → der Speichern-Button erscheint.
  const setRefunds = (fn) => updateData((d) => ({ ...d, refunds: fn(d.refunds || []) }));
  function patchRow(id, patch) { setRefunds((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r))); }
  function removeRow(id) {
    // SICHERHEITSNETZ: Bereits erledigte Einträge (per SEPA überwiesen/erstattet/storniert)
    // werden NIEMALS gelöscht oder getombstonet – ausgezahltes/abgeschlossenes bleibt erhalten.
    const row = (rows || []).find((x) => x.id === id);
    if (row && row.status === "erledigt") { setConfirmDel(null); return; }
    // Sofort speichern UND als Tombstone vormerken, damit der (offene) Eintrag nach Update/Sync
    // nicht über die additive Zusammenführung wieder eingespielt wird.
    updateData((d) => ({
      ...d,
      refunds: (d.refunds || []).filter((x) => x.id !== id),
      deletedIds: Array.from(new Set([...(d.deletedIds || []), id])).slice(-10000),
    }), true);
    setConfirmDel(null);
  }
  const stamp = () => ({ createdBy: userName || "—", createdAt: today() });
  function addEmpty() { setRefunds((rs) => [{ ...emptyRow(isErstattung ? { mode: defMode, feePct: defFee } : { mode: "full" }), ...stamp() }, ...rs]); }
  // Wie oft kommt eine Bestellnummer in der aktuellen Liste vor? (Dubletten-Hinweis)
  const orderCounts = rows.reduce((m, r) => { const n = norm(r.orderNumber); if (n) m[n] = (m[n] || 0) + 1; return m; }, {});

  // IBAN live prüfen, aber Eingabe roh lassen (kein Desync, keine Meldung bei leer).
  async function onIbanChange(id, value) {
    patchRow(id, { iban: value });
    if (!value.trim()) { patchRow(id, { ibanValid: false, ibanReason: "", bic: "" }); return; }
    try {
      const info = await inspectIban(value, { online: false });
      patchRow(id, { ibanValid: info.ok, ibanReason: info.reason || "", bic: info.bic || "" });
    } catch { patchRow(id, { ibanValid: false, ibanReason: "IBAN-Prüfung fehlgeschlagen – bitte erneut versuchen." }); }
  }

  // Order als neue Zeile übernehmen (nach Prüfung/Bestätigung).
  function addRowFromOrder(o) {
    setRefunds((rs) => [{ ...emptyRow({
      mode: defMode, feePct: defFee,
      row: { orderNumber: o.orderNumber, customerName: o.customerName, method: o.method || "ueberweisung", paid: (o.totalCents / 100).toFixed(2), currency: o.currency, purpose: o.suggestedPurpose },
    }), ...stamp() }, ...rs]);
    setOrderInput("");
  }

  async function importOrder() {
    setError(""); const num = orderInput.trim(); if (!num) return;
    setBusy(true);
    try {
      const o = await fetchOrder({ platform, config: ecoConfig, orderNumber: num });
      // Harte Sperre: per Überweisung bestellt UND nie als bezahlt markiert → wir haben das
      // Geld nie erhalten, also darf gar keine Erstattung erfasst werden (kein „trotzdem“).
      if (o.method === "ueberweisung" && o.paid === false) {
        setBlockOrder(o);
        return;
      }
      // Storniert? Aus dem iou-Feed ODER direkt aus der Shopify-Bestellung (cancelledAt).
      let cancelled = cancelInfo(num);
      if (!cancelled && o.cancelledAt) cancelled = { date: o.cancelledAt };
      // Erstattung erkennen: zuerst aus dem iou-Feed; falls dort nichts steht, aber die
      // Shopify-Bestellung selbst eine (Teil-)Erstattung ausweist (Betrag ODER Status
      // REFUNDED/PARTIALLY_REFUNDED – z. B. 100 € Kulanz oder längst rücküberwiesen,
      // nur nicht in iou erfasst) → trotzdem warnen und prüfen lassen.
      let refunded = refundedInfo(num);
      if (!refunded && o.refundedInShop) {
        refunded = { amountCents: o.refundedCents || 0, date: null, source: "Shopify (Bestellung)" };
      }
      // Streitfall/Chargeback (Rückbuchung): verloren = Geld bereits zurück; offen = ungeklärt,
      // bei Überweisung droht doppelter Verlust, falls der Streitfall ebenfalls zugunsten Kund:in ausgeht.
      const dispute = o.disputeReturned ? { kind: "returned", status: o.disputeStatus }
        : o.disputeOpen ? { kind: "open", status: o.disputeStatus } : null;
      const inList = rows.some((x) => norm(x.orderNumber) === norm(o.orderNumber)); // schon in der Liste?
      if (cancelled || refunded || inList || dispute) {
        // Doppelzahlungs-Schutz: erst bewusst bestätigen, sonst NICHT übernehmen.
        setWarnOrder({ o, cancelled, refunded, inList, dispute });
      } else {
        addRowFromOrder(o);
      }
    } catch (e) { fail(e.message); } finally { setBusy(false); }
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

  const ql = q.trim().toLowerCase();
  const visible = computed.filter(({ r }) =>
    (fMethod === "alle" || r.method === fMethod) &&
    (fStatus === "alle" || r.status === fStatus) &&
    (!ql || `${r.orderNumber || ""} ${r.customerName || ""}`.toLowerCase().includes(ql))
  );

  // Nicht-SEPA als erstattet/storniert markieren (Buchhaltungs-Nachweis).
  function markDone(id, art) {
    patchRow(id, { status: "erledigt", art, erledigtAm: today() });
  }
  function reopen(id) { patchRow(id, { status: "offen", erledigtAm: null, batchId: null }); }

  function createSepa(accountId, execDate) {
    const account = accounts.find((a) => a.id === accountId);
    if (!account || !validateIban(account.iban).ok) { fail("Bitte gültiges Auftraggeberkonto wählen."); return; }
    if (!eligible.length) { fail("Keine offenen Überweisungen ausgewählt."); return; }

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
    // Zusammenfassung (ohne IBAN) an den Hub – für den Buchhalter-Export/USt-Korrektur.
    if (isErstattung && onAppRefunds) {
      const summaries = eligible.map(({ r, refund }) => ({
        orderNumber: String(r.orderNumber || "").replace(/^#/, ""),
        customer: r.customerName,
        event: String(r.purpose || "").replace(/^Erstattung\s+\S+\s*/i, "").trim(),
        purpose: r.purpose || "",
        amountCents: refund.refundCents, paidCents: parseAmount(r.paid).cents,
        date: execDate, currency: r.currency || "EUR",
      })).filter((s) => s.amountCents > 0);
      if (summaries.length) onAppRefunds(summaries);
    }
    setShowModal(false);
    setError("");
    setLastSepa({ xml, filename });
    setSaved(`✓ „${filename}" wurde gespeichert (Ordner „Downloads"). ${payments.length} Zahlung${payments.length === 1 ? "" : "en"}, Summe ${formatEur(sumEligible)}. Liegt auch im Archiv.`);
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
          {isErstattung && (shopConnected ? (
            <>
              <input type="text" value={orderInput} onChange={(e) => setOrderInput(e.target.value)}
                placeholder="Bestellnummer z. B. 1024" style={{ maxWidth: 200 }}
                onKeyDown={(e) => e.key === "Enter" && importOrder()} />
              <button className="btn" onClick={importOrder} disabled={busy}>{busy ? "Lädt…" : `Aus ${shopName} laden`}</button>
            </>
          ) : (
            <span className="note" style={{ margin: 0 }}>{shopName} nicht verbunden – unter <strong>Stammdaten</strong> die Shop-Anbindung einrichten, um Bestellungen zu laden.</span>
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
        {saved && (
          <p className="note" style={{ margin: "8px 0 0", color: "var(--ok, #3ddc97)" }}>
            {saved} <button className="link-btn" onClick={() => setSaved("")}>ausblenden</button>
          </p>
        )}
        {canPay && lastSepa && (
          <div style={{ marginTop: 10 }}>
            <EbicsSendButton data={data} xml={lastSepa.xml} meta={{ kind: isErstattung ? "erstattung" : "sammel", filename: lastSepa.filename }} allowed={ebicsAllowed} />
          </div>
        )}
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
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Suche: Bestellnummer oder Name" style={{ minWidth: 240 }} />
        <span className="muted">{visible.length} Einträge</span>
      </div>

      <div className="refunds">
        {visible.map(({ r, refund, isEur, sepaMode, sepaEligible }) => {
          const ibanLen = (r.iban || "").replace(/[^0-9A-Za-z]/g, "").length;
          const showInvalid = sepaMode && !r.ibanValid && ibanLen >= 15;
          // Warum ist dieser offene Eintrag (noch) nicht für die SEPA-Datei auswählbar?
          // block = { field, short, msg } – short für die Kopf-Pille, msg für die zentrierte Kachel-Meldung,
          // field markiert das betroffene Eingabefeld (rot umrandet).
          let block = null;
          if (sepaMode && r.status === "offen" && !sepaEligible) {
            if (!isEur) block = { field: "paid", short: `${r.currency} – kein SEPA`, msg: `Währung ${r.currency} – nur Beträge in EUR sind per SEPA-Überweisung zahlbar.` };
            else if (!r.ibanValid) block = ibanLen >= 15
              ? { field: "iban", short: "IBAN ungültig", msg: "IBAN ungültig – bitte die IBAN des Empfängers prüfen und korrigieren." }
              : { field: "iban", short: "IBAN fehlt", msg: "IBAN fehlt – bitte die IBAN des Empfängers eintragen, damit überwiesen werden kann." };
            else if (!refund.valid) block = r.mode === "fixed"
              ? { field: "amount", short: "Betrag fehlt", msg: "Fester Erstattungsbetrag fehlt – bitte rechts unter Erstattungsart den Betrag in € eintragen." }
              : { field: "amount", short: "Betrag 0", msg: "Erstattungsbetrag ergibt 0 € – bitte Gebühr/Betrag unter Erstattungsart prüfen." };
          }
          const blockReason = block?.short || "";
          return (
            <div key={r.id} className={`refund-card ${block ? "has-error" : ""} ${showInvalid ? "invalid" : ""} ${r.status === "erledigt" ? "done" : ""}`}>
              <div className="refund-head">
                {sepaMode && r.status === "offen" && (
                  <input type="checkbox" disabled={!sepaEligible} checked={!!(sepaEligible && r.selected !== false)}
                    onChange={(e) => patchRow(r.id, { selected: e.target.checked })}
                    title={sepaEligible ? "in SEPA-Datei aufnehmen" : `Noch nicht auswählbar – ${blockReason || "Angaben unvollständig"}`} />
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
                      {r.orderNumber && cancelledSet.has(String(r.orderNumber).replace(/^#/, "")) && <span className="pill bad" title="laut Shopify storniert">storniert</span>}
                      {r.orderNumber && orderCounts[norm(r.orderNumber)] > 1 && <span className="pill bad" title="Bestellnummer mehrfach in dieser Liste">⚠ doppelt</span>}
                    </div>
                  )}
                  {r.createdBy && <span className="muted" style={{ fontSize: 11 }}>erfasst von {r.createdBy}{r.createdAt ? ` · ${deDate(r.createdAt)}` : ""}</span>}
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
                    {blockReason && <span className="pill bad" title="Bitte ergänzen – danach lässt sich der Haken setzen">⚠ {blockReason}</span>}
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
                  : <button className="btn danger small" onClick={() => setConfirmDel(r.id)} title="Eintrag entfernen">✕</button>}
              </div>

              {block && (
                <div className="refund-msg"><span className="ico">⚠️</span>{block.msg}</div>
              )}

              <div className="refund-grid">
                {isErstattung && (
                  <label className="f"><span>Zahlart</span>
                    <div className="locked-field" title="Automatisch aus der Bestellung erkannt (Gateway + Transaktionsdetails) und festgeschrieben">
                      {methodLabel(r.method)} <span className="lock-ico">🔒</span>
                    </div></label>
                )}
                <label className={`f ${block?.field === "paid" ? "err" : ""}`}><span>{isErstattung ? "Gezahlt (€)" : "Betrag (€)"}</span>
                  <input className="mono" type="text" value={r.paid} placeholder="0,00"
                    onChange={(e) => patchRow(r.id, { paid: e.target.value })} />
                  {!isEur && <span className="pill warn">{r.currency} – kein SEPA</span>}</label>
                {sepaMode && (
                  <label className={`f col-wide ${block?.field === "iban" ? "err" : ""}`}><span>IBAN</span>
                    <input className="mono" type="text" value={r.iban} placeholder="DE…"
                      onChange={(e) => onIbanChange(r.id, e.target.value)} />
                    {r.ibanValid
                      ? <span className="pill ok">🟢 {r.bic || "gültig"}</span>
                      : showInvalid && <span className="pill bad">🔴 IBAN ungültig{isErstattung ? " – Kunde fragen" : ""}</span>}
                  </label>
                )}
                {isErstattung && (
                  <label className={`f ${block?.field === "amount" ? "err" : ""}`}><span>Erstattungsart</span>
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
                <label className="f col-full"><span>Interner Kommentar (Grund der Erstattung)</span>
                  <input type="text" value={r.note || ""} placeholder="z. B. Konzert abgesagt, Kulanz, Doppelbuchung …"
                    onChange={(e) => patchRow(r.id, { note: e.target.value })} /></label>
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

      {confirmDel && (
        <ConfirmModal
          name={(rows.find((x) => x.id === confirmDel)?.customerName) || "diesen Eintrag"}
          onCancel={() => setConfirmDel(null)}
          onConfirm={() => removeRow(confirmDel)} />
      )}

      {warnOrder && (
        <AlreadyPaidModal
          info={warnOrder}
          onCancel={() => setWarnOrder(null)}
          onConfirm={() => { addRowFromOrder(warnOrder.o); setWarnOrder(null); }} />
      )}

      {blockOrder && (
        <UnpaidBlockModal o={blockOrder} onClose={() => setBlockOrder(null)} />
      )}
    </div>
  );
}

// Harte Sperre: Bestellung per Überweisung, aber nie als bezahlt markiert. Diese
// Bestellung darf NICHT erfasst werden – sonst zahlen wir Geld zurück, das nie eingegangen ist.
// Bewusst KEIN „Trotzdem hinzufügen“.
function UnpaidBlockModal({ o, onClose }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.72)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 80, padding: 20 }} onClick={onClose}>
      <div className="card" style={{ width: 560, maxWidth: "94vw", border: "2px solid #ff5f5f", boxShadow: "0 20px 60px rgba(0,0,0,.6)" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontSize: 40, lineHeight: 1, marginBottom: 6 }}>⛔</div>
        <h2 style={{ marginTop: 0, color: "#ff7b7b" }}>Keine Erstattung möglich – nie bezahlt</h2>
        <p style={{ fontSize: 15 }}>
          Bestellung <strong>{o.orderName || o.orderNumber}</strong>{o.customerName ? <> ({o.customerName})</> : ""} wurde
          <strong> per Überweisung</strong> bestellt und ist im Shop <strong>nie als bezahlt markiert</strong>
          {o.financialStatus ? <> (Status: {o.financialStatus})</> : ""}.
        </p>
        <p className="note" style={{ fontSize: 14 }}>
          Für diese Bestellung ist <strong>kein Geld eingegangen</strong>. Eine Erstattung würde bedeuten, Geld
          auszuzahlen, das wir nie erhalten haben – deshalb lässt sich dieser Eintrag <strong>nicht</strong> erfassen.
          Falls das Geld doch eingegangen ist, markiere die Bestellung erst im Shop als „bezahlt“ und versuche es dann erneut.
        </p>
        <div className="toolbar" style={{ marginBottom: 0, marginTop: 8 }}>
          <div className="spacer" />
          <button className="btn" onClick={onClose}>Verstanden</button>
        </div>
      </div>
    </div>
  );
}

// Dicke Warnung: Bestellung wurde bereits erstattet/storniert -> Doppelzahlungs-Schutz.
function AlreadyPaidModal({ info, onCancel, onConfirm }) {
  const { o, cancelled, refunded, inList, dispute } = info;
  const d = (x) => (x ? new Date(x).toLocaleDateString("de-DE") : "");
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.72)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 80, padding: 20 }} onClick={onCancel}>
      <div className="card" style={{ width: 560, maxWidth: "94vw", border: "2px solid #ff5f5f", boxShadow: "0 20px 60px rgba(0,0,0,.6)" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontSize: 40, lineHeight: 1, marginBottom: 6 }}>⚠️</div>
        <h2 style={{ marginTop: 0, color: "#ff7b7b" }}>Achtung – mögliche Doppelzahlung!</h2>
        <p style={{ fontSize: 15 }}>
          Bestellung <strong>{o.orderNumber}</strong>{o.customerName ? <> ({o.customerName})</> : ""}
          {inList ? <> ist <strong>bereits in dieser Liste</strong></> : ""}
          {inList && (refunded || cancelled) ? " und wurde zudem" : ""}
          {refunded ? <> bereits <strong>erstattet</strong>{refunded.amountCents ? <> über <strong>{formatEur(refunded.amountCents)}</strong></> : ""}{refunded.date ? <> am {d(refunded.date)}</> : ""} (Quelle: {refunded.source})</> : ""}
          {refunded && cancelled ? " und" : ""}
          {cancelled ? <> bereits <strong>storniert</strong>{cancelled.date ? <> am {d(cancelled.date)}</> : ""}</> : ""}.
        </p>
        {dispute && (
          <p style={{ fontSize: 14, fontWeight: 700, color: "#ff7b7b", background: "rgba(255,95,95,.12)",
            border: "1px solid #ff5f5f", borderRadius: 8, padding: "10px 12px" }}>
            {dispute.kind === "returned"
              ? <>⛔ Zu dieser Bestellung gibt es einen <strong>verlorenen Streitfall / eine Rückbuchung</strong>{dispute.status ? <> ({dispute.status})</> : ""} – das Geld ist darüber bereits an die Kund:in zurückgegangen. Eine erneute Überweisung wäre ein <strong>doppelter Verlust</strong>.</>
              : <>⚠️ Zu dieser Bestellung läuft ein <strong>offener Streitfall / eine Anfrage</strong>{dispute.status ? <> ({dispute.status})</> : ""} – der Fall ist <strong>noch ungeklärt</strong>. Wenn du jetzt überweist und der Streitfall später zugunsten der Kund:in ausgeht, verlierst du das Geld <strong>ein zweites Mal</strong>. Erst klären, dann zahlen.</>}
          </p>
        )}
        <p className="note" style={{ fontSize: 14 }}>
          {refunded ? <><strong>Bitte den Fall genau prüfen</strong>, bevor du fortfährst – z. B. ob die Teil-/Kulanz-Erstattung von {refunded.amountCents ? <strong>{formatEur(refunded.amountCents)}</strong> : "diesem Betrag"} bereits den ganzen Vorgang abdeckt. </> : null}
          Wenn du sie erneut hinzufügst, riskierst du eine <strong>Doppel-Erstattung</strong>. Das kommt vor – aber bitte nur bewusst.
        </p>
        <div className="toolbar" style={{ marginBottom: 0, marginTop: 8 }}>
          <button className="btn" onClick={onCancel}>Abbrechen (nicht hinzufügen)</button>
          <div className="spacer" />
          <button className="btn danger" onClick={onConfirm}>Trotzdem hinzufügen</button>
        </div>
      </div>
    </div>
  );
}

function ConfirmModal({ name, onCancel, onConfirm }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 60 }} onClick={onCancel}>
      <div className="card" style={{ width: 420, maxWidth: "90vw" }} onClick={(e) => e.stopPropagation()}>
        <h2 style={{ marginTop: 0 }}>Eintrag löschen?</h2>
        <p className="note">
          „{name}" wird aus der Liste entfernt. Das lässt sich nicht rückgängig machen.
          Bereits als erledigt markierte Zahlungen bleiben im Archiv erhalten.
        </p>
        <div className="toolbar" style={{ marginBottom: 0 }}>
          <button className="btn ghost" onClick={onCancel}>Abbrechen</button>
          <div className="spacer" />
          <button className="btn danger" onClick={onConfirm}>Endgültig löschen</button>
        </div>
      </div>
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
