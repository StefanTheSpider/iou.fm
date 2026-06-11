// Monatlicher Buchhaltungs-Versand: baut aus dem Shopify-Feed eine CSV
// (Stornos + Erstattungen, nach Kategorie) und mailt sie per Resend-API.

const eur = (cents) => (Number(cents || 0) / 100).toFixed(2).replace(".", ",");
const deDate = (iso) => (iso ? String(iso).slice(0, 10).split("-").reverse().join(".") : "");
const csvCell = (s) => {
  const v = String(s ?? "");
  return /[";\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
};

// Liefert die Einträge (Stornos + Shopify-Erstattungen + App-/SEPA-Erstattungen)
// eines Monats "YYYY-MM". appRefunds = im iou.fm per Überweisung erstattete Fälle.
export function entriesForMonth(feed, ym, appRefunds = []) {
  const rows = [
    ...(feed?.cancellations || []).map((c) => ({ art: "Stornierung", ...c })),
    ...(feed?.refunds || []).map((r) => ({ art: "Erstattung", ...r })),
    ...(appRefunds || []).map((r) => ({ art: "Erstattung (App/SEPA)", ...r })),
  ];
  return rows
    .filter((r) => String(r.date || "").slice(0, 7) === ym)
    .sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")));
}

// CSV (deutsch: ; getrennt, Komma als Dezimal) für die Buchhaltung.
export function buildAccountantCsv(feed, ym, appRefunds = []) {
  const head = ["Art", "Veranstaltung", "Datum", "Kunde", "Bestellnummer", "Kategorie", "Betrag (EUR)"];
  const entries = entriesForMonth(feed, ym, appRefunds);
  const rows = entries.map((r) => [
    r.art, r.event || "", deDate(r.date), r.customer || "", r.orderNumber || "", r.category || "", eur(r.amountCents),
  ]);
  const sum = entries.reduce((s, r) => s + (r.amountCents || 0), 0);
  rows.push([]);
  rows.push(["Summe", "", "", "", "", "", eur(sum)]);
  return [head, ...rows].map((row) => row.map(csvCell).join(";")).join("\r\n");
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
