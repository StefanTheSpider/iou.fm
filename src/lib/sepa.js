// SEPA-Überweisung pain.001.001.09 erzeugen.
// Beträge werden intern in Cent (Ganzzahl) geführt, um Rundungsfehler zu vermeiden.
import { toast } from "./toast.js";

const SEPA_ALLOWED = /[^A-Za-z0-9/?:().,'+\-\s]/g;

// Zeichen SEPA-konform machen: Umlaute transliterieren, Rest auf erlaubte Zeichen.
export function sanitizeSepaText(text) {
  if (!text) return "";
  return String(text)
    .normalize("NFD").replace(/[̀-ͯ]/g, "") // Akzente weg, aber:
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue")
    .replace(/Ä/g, "Ae").replace(/Ö/g, "Oe").replace(/Ü/g, "Ue")
    .replace(/ß/g, "ss")
    .replace(SEPA_ALLOWED, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function xmlEscape(s) {
  return String(s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

export function centsToAmount(cents) {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(Math.round(cents));
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

function isoNow() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

function trimBic(raw) {
  let bic = (raw || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (bic.length === 8) bic += "XXX";
  return bic.length === 11 ? bic : "";
}

/**
 * @param {Object} p
 * @param {{name,iban,bic}} p.debtor  Auftraggeberkonto
 * @param {string} p.executionDate    YYYY-MM-DD
 * @param {Array<{name,iban,bic,amountCents,purpose,endToEndId}>} p.payments
 * @param {"SALA"|null} p.category     SEPA-Kategorie (SALA = Lohn/Gehalt)
 * @param {string} [p.msgId]
 */
export function buildSepaXml({ debtor, executionDate, payments, category = null, msgId }) {
  const id = msgId || `SEPA${Date.now()}`;
  const totalCents = payments.reduce((s, p) => s + Math.round(p.amountCents), 0);
  const nbTx = payments.length;
  const ctrlSum = centsToAmount(totalCents);
  const debtorBic = trimBic(debtor.bic);

  const lines = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push('<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.001.001.09" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">');
  lines.push("  <CstmrCdtTrfInitn>");
  // --- Group Header ---
  lines.push("    <GrpHdr>");
  lines.push(`      <MsgId>${xmlEscape(id)}</MsgId>`);
  lines.push(`      <CreDtTm>${isoNow()}</CreDtTm>`);
  lines.push(`      <NbOfTxs>${nbTx}</NbOfTxs>`);
  lines.push(`      <CtrlSum>${ctrlSum}</CtrlSum>`);
  lines.push("      <InitgPty>");
  lines.push(`        <Nm>${xmlEscape(sanitizeSepaText(debtor.name))}</Nm>`);
  lines.push("      </InitgPty>");
  lines.push("    </GrpHdr>");
  // --- Payment Information ---
  lines.push("    <PmtInf>");
  lines.push(`      <PmtInfId>${xmlEscape(id)}-PMT</PmtInfId>`);
  lines.push("      <PmtMtd>TRF</PmtMtd>");
  lines.push("      <BtchBookg>false</BtchBookg>");
  lines.push(`      <NbOfTxs>${nbTx}</NbOfTxs>`);
  lines.push(`      <CtrlSum>${ctrlSum}</CtrlSum>`);
  lines.push("      <PmtTpInf>");
  lines.push("        <SvcLvl><Cd>SEPA</Cd></SvcLvl>");
  if (category) lines.push(`        <CtgyPurp><Cd>${category}</Cd></CtgyPurp>`);
  lines.push("      </PmtTpInf>");
  lines.push(`      <ReqdExctnDt><Dt>${executionDate}</Dt></ReqdExctnDt>`);
  lines.push("      <Dbtr>");
  lines.push(`        <Nm>${xmlEscape(sanitizeSepaText(debtor.name))}</Nm>`);
  lines.push("      </Dbtr>");
  lines.push(`      <DbtrAcct><Id><IBAN>${xmlEscape(debtor.iban.replace(/\s/g, ""))}</IBAN></Id></DbtrAcct>`);
  if (debtorBic) {
    lines.push(`      <DbtrAgt><FinInstnId><BICFI>${debtorBic}</BICFI></FinInstnId></DbtrAgt>`);
  } else {
    lines.push("      <DbtrAgt><FinInstnId><Othr><Id>NOTPROVIDED</Id></Othr></FinInstnId></DbtrAgt>");
  }
  lines.push("      <ChrgBr>SLEV</ChrgBr>");
  // --- Transactions ---
  for (const p of payments) {
    const e2e = sanitizeSepaText(p.endToEndId || "NOTPROVIDED").slice(0, 35) || "NOTPROVIDED";
    const bic = trimBic(p.bic);
    lines.push("      <CdtTrfTxInf>");
    lines.push(`        <PmtId><EndToEndId>${xmlEscape(e2e)}</EndToEndId></PmtId>`);
    lines.push(`        <Amt><InstdAmt Ccy="EUR">${centsToAmount(p.amountCents)}</InstdAmt></Amt>`);
    if (bic) lines.push(`        <CdtrAgt><FinInstnId><BICFI>${bic}</BICFI></FinInstnId></CdtrAgt>`);
    lines.push("        <Cdtr>");
    lines.push(`          <Nm>${xmlEscape(sanitizeSepaText(p.name))}</Nm>`);
    lines.push("        </Cdtr>");
    lines.push(`        <CdtrAcct><Id><IBAN>${xmlEscape(p.iban.replace(/\s/g, ""))}</IBAN></Id></CdtrAcct>`);
    lines.push(`        <RmtInf><Ustrd>${xmlEscape(sanitizeSepaText(p.purpose))}</Ustrd></RmtInf>`);
    lines.push("      </CdtTrfTxInf>");
  }
  lines.push("    </PmtInf>");
  lines.push("  </CstmrCdtTrfInitn>");
  lines.push("</Document>");
  return lines.join("\n");
}

// Hilfsfunktion: Download im Browser auslösen.
export function downloadXml(xml, filename) {
  const blob = new Blob([xml], { type: "application/xml" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  toast(`„${filename}" heruntergeladen · Ordner „Downloads"`);
}
