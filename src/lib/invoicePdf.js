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
function parseEInvoiceXml(xmlStr) {
  let doc;
  try { doc = new DOMParser().parseFromString(xmlStr, "application/xml"); } catch { return null; }
  if (!doc || doc.getElementsByTagName("parsererror").length) return null;
  const ibanRaw = localText(doc, "IBANID");
  const iban = ibanRaw ? cleanIban(ibanRaw) : "";
  if (iban && !validateIban(iban).ok) { /* trotzdem übernehmen, Nutzer prüft */ }
  const amountStr = localText(doc, "DuePayableAmount") || localText(doc, "GrandTotalAmount");
  const amountCents = amountStr ? Math.round(parseFloat(amountStr) * 100) : 0;
  const dt = localText(doc, "DueDateDateTime") || ""; // Format meist YYYYMMDD
  const dueDate = /^\d{8}$/.test(dt) ? `${dt.slice(0, 4)}-${dt.slice(4, 6)}-${dt.slice(6, 8)}` : "";
  const invoiceNumber = localUnder(doc, "ExchangedDocument", "ID") || localText(doc, "ID");
  const creditorName = localUnder(doc, "SellerTradeParty", "Name");
  if (!iban && !amountCents && !invoiceNumber) return null;
  return { source: "e-rechnung", iban, ibans: iban ? [iban] : [], bic: localText(doc, "BICID"),
    amountCents, dueDate, invoiceNumber, creditorName };
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
