// Per E-Mail an die belege-Adresse weitergeleitete Rechnungen aus dem Beleg-Archiv
// einlesen und als Rechnungs-Entwürfe aufbereiten. Läuft sowohl app-weit im Hintergrund
// (sobald eine Mail eingeht) als auch beim manuellen „Eingang prüfen". Schreibt NICHT
// selbst – der Aufrufer mischt newRows/newSeen in data.invoices / data.invoiceMailSeen.
import { extractInvoice } from "./invoicePdf.js";
import { validateIban, cleanIban, inspectIban } from "./iban.js";

const today = () => new Date().toISOString().slice(0, 10);
const invoiceKey = (invoiceNumber, iban, amountCents) =>
  `${String(invoiceNumber || "").toLowerCase().trim()}|${String(iban || "").replace(/\s/g, "").toUpperCase()}|${Math.round(amountCents || 0)}`;
const rowKey = (r) => invoiceKey(r.invoiceNumber, r.iban, Math.round(parseFloat(r.amount || 0) * 100));

async function ibanMeta(iban) {
  const v = validateIban(iban);
  if (!v.ok) return { ibanValid: false, ibanReason: v.reason || "ungültig", bic: "" };
  let bic = "";
  try { bic = (await inspectIban(iban, { online: false })).bic || ""; } catch { /* offline */ }
  return { ibanValid: true, ibanReason: "", bic };
}

// mailbox: { belege(), files(beId), fileBytes(beId, name) }
export async function fetchMailInvoices({ mailbox, invoices = [], creditors = {}, accounts = [], seenIds = [] }) {
  if (!mailbox) return { newRows: [], newSeen: [], dup: 0, failed: 0 };
  const belege = await mailbox.belege();
  const seen = new Set([...(invoices || []).map((r) => r.belegId).filter(Boolean), ...(seenIds || [])]);
  const ownNames = (accounts || []).flatMap((a) => [a.name, a.label]).filter(Boolean);
  const ownIbans = (accounts || []).map((a) => a.iban).filter(Boolean);
  const dupKeys = new Set((invoices || []).map(rowKey).filter((k) => k !== "||0"));
  const newRows = []; const newSeen = []; let dup = 0; let failed = 0;
  for (const b of (belege || [])) {
    if (seen.has(b.id)) continue;
    newSeen.push(b.id);
    let files = [];
    try { files = await mailbox.files(b.id); } catch { failed++; continue; }
    // Echte Anhänge (PDF inkl. ZUGFeRD, oder reine XRechnung-XML) bevorzugt, sonst Body-PDF.
    const atts = files.filter((f) => /\.(pdf|xml)$/i.test(f.name) && !/_beleg\.pdf$/i.test(f.name));
    const pick = atts.length ? atts : files.filter((f) => /_beleg\.pdf$/i.test(f.name));
    for (const f of pick) {
      let ab; try { ab = await mailbox.fileBytes(b.id, f.name); } catch { failed++; continue; }
      const cleanName = f.name.replace(/^[0-9a-f-]{36}_/i, "");
      const wrapper = { name: cleanName, arrayBuffer: () => Promise.resolve(ab.slice(0)) };
      let ex; try { ex = await extractInvoice(wrapper, { ownNames, ownIbans }); } catch { failed++; continue; }
      const iban = ex.iban ? cleanIban(ex.iban) : "";
      if (!iban || !validateIban(iban).ok) continue; // ohne zahlbare IBAN keine Rechnung (Tickets etc.)
      const invoiceNumber = ex.invoiceNumber || "";
      const dKey = invoiceKey(invoiceNumber, iban, ex.amountCents);
      if (dupKeys.has(dKey)) { dup++; continue; } // schon vorhanden → nicht zweimal anlegen
      dupKeys.add(dKey);
      const meta = await ibanMeta(iban);
      const creditorName = (creditors[iban]?.name) || ex.creditorName || "";
      newRows.push({
        id: crypto.randomUUID(), belegId: b.id, fileName: cleanName, source: ex.source || "email",
        creditorName, iban, ibanValid: meta.ibanValid, ibanReason: meta.ibanReason, bic: meta.bic || ex.bic || "",
        amount: ex.amountCents ? (ex.amountCents / 100).toFixed(2) : "", invoiceNumber, dueDate: ex.dueDate || "",
        purpose: `Rechnung ${invoiceNumber}${creditorName ? " " + creditorName : ""}`.trim(),
        skontoPct: "", note: `per E-Mail von ${(b.from || "").slice(0, 80)}`, status: "offen",
        selected: !(ex.paidHint || ex.noIban), checked: false, createdBy: "E-Mail-Eingang", createdAt: today(),
      });
    }
  }
  return { newRows, newSeen, dup, failed };
}
