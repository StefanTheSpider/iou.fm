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
export async function extractInvoice(file) {
  const data = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data, isEvalSupported: false, useSystemFonts: false }).promise;
  const e = await findEInvoiceXml(pdf);
  if (e) return { ...e, fileName: file.name };
  const lines = await pdfText(pdf);
  return { source: "heuristik", fileName: file.name, ...parseInvoice(lines) };
}
