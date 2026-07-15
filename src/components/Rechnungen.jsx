import { useState, useRef } from "react";
import { parseAmount, formatEur } from "../lib/money.js";
import { validateIban, cleanIban, formatIban, inspectIban } from "../lib/iban.js";
import { buildSepaXml, downloadXml } from "../lib/sepa.js";
import { extractInvoice } from "../lib/invoicePdf.js";
import { fetchMailInvoices } from "../lib/mailInvoices.js";
import EbicsSendButton from "./EbicsSendButton.jsx";
import { toastError } from "../lib/toast.js";

const today = () => new Date().toISOString().slice(0, 10);
const deDate = (iso) => (iso ? String(iso).split("-").reverse().join(".") : "—");
const norm = (n) => String(n ?? "").trim();

// B2B: Die Rechnungsnummer MUSS im Verwendungszweck stehen (Zahlungszuordnung läuft
// darüber). Steht sie nicht drin, wird sie vorangestellt – so übersteht sie auch die
// 140-Zeichen-Kürzung von SEPA.
function purposeWithInvoiceNo(purpose, invoiceNumber) {
  const inv = String(invoiceNumber || "").trim();
  const p = String(purpose || "").trim();
  if (!inv) return p || "Rechnung";
  if (p.toLowerCase().includes(inv.toLowerCase())) return p || `Rechnung ${inv}`;
  return p ? `Rechnung ${inv} – ${p}` : `Rechnung ${inv}`;
}

// Dublettenschlüssel: dieselbe Rechnung = gleiche Rechnungsnr + IBAN + Betrag (Cent).
function invoiceKey(invoiceNumber, iban, amountCents) {
  return `${String(invoiceNumber || "").toLowerCase().trim()}|${String(iban || "").replace(/\s/g, "").toUpperCase()}|${Math.round(amountCents || 0)}`;
}
const keyMeaningful = (invoiceNumber, iban) => !!(String(invoiceNumber || "").trim() || String(iban || "").trim());
const rowKey = (r) => invoiceKey(r.invoiceNumber, r.iban, Math.round(parseFloat(r.amount || 0) * 100));

// ArrayBuffer -> Base64 (chunk-weise, damit auch größere PDFs nicht den Stack sprengen).
function bufToB64(buf) {
  let bin = ""; const b = new Uint8Array(buf); const chunk = 0x8000;
  for (let i = 0; i < b.length; i += chunk) bin += String.fromCharCode.apply(null, b.subarray(i, i + chunk));
  return btoa(bin);
}

// Rechnungs-Modul: PDFs einlesen -> Zahlungsdaten prüfen -> eine SEPA-Datei.
// Standard ohne KI: E-Rechnung/Heuristik + Lieferanten-Gedächtnis + Review.
export default function Rechnungen({ data, updateData, canPay = true, userName = "", ebicsAllowed = false, onSendBelege = null, onUploadBelege = null, onSendRechnungBelege = null, mailbox = null }) {
  const accounts = data.accounts || [];
  const rows = data.invoices || [];
  const creditors = data.creditors || {};          // IBAN -> { name, bic }
  const opts = data.config?.invoiceOpts || {};      // { useDueDate, skonto, approval, autoSendBelege, belegEmail, datevEmail }
  const fileRef = useRef(null);
  const pdfStore = useRef(new Map());               // rowId -> { filename, content(b64) }, nur im Speicher
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const fail = (m) => { setError(m); toastError(m); };  // zentral + mittig sichtbar
  const [saved, setSaved] = useState("");
  const [belegMsg, setBelegMsg] = useState("");
  const [scan, setScan] = useState("");             // OCR-Fortschritt (gescannte PDFs)
  const [mailBusy, setMailBusy] = useState(false);  // E-Mail-Eingang wird manuell geprüft
  const [drag, setDrag] = useState(false);          // Drag-&-Drop-Hervorhebung
  const [lastSepa, setLastSepa] = useState(null);   // { xml, filename, batchId } – für EBICS-Versand
  const [showModal, setShowModal] = useState(false);
  const [confirmDel, setConfirmDel] = useState(null);
  const [warn, setWarn] = useState(null);           // Doppelzahlungs-Warnung
  const [fStatus, setFStatus] = useState("offen");

  const setInvoices = (fn) => updateData((d) => ({ ...d, invoices: fn(d.invoices || []) }));
  const patchRow = (id, patch) => setInvoices((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const removeRow = (id) => {
    // SICHERHEITSNETZ: bezahlte (erledigte) Rechnungen werden NIEMALS gelöscht.
    const row = (data.invoices || []).find((x) => x.id === id);
    if (row && row.status === "erledigt") { setConfirmDel(null); return; }
    // Offene Rechnung sofort speichern UND als Lösch-Merker (Tombstone) festschreiben,
    // damit sie nach Update/Sync nicht über die additive Zusammenführung wieder reinkommt.
    updateData((d) => ({
      ...d,
      invoices: (d.invoices || []).filter((x) => x.id !== id),
      deletedIds: Array.from(new Set([...(d.deletedIds || []), id])).slice(-10000),
      // ZWEITER WEG: Per E-Mail importierte Rechnungen würden vom Beleg-Importer immer
      // wieder neu eingelesen, solange die Mail im Archiv liegt. Beim Löschen markieren wir
      // den Beleg daher dauerhaft als „gesehen" – so kommt er NICHT als neue Rechnung zurück.
      invoiceMailSeen: row?.belegId
        ? Array.from(new Set([...(d.invoiceMailSeen || []), row.belegId])).slice(-3000)
        : (d.invoiceMailSeen || []),
    }), true);
    setConfirmDel(null);
  };

  // Bereits bezahlte Rechnungsnummern (aus früheren Rechnungs-Batches).
  const paidSet = new Set(
    (data.batches || []).filter((b) => b.kind === "rechnung")
      .flatMap((b) => (b.payments || []).map((p) => norm(p.invoiceNumber).toLowerCase()).filter(Boolean))
  );
  // Fallback-Schlüssel „Lieferant|Betrag" – erkennt Dubletten auch ohne Rechnungsnummer.
  const paidPairs = new Set(
    (data.batches || []).filter((b) => b.kind === "rechnung")
      .flatMap((b) => (b.payments || []).map((p) => (p.name && p.amountCents ? `${String(p.name).toLowerCase().trim()}|${p.amountCents}` : "")).filter(Boolean))
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
    const ownNames = accounts.flatMap((a) => [a.name, a.label]).filter(Boolean);
    const ownIbans = accounts.map((a) => a.iban).filter(Boolean);
    // Bereits vorhandene Rechnungen (Dublettenprüfung), wird im Lauf ergänzt.
    const seen = new Set((rows || []).map(rowKey).filter((k) => k !== "||0"));
    let dup = 0; let ignored = 0;
    try {
      for (const file of Array.from(fileList || [])) {
        // Unterstützt: PDF (inkl. ZUGFeRD) und reine XRechnung-XML. Alles andere: zählen & melden.
        if (!/\.(pdf|xml)$/i.test(file.name)) { ignored++; continue; }
        let ex;
        const onOcrProgress = (p) => setScan(`🔎 „${file.name}": Texterkennung läuft … ${Math.round((p || 0) * 100)}%`);
        try { ex = await extractInvoice(file, { ownNames, ownIbans, onOcrProgress }); }
        catch (e) {
          // SUPERSAFE: Auslesen gescheitert → trotzdem IMMER eine (leere) Zeile anlegen,
          // damit jede reingezogene Rechnung verarbeitet werden kann (manuell ausfüllbar).
          ex = { source: "manuell", fileName: file.name, hasText: false, creditorName: "", iban: "", bic: "", amountCents: 0, invoiceNumber: "", dueDate: "", ibans: [], noIban: true, paidHint: false, _err: e.message };
        }
        setScan("");
        const iban = ex.iban ? cleanIban(ex.iban) : "";
        const invoiceNumber = ex.invoiceNumber || "";
        const key = invoiceKey(invoiceNumber, iban, ex.amountCents);
        if (keyMeaningful(invoiceNumber, iban) && seen.has(key)) { dup++; continue; } // Dublette → nicht erneut speichern
        const known = creditors[iban];
        const meta = iban ? await ibanMeta(iban)
          : { ibanValid: false, bic: "", ibanReason: ex._err ? "Konnte nicht automatisch ausgelesen werden – bitte Felder manuell ausfüllen."
              : ex.paidHint ? "Laut Beleg evtl. bereits bezahlt (z. B. PayPal/Karte) – bitte prüfen."
              : ex.noIban ? "Keine IBAN/Bankverbindung gefunden – nicht per SEPA zahlbar." : "" };
        const creditorName = (known?.name) || ex.creditorName || "";
        const row = {
          id: crypto.randomUUID(), fileName: ex.fileName || file.name, source: ex.source || "heuristik",
          creditorName, iban, ibanValid: meta.ibanValid, ibanReason: meta.ibanReason,
          bic: meta.bic || ex.bic || known?.bic || "",
          amount: ex.amountCents ? (ex.amountCents / 100).toFixed(2) : "",
          invoiceNumber, dueDate: ex.dueDate || "",
          purpose: `Rechnung ${invoiceNumber}${creditorName ? " " + creditorName : ""}`.trim(),
          skontoPct: "", note: "", status: "offen", selected: true, checked: false,
          createdBy: userName || "—", createdByRole: canPay ? "admin" : "user", createdAt: today(),
        };
        if (keyMeaningful(invoiceNumber, iban)) seen.add(key);
        try { const ab = await file.arrayBuffer(); pdfStore.current.set(row.id, { filename: row.fileName, content: bufToB64(ab) }); } catch { /* egal */ }
        // eslint-disable-next-line no-loop-func
        setInvoices((rs) => [row, ...rs]);
        if (ex.paidHint) setWarn({ row, reason: "paid_ext" });
        else if (ex.noIban) setWarn({ row, reason: "noiban" });
        else if (invoiceNumber && paidSet.has(invoiceNumber.toLowerCase())) setWarn({ row, reason: "paid" });
        else if (ex.amountCents && creditorName && paidPairs.has(`${creditorName.toLowerCase().trim()}|${ex.amountCents}`)) setWarn({ row, reason: "paidPair" });
      }
      const notes = [];
      if (dup) notes.push(`${dup} bereits vorhandene Rechnung(en) übersprungen (gleiche Nr. + IBAN + Betrag)`);
      if (ignored) notes.push(`${ignored} Datei(en) ignoriert – es werden nur PDF und XRechnung-XML unterstützt`);
      if (notes.length) setError(notes.join(" · ") + ".");
    } finally { setBusy(false); if (fileRef.current) fileRef.current.value = ""; }
  }

  // Eingegangene Rechnungen (per E-Mail an die belege-Adresse weitergeleitet) aus dem
  // Beleg-Archiv laden, LOKAL einlesen (E-Rechnung exakt, sonst Heuristik) und als
  // Entwürfe vorbereiten. Nicht-Rechnungen (Tickets, Bestellbestätigungen ohne IBAN)
  // werden übersprungen; Belege werden nur einmal verarbeitet.
  // Manuelles „E-Mail-Eingang prüfen": liest neu weitergeleitete Rechnungen über dieselbe
  // Lib ein wie der App-Hintergrund-Sync. Der automatische Import läuft app-weit (App.jsx) –
  // beim Öffnen dieses Tabs sind die Rechnungen i. d. R. schon da; dies ist nur die manuelle
  // Sofort-Prüfung mit Rückmeldung.
  async function importMailInvoices() {
    if (!mailbox) return;
    setError(""); setSaved(""); setScan("Suche eingegangene Rechnungen …");
    try {
      const { newRows, newSeen, dup, failed } = await fetchMailInvoices({
        mailbox, invoices: rows, creditors, accounts, seenIds: data.invoiceMailSeen || [], batches: data.batches || [],
      });
      if (newRows.length || newSeen.length) {
        updateData((d) => ({
          ...d,
          invoices: [...newRows, ...(d.invoices || [])],
          invoiceMailSeen: [...((d.invoiceMailSeen) || []), ...newSeen].slice(-3000),
        }), true);
      }
      setScan("");
      const failNote = failed ? ` · ⚠ ${failed} Datei(en) nicht lesbar` : "";
      if (newRows.length) setSaved(`✓ ${newRows.length} neue Rechnung${newRows.length === 1 ? "" : "en"} eingelesen${dup ? ` · ${dup} Dublette(n) übersprungen` : ""}${failNote} – bitte unten prüfen, dann auszahlen.`);
      else if (newSeen.length) setSaved(`${newSeen.length} weitergeleitete(r) Beleg(e) eingegangen, aber ohne zahlbare IBAN (z. B. Tickets, PayPal/Karte) – liegen im Beleg-Archiv.`);
      else if (failed) fail(`${failed} eingegangene Datei(en) konnten nicht gelesen werden (beschädigt oder Server nicht erreichbar). Bitte erneut versuchen.`);
      else if (dup) setSaved(`Keine neuen Rechnungen – ${dup} bereits vorhandene übersprungen (gleiche Nr. + IBAN + Betrag).`);
      else setSaved("Keine neuen Belege im E-Mail-Eingang gefunden. (Schon eingelesene werden nicht erneut angezeigt.)");
    } catch (e) {
      setScan(""); fail("E-Mail-Eingang konnte nicht geladen werden: " + (e.message || ""));
    }
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
  // Eine Rechnung ist erst zahlbar, wenn sie als GEPRÜFT markiert wurde (r.checked).
  // So landet nichts Ungeprüftes in der SEPA-Datei oder im EBICS-Versand.
  // Sichtbarkeit: Von Admins geladene Rechnungen sehen NUR Admins – nicht Mitarbeiter
  // (auch nicht im Archiv, das Rechnungs-Batches ohnehin nur Admins zeigt). Per E-Mail
  // eingegangene Belege („E-Mail-Eingang") sind für alle sichtbar.
  const adminLoaded = (r) => r.createdByRole === "admin" || (!r.createdByRole && r.createdBy && r.createdBy !== "E-Mail-Eingang");
  const canSee = (r) => canPay || !adminLoaded(r);
  // Pflichtfeld-Prüfung: auch „Geprüft = Ja" darf NICHT auszahlbar machen, wenn etwas fehlt
  // (z. B. Lieferant nicht erkannt). block = { field, msg } für rote Markierung + Meldung.
  const blockOf = (r, cents) => !r.ibanValid ? { field: "iban", msg: "IBAN fehlt oder ist ungültig" }
    : !(cents > 0) ? { field: "amount", msg: "Betrag fehlt" }
    : !String(r.creditorName || "").trim() ? { field: "creditor", msg: "Lieferant fehlt" } : null;
  const computed = rows.map((r) => {
    const cents = rowCents(r);
    const block = blockOf(r, cents);
    return { r, cents, block, eligible: r.status === "offen" && r.selected !== false && r.checked === true && !block };
  });
  const visibleAll = computed.filter(({ r }) => canSee(r));
  const eligible = visibleAll.filter((c) => c.eligible);
  const sumEligible = eligible.reduce((s, c) => s + c.cents, 0);
  const visible = visibleAll.filter(({ r }) => fStatus === "alle" || r.status === fStatus);
  // Wie viele offene Rechnungen warten noch auf die Prüfung? (Banner-Hinweis, nur Sichtbare)
  const toCheck = visibleAll.filter(({ r }) => r.status === "offen" && !r.checked).length;
  // Wer darf prüfen & an den Steuerberater weiterleiten? Admins immer; sonst nur Mitarbeiter,
  // die in den Stammdaten freigeschaltet sind (config.invoiceReviewers) – case-insensitiv.
  const mayReview = canPay || (data.config?.invoiceReviewers || []).some((x) => String(x).toLowerCase() === String(userName).toLowerCase());

  function defaultExecDate() {
    if (opts.useDueDate) {
      const due = eligible.map((c) => c.r.dueDate).filter(Boolean).sort();
      if (due.length) return due[0] < today() ? today() : due[0]; // nie in der Vergangenheit
    }
    return today();
  }

  // Manuell: alle aktuell geladenen Rechnungs-PDFs SOFORT an Steuerberater mailen
  // (unabhängig von Zahlung/SEPA-Lauf). Versand geht serverseitig von der freigegebenen
  // DATEV-Absenderadresse raus.
  async function sendBelegeNow() {
    setError("");
    if (!onSendBelege) { setBelegMsg("Beleg-Versand ist in dieser Ansicht nicht verfügbar."); return; }
    const files = rows.map((r) => pdfStore.current.get(r.id)).filter(Boolean);
    if (!files.length) {
      setBelegMsg("Keine PDF-Belege im Speicher. Bitte die Rechnungs-PDFs in dieser Sitzung (erneut) laden, dann senden.");
      return;
    }
    setBelegMsg(`Sende ${files.length} Beleg(e) an Steuerberater …`);
    try {
      const res = await onSendBelege({ files, subject: `Rechnungsbelege (${files.length})` });
      setBelegMsg(`✓ ${res?.sent || files.length} Beleg(e) an Steuerberater gesendet.`);
    } catch (e) {
      const m = e.message || "";
      const msg = /Empfänger|recipient/i.test(m)
        ? "Kein Empfänger hinterlegt – trage Steuerberater unter Stammdaten → Belege & Buchhaltung ein."
        : "Beleg-Versand fehlgeschlagen: " + m;
      setBelegMsg(msg); toastError(msg);
    }
  }

  // „Schon bezahlt": nur an Steuerberater weiterleiten (für die Buchhaltung),
  // aber NICHT erneut zur Zahlung aufnehmen → Zeile abwählen, damit sie nicht in die SEPA-Datei kommt.
  async function forwardOnlyToDatev(row) {
    setWarn(null); setError("");
    patchRow(row.id, { selected: false }); // sicher von der Zahlung ausschließen
    if (!onSendBelege) { setBelegMsg("Beleg-Versand ist in dieser Ansicht nicht verfügbar."); return; }
    const f = pdfStore.current.get(row.id);
    if (!f) { setBelegMsg("PDF nicht mehr im Speicher – bitte die Rechnung in dieser Sitzung erneut laden und dann manuell an den Steuerberater senden."); return; }
    setBelegMsg("Sende an Steuerberater (nicht zur Zahlung) …");
    try {
      const res = await onSendBelege({ files: [f], subject: `Beleg (bereits bezahlt): ${row.invoiceNumber || row.creditorName || row.fileName || ""}` });
      const toTxt = (res?.to || []).join(", ");
      setBelegMsg(`✓ ${res?.sent || 1} Beleg an den Steuerberater gesendet${toTxt ? ` → ${toTxt}` : ""} – nicht zur Zahlung hinzugefügt.`);
    } catch (e) {
      const m = e.message || "";
      const msg = /Empfänger|recipient/i.test(m)
        ? "Kein Empfänger hinterlegt – trage Steuerberater unter Stammdaten → Belege & Buchhaltung ein."
        : "Beleg-Versand fehlgeschlagen: " + m;
      setBelegMsg(msg); toastError(msg);
    }
  }

  // Geprüfte Rechnungs-PDFs an Steuerberater mailen – rein OPTIONAL, als Bonus nach der Zahlung.
  // Wer selbst an DATEV/Steuerberater sendet, lässt „Auto-Versand" aus: dann passiert hier
  // GAR NICHTS und es erscheint keine Meldung (kein Nörgeln um einen Empfänger).
  async function sendBelege(eligibleRows) {
    if (!onSendBelege) return;
    if (!opts.autoSendBelege) return;              // Auto-Versand aus → still, keine Meldung
    const files = eligibleRows.map((r) => pdfStore.current.get(r.id)).filter(Boolean);
    if (!files.length) return;                     // nichts frisch Geladenes → still
    setBelegMsg("Sende Belege …");
    try {
      const res = await onSendBelege({ files });
      setBelegMsg(`✓ ${res.sent || files.length} Beleg(e) an Steuerberater gesendet.`);
    } catch (e) {
      const m = e.message || "";
      // Auto-Versand ist ein Bonus: fehlt der Empfänger, NICHT nörgeln (viele senden selbst an DATEV).
      if (/Empfänger|recipient|no_recipient/i.test(m)) { setBelegMsg(""); return; }
      const msg = "Beleg-Versand fehlgeschlagen: " + m;
      setBelegMsg(msg); toastError(msg);
    }
  }

  function createSepa(accountId, execDate) {
    const account = accounts.find((a) => a.id === accountId);
    if (!account || !validateIban(account.iban).ok) { fail("Bitte gültiges Auftraggeberkonto wählen."); return; }
    if (!eligible.length) { fail("Keine zahlbaren Rechnungen ausgewählt."); return; }
    const eligibleRows = eligible.map((c) => c.r); // vor dem Status-Update merken (für Beleg-Versand)
    const payments = eligible.map(({ r, cents }) => ({
      name: r.creditorName || "Empfänger", iban: cleanIban(r.iban), bic: r.bic, amountCents: cents,
      purpose: purposeWithInvoiceNo(r.purpose, r.invoiceNumber), endToEndId: r.invoiceNumber || "NOTPROVIDED",
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
        payments: payments.map((p) => ({ name: p.name, iban: p.iban, amountCents: p.amountCents, purpose: p.purpose, invoiceNumber: p.invoiceNumber, note: p.note })),
      }, ...(dd.batches || [])],
    }), true);
    setShowModal(false); setError(""); setBelegMsg("");
    setSaved(`✓ „${filename}" gespeichert (Ordner „Downloads"). ${payments.length} Rechnung${payments.length === 1 ? "" : "en"}, Summe ${formatEur(sumEligible)}. Liegt auch im Archiv.`);
    setLastSepa({ xml, filename, batchId });

    // PDFs dieses Laufs dauerhaft im Hub ablegen (für späteres Re-Senden / EBICS-Forward).
    const belegeFiles = eligibleRows.map((r) => pdfStore.current.get(r.id)).filter(Boolean);
    if (onUploadBelege && belegeFiles.length) {
      onUploadBelege(batchId, belegeFiles).catch(() => setBelegMsg("Hinweis: Belege konnten nicht dauerhaft im Archiv abgelegt werden – ein späterer erneuter Versand aus dem Archiv ist evtl. nicht möglich."));
    }

    sendBelege(eligibleRows); // optional: Belege automatisch an Steuerberater
  }

  // Nach erfolgreichem EBICS-Versand: Belege dieses Laufs automatisch an Steuerberater.
  async function onEbicsSent() {
    if (!onSendRechnungBelege || !lastSepa?.batchId) return;
    setBelegMsg("EBICS gesendet – leite Belege an Steuerberater weiter …");
    try { const res = await onSendRechnungBelege(lastSepa.batchId); setBelegMsg(`✓ Per EBICS gesendet und ${res?.sent || ""} Beleg(e) an Steuerberater weitergeleitet.`); }
    catch (e) { setBelegMsg("Per EBICS gesendet. Beleg-Weiterleitung fehlgeschlagen: " + (e.message || "")); }
  }

  return (
    <div>
      <h1>Rechnungen</h1>
      <p className="sub">Rechnungs-PDFs einlesen, Zahlungsdaten prüfen und als eine SEPA-Datei auszahlen. E-Rechnungen (ZUGFeRD/XRechnung) werden exakt gelesen, sonst per Mustererkennung – immer mit Kontrolle.</p>

      {toCheck > 0 && (
        <div className="card" style={{ display: "flex", alignItems: "center", gap: 12, border: "1.5px solid var(--amber)", background: "rgba(231,177,90,.12)" }}>
          <span style={{ fontSize: 20 }}>📋</span>
          <div style={{ flex: 1, fontWeight: 700, color: "var(--amber)" }}>
            {toCheck} Rechnung{toCheck === 1 ? "" : "en"} {toCheck === 1 ? "wartet" : "warten"} auf deine Prüfung – erst nach „✓ Geprüft" {toCheck === 1 ? "kann sie" : "können sie"} per SEPA/EBICS ausgezahlt werden.
          </div>
        </div>
      )}

      <div className="card">
        {/* Kein restriktives accept: WKWebView (Tauri/macOS) graut .xml sonst aus. Die
            Endungsprüfung (.pdf/.xml) macht addFiles selbst. Auswahl über ein <label> (htmlFor)
            statt programmatischem .click() – das öffnet den Dateidialog im App-Fenster zuverlässig. */}
        <input ref={fileRef} id="rechnung-file-input" type="file" multiple style={{ display: "none" }}
          onChange={(e) => addFiles(e.target.files)} />
        <label
          htmlFor="rechnung-file-input"
          className={`dropzone ${drag ? "drag" : ""}`}
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files); }}
          style={{ marginBottom: 12, display: "block", cursor: "pointer" }}
        >
          {busy ? "Lese …" : "📄 Rechnungen (PDF oder XRechnung-XML) hierher ziehen oder klicken zum Auswählen"}
        </label>
        <div className="toolbar" style={{ marginTop: 0 }}>
          {mailbox && <button className="btn ghost" onClick={async () => { setMailBusy(true); try { await importMailInvoices(); } finally { setMailBusy(false); } }} disabled={busy || mailBusy} title="Wird automatisch im Hintergrund geprüft – hier kannst du sofort auf neu weitergeleitete Rechnungen prüfen">{mailBusy ? "Prüfe Eingang …" : "E-Mail-Eingang prüfen"}</button>}
          {onSendBelege && mayReview && <button className="btn ghost" onClick={sendBelegeNow} disabled={busy} title="Alle in dieser Sitzung geladenen Rechnungs-PDFs sofort an Steuerberater senden">An Steuerberater senden</button>}
          <span className="note">Mehrere Dateien auf einmal möglich. E-Rechnungen (ZUGFeRD/XRechnung) werden exakt gelesen.</span>
        </div>
        {scan && <p className="note" style={{ color: "var(--secondary, #5b8cff)" }}>{scan}</p>}
        {error && <p className="error-text">{error}</p>}
        {saved && <p className="note" style={{ color: "var(--ok, #3ddc97)" }}>{saved}</p>}
        {belegMsg && <p className="note" style={{ color: belegMsg.startsWith("✓") ? "var(--ok, #3ddc97)" : "var(--muted)" }}>{belegMsg}</p>}
      </div>

      <div className="summary-bar">
        <div className="stat"><div className="num">{eligible.length}</div><div className="lbl">zahlbar ausgewählt</div></div>
        <div className="stat"><div className="num">{formatEur(sumEligible)}</div><div className="lbl">Summe</div></div>
        <div className="spacer" style={{ flex: 1 }} />
        {canPay
          ? <button className="btn" disabled={!eligible.length} onClick={() => setShowModal(true)}>SEPA-Datei erstellen ({eligible.length})</button>
          : <span className="note" style={{ alignSelf: "center" }}>Nur Admins erstellen die SEPA-Datei (Vier-Augen-Prinzip).</span>}
      </div>

      {canPay && lastSepa && (
        <div className="card" style={{ marginTop: 0 }}>
          <p className="note" style={{ marginTop: 0 }}>Letzte erstellte Datei: <strong>{lastSepa.filename}</strong>. Du kannst sie erneut herunterladen oder – im Bank-Tarif – direkt per EBICS senden. Nach EBICS-Versand gehen die Belege automatisch an Steuerberater.</p>
          <div className="toolbar" style={{ marginBottom: 0, marginTop: 0 }}>
            <button className="btn ghost" onClick={() => downloadXml(lastSepa.xml, lastSepa.filename)}>SEPA-Datei erneut herunterladen</button>
            <EbicsSendButton data={data} xml={lastSepa.xml} meta={{ kind: "rechnung", filename: lastSepa.filename }} allowed={ebicsAllowed} onSent={onEbicsSent} />
          </div>
        </div>
      )}

      <div className="toolbar">
        <label className="muted" style={{ display: "flex", gap: 6, alignItems: "center" }}>Status
          <select value={fStatus} onChange={(e) => setFStatus(e.target.value)}>
            <option value="offen">offen</option><option value="erledigt">erledigt</option><option value="alle">alle</option>
          </select>
        </label>
        <span className="muted">{visible.length} Einträge</span>
      </div>

      {visible.map(({ r, cents, block }) => {
        // Auf „Ja" gesetzt, aber Pflichtfeld fehlt → harte Sperre + rote Markierung.
        const flagged = r.status === "offen" && r.selected !== false && r.checked && !!block;
        const cardStyle = flagged ? { border: "2px solid var(--red)", boxShadow: "0 0 0 1px var(--red)" }
          : (r.status === "offen" && !r.checked ? { borderLeft: "4px solid var(--amber)" } : undefined);
        const errBox = (field) => (flagged && block.field === field) ? { border: "2px solid var(--red)", background: "var(--red-bg)" } : undefined;
        return (
        <div className="card" key={r.id} style={cardStyle}>
          <div className="toolbar" style={{ marginTop: 0, alignItems: "center" }}>
            {r.status === "offen" && <input type="checkbox" checked={r.selected !== false} onChange={(e) => patchRow(r.id, { selected: e.target.checked })} title="In die SEPA-Datei aufnehmen (nur möglich, wenn geprüft und vollständig)" />}
            <strong>{r.creditorName || "— Lieferant —"}</strong>
            <span className="pill">{r.source === "e-rechnung" ? "E-Rechnung" : "PDF"}</span>
            {r.invoiceNumber && <span className="note">Nr. {r.invoiceNumber}</span>}
            {r.createdBy && <span className="note">· erfasst von {r.createdBy}</span>}
            <div className="spacer" />
            <span className="refund-amount ok">{formatEur(cents)}</span>
            {r.status === "offen" && (
              flagged
                ? <span className="pill bad" style={{ fontWeight: 700 }}>⛔ unvollständig</span>
                : r.checked
                  ? <span className="pill ok" title={r.checkedBy ? `geprüft von ${r.checkedBy}` : "geprüft"}>✓ geprüft{r.checkedBy ? ` von ${r.checkedBy}` : ""}</span>
                  : <span className="pill warn">ungeprüft</span>
            )}
            <span className={`pill ${r.status === "offen" ? "warn" : "ok"}`}>{r.status}</span>
            <button className="btn ghost small" onClick={() => setConfirmDel(r.id)}>✕</button>
          </div>
          {flagged && (
            <div style={{ margin: "10px 0 0", padding: "11px 14px", background: "var(--red-bg)", border: "1.5px solid var(--red)", borderRadius: 10, color: "var(--red)", fontWeight: 700, textAlign: "center" }}>
              ⛔ Als geprüft markiert, aber noch unvollständig: {block.msg}. Diese Rechnung wird NICHT ausgezahlt – bitte zuerst korrigieren.
            </div>
          )}
          <div className="row">
            <label className="field"><span>Lieferant</span>
              <input type="text" value={r.creditorName} style={errBox("creditor")} placeholder={flagged && block.field === "creditor" ? "Lieferant fehlt – bitte eintragen" : ""} onChange={(e) => patchRow(r.id, { creditorName: e.target.value })} /></label>
            <label className="field" style={{ minWidth: 280 }}><span>IBAN</span>
              <input type="text" value={r.iban} style={errBox("iban")} onChange={(e) => onIbanChange(r.id, e.target.value)} placeholder="DE…" />
              <span className="note">{r.iban ? (r.ibanValid ? `✓ ${formatIban(r.iban)}${r.bic ? " · " + r.bic : ""}` : `⚠︎ ${r.ibanReason || "ungültig"}`) : ""}</span>
            </label>
            <label className="field"><span>Betrag (€)</span>
              <input type="text" value={r.amount} style={errBox("amount")} onChange={(e) => patchRow(r.id, { amount: e.target.value })} /></label>
            {opts.skonto && <label className="field" style={{ maxWidth: 110 }}><span>Skonto %</span>
              <input type="number" min={0} max={20} value={r.skontoPct} onChange={(e) => patchRow(r.id, { skontoPct: e.target.value })} /></label>}
            {opts.useDueDate && <label className="field" style={{ maxWidth: 160 }}><span>Fällig am</span>
              <input type="date" value={r.dueDate || ""} onChange={(e) => patchRow(r.id, { dueDate: e.target.value })} /></label>}
            <label className="field"><span>Rechnungsnr.</span>
              <input type="text" value={r.invoiceNumber} onChange={(e) => patchRow(r.id, { invoiceNumber: e.target.value })} /></label>
            <label className="field col-full"><span>Verwendungszweck</span>
              <input type="text" value={r.purpose} onChange={(e) => patchRow(r.id, { purpose: e.target.value })} /></label>
            {r.status === "offen" && (
              <label className="field"><span>Geprüft &amp; freigegeben?</span>
                <select value={r.checked ? "ja" : "nein"} disabled={!mayReview}
                  onChange={(e) => {
                    const ja = e.target.value === "ja";
                    patchRow(r.id, ja
                      ? { checked: true, checkedBy: userName || "—", checkedAt: today() }
                      : { checked: false, checkedBy: null, checkedAt: null });
                  }}>
                  <option value="nein">Nein</option>
                  <option value="ja">Ja – geprüft</option>
                </select>
                {r.checked && r.checkedBy
                  ? <span className="note" style={{ fontSize: 11, color: "var(--ok, #3ddc97)" }}>✓ geprüft von {r.checkedBy}{r.checkedAt ? ` · ${deDate(r.checkedAt)}` : ""}</span>
                  : <span className="note" style={{ fontSize: 11 }}>{mayReview ? "Erst bei Ja auszahlbar." : "Nur freigegebene Mitarbeiter dürfen prüfen (Stammdaten)."}</span>}
              </label>
            )}
          </div>
        </div>
        );
      })}
      {visible.length === 0 && <div className="card muted" style={{ textAlign: "center", padding: 28 }}>Noch keine Rechnungen – lade oben PDFs.</div>}

      {showModal && <SepaModal accounts={accounts} count={eligible.length} sumCents={sumEligible} defaultDate={defaultExecDate()} onClose={() => setShowModal(false)} onCreate={createSepa} />}
      {confirmDel && <ConfirmModal name={(rows.find((x) => x.id === confirmDel)?.creditorName) || "diese Rechnung"} onCancel={() => setConfirmDel(null)} onConfirm={() => removeRow(confirmDel)} />}
      {warn && <DuplicateModal row={warn.row} reason={warn.reason} onClose={() => setWarn(null)} onRemove={() => { removeRow(warn.row.id); setWarn(null); }} onForwardOnly={onSendBelege ? () => forwardOnlyToDatev(warn.row) : null} />}
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

function DuplicateModal({ row, reason = "paid", onClose, onRemove, onForwardOnly }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.72)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 80, padding: 20 }} onClick={onClose}>
      <div className="card" style={{ width: 560, maxWidth: "94vw", border: "2px solid #ff5f5f" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontSize: 40, lineHeight: 1, marginBottom: 6 }}>⚠️</div>
        <h2 style={{ marginTop: 0, color: "#ff7b7b" }}>{reason === "noiban" ? "Keine Bankverbindung gefunden" : reason === "paid_ext" ? "Evtl. bereits bezahlt – bitte prüfen" : "Diese Rechnung wurde wahrscheinlich schon bezahlt!"}</h2>
        {reason === "noiban"
          ? <p style={{ fontSize: 15 }}>Diese Rechnung enthält <strong>keine IBAN/Bankverbindung</strong>. Sie ist deshalb <strong>nicht per SEPA überweisbar</strong> (z. B. ein Angebot/Proforma oder eine bereits per PayPal/Karte bezahlte Rechnung). Du kannst die IBAN unten manuell ergänzen – oder die Rechnung nur an den Steuerberater geben.</p>
          : reason === "paid_ext"
          ? <p style={{ fontSize: 15 }}>Der Beleg deutet auf eine <strong>bereits erfolgte Zahlung</strong> hin (z. B. Zahlungsart PayPal/Karte). iou.fm kennt nur Zahlungen, die <strong>über iou.fm</strong> liefen – externe Zahlungen kann es nicht erkennen. Bitte prüfen, bevor du sie in die SEPA-Datei nimmst.</p>
          : reason === "paidPair"
          ? <p style={{ fontSize: 15 }}>Es gibt bereits eine Zahlung an <strong>{row.creditorName}</strong> über <strong>{row.amount} €</strong> in einer früheren SEPA-Datei (gleicher Lieferant + Betrag, evtl. ohne Rechnungsnummer). Erneut zahlen = <strong>Doppelzahlung</strong>.</p>
          : <p style={{ fontSize: 15 }}>Rechnungsnummer <strong>{row.invoiceNumber}</strong>{row.creditorName ? <> ({row.creditorName})</> : ""} taucht bereits in einer früheren SEPA-Datei auf. Erneut zahlen = <strong>Doppelzahlung</strong>.</p>}
        <p className="note" style={{ fontSize: 14 }}>Auch eine bereits bezahlte Rechnung gehört in die Buchhaltung. Du kannst sie deshalb <strong>nur an Steuerberater weiterleiten</strong> – sie wird dann <strong>nicht</strong> erneut zur Zahlung hinzugefügt.</p>
        <div className="toolbar" style={{ marginBottom: 0, marginTop: 8 }}>
          <button className="btn danger" onClick={onRemove}>Entfernen</button>
          <div className="spacer" />
          {onForwardOnly && <button className="btn" onClick={onForwardOnly}>Nur an Steuerberater weiterleiten (nicht zahlen)</button>}
          <button className="btn ghost" onClick={onClose}>In Liste behalten</button>
        </div>
      </div>
    </div>
  );
}
