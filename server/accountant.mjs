// Monatlicher Buchhaltungs-Versand: baut aus dem Shopify-Feed eine CSV
// (Stornos + Erstattungen, nach Kategorie) und mailt sie per Resend-API.

const eur = (cents) => (Number(cents || 0) / 100).toFixed(2).replace(".", ",");
const deDate = (iso) => (iso ? String(iso).slice(0, 10).split("-").reverse().join(".") : "");
const csvCell = (s) => {
  const v = String(s ?? "");
  return /[";\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
};

// Kombiniert Stornos + Shopify-Erstattungen + App-/SEPA-Erstattungen zu EINER
// Zeile pro Vorgang – ohne Doppelzählung: ist eine Bestellung storniert UND
// erstattet, erscheint nur die Erstattung (das echte Geldereignis), markiert als
// „Storniert & erstattet". Reines Storno (ohne Refund) bleibt als „Stornierung".
const vz = (verb, orderNumber, event) => `${verb} ${orderNumber || ""}${event ? " " + event : ""}`.trim();
export function combinedEntries(feed, appRefunds = []) {
  const cancels = feed?.cancellations || [];
  const refunds = feed?.refunds || [];
  const cancelledOrders = new Set(cancels.map((c) => c.orderNumber));
  const refundedOrders = new Set(refunds.map((r) => r.orderNumber));
  const rows = [];
  for (const r of refunds) {
    rows.push({
      art: cancelledOrders.has(r.orderNumber) ? "Storniert & erstattet" : "Erstattung",
      event: r.event, date: r.date, customer: r.customer, orderNumber: r.orderNumber,
      category: r.category, amountCents: r.amountCents, paidCents: r.paidCents ?? r.amountCents,
      purpose: r.purpose || vz("Erstattung", r.orderNumber, r.event),
    });
  }
  for (const c of cancels) {
    if (refundedOrders.has(c.orderNumber)) continue; // schon über die Erstattung abgebildet
    rows.push({
      art: "Stornierung", event: c.event, date: c.date, customer: c.customer, orderNumber: c.orderNumber,
      category: c.category, amountCents: c.amountCents, paidCents: c.amountCents,
      purpose: vz("Stornierung", c.orderNumber, c.event),
    });
  }
  for (const a of (appRefunds || [])) {
    rows.push({
      art: "Erstattung (App/SEPA)", event: a.event, date: a.date, customer: a.customer, orderNumber: a.orderNumber,
      category: a.category || "", amountCents: a.amountCents, paidCents: a.paidCents ?? a.amountCents,
      purpose: a.purpose || vz("Erstattung", a.orderNumber, a.event),
    });
  }
  return rows;
}
export function entriesForMonth(feed, ym, appRefunds = []) {
  return combinedEntries(feed, appRefunds)
    .filter((r) => String(r.date || "").slice(0, 7) === ym)
    .sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")));
}

// CSV (deutsch: ; getrennt, Komma als Dezimal) für die Buchhaltung.
export function buildAccountantCsv(feed, ym, appRefunds = []) {
  const head = ["Art", "Veranstaltung", "Datum", "Kunde", "Bestellnummer", "Kategorie", "Verwendungszweck", "Urspr. gezahlt (EUR)", "Erstattet/Storniert (EUR)"];
  const entries = entriesForMonth(feed, ym, appRefunds);
  const rows = entries.map((r) => [
    r.art, r.event || "", deDate(r.date), r.customer || "", r.orderNumber || "", r.category || "",
    r.purpose || "", eur(r.paidCents), eur(r.amountCents),
  ]);
  const sum = entries.reduce((s, r) => s + (r.amountCents || 0), 0);
  rows.push([]);
  rows.push(["Summe", "", "", "", "", "", "", "", eur(sum)]);
  // UTF-8-BOM voranstellen, damit Excel ä/ö/ü korrekt anzeigt (sonst „Ã¤").
  return "﻿" + [head, ...rows].map((row) => row.map(csvCell).join(";")).join("\r\n");
}

// Vormonat als "YYYY-MM" relativ zu einem Stichtag (Standard: heute).
export function prevMonthKey(d = new Date()) {
  const y = d.getFullYear(), m = d.getMonth(); // 0-basiert
  const pm = m === 0 ? 12 : m;                  // Vormonat 1-12
  const py = m === 0 ? y - 1 : y;
  return `${py}-${String(pm).padStart(2, "0")}`;
}
// Aktueller Monat als "YYYY-MM".
export function thisMonthKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// Ist d der letzte Tag des Monats? (für den Monatsend-Versand)
export function isLastDayOfMonth(d = new Date()) {
  const t = new Date(d);
  t.setDate(t.getDate() + 1);
  return t.getDate() === 1;
}

// Versand über Resend (HTTP-API, keine Abhängigkeit nötig).
export async function sendViaResend({ apiKey, from, to, cc, subject, text, filename, csv }) {
  const body = {
    from, to: Array.isArray(to) ? to : [to],
    ...(cc ? { cc: Array.isArray(cc) ? cc : [cc] } : {}),
    subject, text,
    attachments: [{ filename, content: Buffer.from(csv, "utf8").toString("base64") }],
  };
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json().catch(() => ({}));
}
