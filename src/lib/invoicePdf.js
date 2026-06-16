// Rechnungs-PDF -> Zahlungsdaten. Reihenfolge: (1) eingebettete E-Rechnung
// (ZUGFeRD/Factur-X/XRechnung XML) -> exakt; sonst (2) Text-Heuristik.
import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { parseInvoice } from "./invoiceParse.js";
import { cleanIban, validateIban } from "./iban.js";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

// Textzeilen aus dem PDF (nach y/x sortiert zu Zeilen gruppiert).
async function pdfText(pdf) {
  const lines = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const items = (await page.getTextContent()).items.filter((it) => it.str);
    const rows = {};
    for (const it of items) {
      const y = Math.round(it.transform[5]);
      (rows[y] = rows[y] || []).push({ x: it.transform[4], s: it.str });
    }
    Object.keys(rows).map(Number).sort((a, b) => b - a).forEach((y) => {
      lines.push(rows[y].sort((a, b) => a.x - b.x).map((c) => c.s).join(" ").replace(/\s+/g, " ").trim());
    });
  }
  return lines;
}

// --- E-Rechnungs-XML (CII / EN16931) ----------------------------------------
const localText = (root, name) => {
  const els = root.getElementsByTagName("*");
  for (const el of els) if (el.localName === name && el.textContent.trim()) return el.textContent.trim();
  return "";
};
const localUnder = (root, parent, child) => {
  const els = root.getElementsByTagName("*");
  for (const el of els) if (el.localName === parent) return localText(el, child);
  return "";
};
// IBAN robust im ganzen Dokument finden (format-agnostisch: CII wie UBL).
function findIbanInXml(doc) {
  for (const el of doc.getElementsByTagName("*")) {
    const t = (el.textContent || "").trim();
    if (t.length >= 15 && t.length <= 40 && /^[A-Z]{2}\s?\d/i.test(t)) {
      const c = cleanIban(t);
      if (validateIban(c).ok) return c;
    }
  }
  return "";
}
function firstAmountCents(doc, names) {
  for (const n of names) {
    const s = localText(doc, n);
    if (s) { const v = parseFloat(String(s).replace(/\s/g, "").replace(",", ".")); if (v > 0) return Math.round(v * 100); }
  }
  return 0;
}
// Erste direkte cbc:ID des Wurzelelements (UBL-Rechnungsnummer).
function rootChildId(doc) {
  const root = doc.documentElement; if (!root) return "";
  for (const el of Array.from(root.children || [])) if (el.localName === "ID" && (el.textContent || "").trim()) return el.textContent.trim();
  return "";
}
// Unterstützt ZUGFeRD/Factur-X (CII) UND XRechnung (UBL).
function parseEInvoiceXml(xmlStr) {
  let doc;
  try { doc = new DOMParser().parseFromString(xmlStr, "application/xml"); } catch { return null; }
  if (!doc || doc.getElementsByTagName("parsererror").length) return null;
  const iban = findIbanInXml(doc) || (localText(doc, "IBANID") ? cleanIban(localText(doc, "IBANID")) : "");
  const amountCents = firstAmountCents(doc, ["DuePayableAmount", "PayableAmount", "GrandTotalAmount", "TaxInclusiveAmount"]);
  // Fälligkeit: CII (YYYYMMDD) oder UBL (YYYY-MM-DD).
  let dueDate = "";
  const dtCii = localText(doc, "DueDateDateTime");
  if (/^\d{8}$/.test(dtCii)) dueDate = `${dtCii.slice(0, 4)}-${dtCii.slice(4, 6)}-${dtCii.slice(6, 8)}`;
  else { const dUbl = localText(doc, "DueDate"); if (/^\d{4}-\d{2}-\d{2}/.test(dUbl)) dueDate = dUbl.slice(0, 10); }
  const invoiceNumber = localUnder(doc, "ExchangedDocument", "ID") || rootChildId(doc) || localText(doc, "ID");
  const creditorName = localUnder(doc, "SellerTradeParty", "Name")           // CII
    || localUnder(doc, "PartyLegalEntity", "RegistrationName")               // UBL (juristischer Name)
    || localUnder(doc, "PartyName", "Name");                                 // UBL (Anzeigename)
  if (!iban && !amountCents && !invoiceNumber) return null;
  return { source: "e-rechnung", iban, ibans: iban ? [iban] : [], noIban: !iban, paidHint: false,
    bic: localText(doc, "BICID"), amountCents, dueDate, invoiceNumber, creditorName, hasText: true };
}

async function findEInvoiceXml(pdf) {
  let att = {};
  try { att = (await pdf.getAttachments()) || {}; } catch { return null; }
  for (const k of Object.keys(att)) {
    if (/\.xml$/i.test(k) || /factur-x|zugferd|xrechnung|cii/i.test(k)) {
      try {
        const xml = new TextDecoder("utf-8").decode(att[k].content);
        const parsed = parseEInvoiceXml(xml);
        if (parsed) return parsed;
      } catch { /* nächste Datei */ }
    }
  }
  return null;
}

// Öffentlich: eine Rechnungs-Datei -> bestmögliche Zahlungsdaten.
// opts.ownNames / opts.ownIbans = eigene Firma & Konten (Empfänger), die NICHT als
// Lieferant erkannt werden dürfen.
// PDF öffnen – mit einem Wiederholversuch, falls der pdf.js-Worker beim allerersten
// Aufruf noch nicht bereit ist (sonst „klappt erst beim 2. Mal"). Buffer je Versuch neu
// lesen, da getDocument den ArrayBuffer übernimmt.
async function openPdf(file) {
  try {
    return await pdfjs.getDocument({ data: await file.arrayBuffer(), isEvalSupported: false, useSystemFonts: false }).promise;
  } catch (e) {
    await new Promise((r) => setTimeout(r, 200));
    return await pdfjs.getDocument({ data: await file.arrayBuffer(), isEvalSupported: false, useSystemFonts: false }).promise;
  }
}

export async function extractInvoice(file, opts = {}) {
  // Reine XRechnung-/E-Rechnungs-XML-Datei (kein PDF) → direkt exakt auslesen.
  if (/\.xml$/i.test(file.name || "")) {
    const empty = { source: "e-rechnung", fileName: file.name, hasText: false, creditorName: "", iban: "", bic: "", amountCents: 0, invoiceNumber: "", dueDate: "", ibans: [], noIban: true, paidHint: false };
    try {
      const xml = new TextDecoder("utf-8").decode(await file.arrayBuffer());
      const e = parseEInvoiceXml(xml);
      return e ? { ...e, fileName: file.name } : empty;
    } catch { return empty; }
  }
  const pdf = await openPdf(file);
  const e = await findEInvoiceXml(pdf);
  if (e) return { ...e, fileName: file.name };
  let lines = await pdfText(pdf);
  let hasText = lines.join("").replace(/\s/g, "").length > 0;
  let source = "heuristik";
  // Kein Text in der PDF (Scan/Foto) → lokale OCR versuchen (Tesseract, im Gerät).
  if (!hasText) {
    try {
      const { ocrPdf } = await import("./ocr.js");
      const ocrLines = await ocrPdf(pdf, { onProgress: opts.onOcrProgress });
      if (ocrLines.join("").replace(/\s/g, "").length > 0) { lines = ocrLines; hasText = true; source = "ocr"; }
    } catch { /* OCR nicht verfügbar/fehlgeschlagen → leere Felder, Nutzer füllt manuell */ }
  }
  return { source, fileName: file.name, hasText, ...parseInvoice(lines, opts) };
}
