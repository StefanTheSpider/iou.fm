import { toast } from "./toast.js";
// Export der Überweisungs-Historie für die Buchhaltung:
//  - toCsv: einfache, gut lesbare CSV (Excel/jeder Buchhalter)
//  - toDatev: DATEV-Buchungsstapel (EXTF, Format 21). Konten & Berater-/
//    Mandantennummer kommen aus der Konfiguration; die genauen Sachkonten bitte
//    mit dem Steuerberater abstimmen (SKR03/04 unterschiedlich).

const KIND_LABEL = { lohn: "Lohn/Gehalt", erstattung: "Erstattung", sammel: "Sammelüberweisung", rechnung: "Rechnung" };
export const kindLabel = (k) => KIND_LABEL[k] || k || "";

const eur = (cents) => (Math.round(cents || 0) / 100).toFixed(2).replace(".", ",");
const csv = (s) => { const v = String(s ?? ""); return /[";\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; };
const ttmm = (iso) => { const m = /(\d{4})-(\d{2})-(\d{2})/.exec(iso || ""); return m ? `${m[3]}${m[2]}` : ""; };
const ymd = (iso) => (iso || "").replace(/-/g, "");
const isoToday = () => new Date().toISOString().slice(0, 10);

// Alle Batches in einzelne Zahlungszeilen auflösen.
export function flatten(batches) {
  const rows = [];
  for (const b of batches || []) {
    for (const p of b.payments || []) {
      rows.push({
        date: b.execDate || b.createdAt, created: b.createdAt, kind: b.kind,
        account: b.accountLabel, name: p.name, iban: p.iban, amountCents: p.amountCents,
        purpose: p.purpose, filename: b.filename,
      });
    }
  }
  return rows;
}

export function toCsv(rows) {
  const head = ["Ausführungsdatum", "Typ", "Empfänger", "IBAN", "Betrag EUR", "Verwendungszweck", "Auftraggeberkonto", "Datei"];
  const lines = [head.join(";")];
  let sum = 0;
  for (const r of rows) {
    sum += r.amountCents || 0;
    lines.push([r.date, kindLabel(r.kind), r.name, r.iban, eur(r.amountCents), r.purpose, r.account, r.filename].map(csv).join(";"));
  }
  lines.push(["", "", "", "Summe", eur(sum), "", "", ""].map(csv).join(";"));
  return "﻿" + lines.join("\r\n");
}

const KONTO_KEY = { lohn: "kontoLohn", erstattung: "kontoErstattung", sammel: "kontoSammel", rechnung: "kontoRechnung" };

function datevStamp() {
  const d = new Date(), p = (n, l = 2) => String(n).padStart(l, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}${p(d.getMilliseconds(), 3)}`;
}

// DATEV-Buchungsstapel (EXTF, Format 21, Version 700).
export function toDatev(rows, cfg = {}) {
  const c = {
    berater: "", mandant: "", wjBeginn: `${new Date().getFullYear()}0101`,
    bankKonto: "1200", kontoLohn: "4120", kontoErstattung: "4830", kontoSammel: "4980", ...cfg,
  };
  const dates = rows.map((r) => r.date).filter(Boolean).sort();
  const von = ymd(dates[0] || isoToday());
  const bis = ymd(dates[dates.length - 1] || isoToday());

  const header = [
    "EXTF", "700", "21", '"Buchungsstapel"', "13", datevStamp(), "", "", "", "",
    c.berater, c.mandant, c.wjBeginn, "4", von, bis, '"SEPA-Zahlungen"', "", "1", "",
    "0", '"EUR"', "", "", "", "", "", "", "", "", "",
  ].join(";");

  const caption = [
    "Umsatz (ohne Soll/Haben-Kz)", "Soll/Haben-Kennzeichen", "WKZ Umsatz", "Kurs", "Basis-Umsatz",
    "WKZ Basis-Umsatz", "Konto", "Gegenkonto (ohne BU-Schlüssel)", "BU-Schlüssel", "Belegdatum",
    "Belegfeld 1", "Belegfeld 2", "Skonto", "Buchungstext",
  ].map(csv).join(";");

  const lines = [header, caption];
  for (const r of rows) {
    const konto = c[KONTO_KEY[r.kind]] || c.kontoSammel || "";
    const beleg = (String(r.purpose || "").match(/\d{3,}/) || [""])[0];
    lines.push([
      eur(r.amountCents), "S", "EUR", "", "", "", konto, c.bankKonto, "", ttmm(r.date),
      beleg, "", "", String(r.purpose || "").slice(0, 60),
    ].map(csv).join(";"));
  }
  return "﻿" + lines.join("\r\n");
}

export function downloadText(content, filename, mime = "text/csv;charset=utf-8") {
  // UTF-8-BOM voranstellen, damit Excel ä/ö/ü korrekt zeigt (sonst „Ã¤").
  const withBom = content.charCodeAt(0) === 0xFEFF ? content : "﻿" + content;
  const blob = new Blob([withBom], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
  toast(`„${filename}" heruntergeladen · Ordner „Downloads"`);
}
