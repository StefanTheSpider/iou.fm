import { useMemo, useState, useEffect, useCallback } from "react";
import { formatEur } from "../lib/money.js";
import { toast } from "../lib/toast.js";

const deDate = (iso) => (iso ? String(iso).slice(0, 10).split("-").reverse().join(".") : "");
const csvCell = (s) => { const v = String(s ?? ""); return /[";\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; };

const MONTHS = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
const monthLabel = (ym) => { const [y, m] = String(ym).split("-"); return `${MONTHS[Number(m) - 1] || m} ${y}`; };

function downloadCsv(filename, text) {
  const blob = new Blob(["﻿" + text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.rel = "noopener";
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

// Versand-Archiv: ausgeführte (fulfilled) Bestellungen – Kunde, Bestellnr., Betrag, Zahlungsmethode,
// Veranstaltung, Veranstaltungsdatum und Ausführungsdatum (Versanddatum). Lazy vom Hub geladen.
export default function Versand({ load = null }) {
  const [all, setAll] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");
  const [month, setMonth] = useState("");   // "" = alle Zeiträume, sonst YYYY-MM (nach Ausführungsdatum)
  const [pay, setPay] = useState("");       // "" = alle Zahlungsmethoden
  const [cat, setCat] = useState("");       // "" = alle Kategorien
  const [sortBy, setSortBy] = useState("date"); // date | eventDate | amount

  const refresh = useCallback(async () => {
    if (!load) return;
    setBusy(true); setErr("");
    try { const r = await load(); setAll((r && r.fulfillments) || []); }
    catch (e) { setErr(e.message || "Versand-Archiv konnte nicht geladen werden."); }
    finally { setBusy(false); }
  }, [load]);

  useEffect(() => { refresh(); /* beim Öffnen laden */ // eslint-disable-next-line
  }, []);

  // Auswahllisten aus den Daten ableiten (nur was wirklich vorkommt).
  const months = useMemo(() => [...new Set(all.map((f) => String(f.date || "").slice(0, 7)).filter(Boolean))].sort().reverse(), [all]);
  const pays = useMemo(() => [...new Set(all.map((f) => f.paymentMethod).filter(Boolean))].sort(), [all]);
  const cats = useMemo(() => [...new Set(all.map((f) => f.category).filter(Boolean))].sort(), [all]);

  const rows = useMemo(() => {
    const ql = q.trim().toLowerCase();
    const arr = all.filter((f) => {
      if (ql && !`${f.orderNumber || ""} ${f.customer || ""} ${f.event || ""}`.toLowerCase().includes(ql)) return false;
      if (month && String(f.date || "").slice(0, 7) !== month) return false;
      if (pay && f.paymentMethod !== pay) return false;
      if (cat && f.category !== cat) return false;
      return true;
    });
    const key = sortBy === "amount" ? (f) => String(f.amountCents ?? 0).padStart(12, "0")
      : sortBy === "eventDate" ? (f) => String(f.eventDate || "")
      : (f) => String(f.date || f.orderDate || "");
    return arr.sort((a, b) => key(b).localeCompare(key(a)));
  }, [all, q, month, pay, cat, sortBy]);

  const sumCents = useMemo(() => rows.reduce((s, f) => s + (f.amountCents || 0), 0), [rows]);
  const resetFilters = () => { setQ(""); setMonth(""); setPay(""); setCat(""); setSortBy("date"); };
  const filtered = q || month || pay || cat;

  function exportCsv() {
    const head = ["Kunde", "Bestellnummer", "Betrag (EUR)", "Zahlungsmethode", "Veranstaltung", "Veranstaltungsdatum", "Ausführungsdatum", "Kategorie", "Bestelldatum"];
    const body = rows.map((f) => [
      f.customer || "", f.orderNumber || "", ((f.amountCents || 0) / 100).toFixed(2).replace(".", ","),
      f.paymentMethod || "", f.event || "", deDate(f.eventDate), deDate(f.date), f.category || "", deDate(f.orderDate),
    ]);
    const csv = [head, ...body].map((r) => r.map(csvCell).join(";")).join("\r\n");
    const tag = month ? `_${month}` : "";
    downloadCsv(`Versand-Archiv${tag}_${new Date().toISOString().slice(0, 10)}.csv`, csv);
    toast(`Versand-Archiv exportiert (${rows.length} Bestellungen · Ordner „Downloads").`);
  }

  return (
    <div>
      <h1>Versand-Archiv</h1>
      <p className="sub">
        Alle in Shopify <strong>ausgeführten</strong> (versendeten) Bestellungen – mit Kunde, Bestellnummer, Betrag,
        Zahlungsmethode, Veranstaltung, Veranstaltungsdatum und <strong>Ausführungsdatum</strong>. Wird automatisch beim Abgleich befüllt.
      </p>

      <div className="card">
        <div className="toolbar" style={{ marginTop: 0 }}>
          <button className="btn ghost" onClick={refresh} disabled={busy}>{busy ? "Lädt…" : "Aktualisieren"}</button>
          <button className="btn" onClick={exportCsv} disabled={!rows.length}>Als CSV exportieren</button>
          <div className="spacer" />
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Suche: Bestellnr., Kunde oder Veranstaltung" style={{ minWidth: 240 }} />
        </div>

        <div className="toolbar" style={{ marginTop: 10, flexWrap: "wrap", gap: 8 }}>
          <label className="muted" style={{ fontSize: 13 }}>Zeitraum
            <select value={month} onChange={(e) => setMonth(e.target.value)} style={{ marginLeft: 6 }}>
              <option value="">Alle</option>
              {months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
            </select>
          </label>
          <label className="muted" style={{ fontSize: 13 }}>Zahlungsmethode
            <select value={pay} onChange={(e) => setPay(e.target.value)} style={{ marginLeft: 6 }}>
              <option value="">Alle</option>
              {pays.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </label>
          <label className="muted" style={{ fontSize: 13 }}>Kategorie
            <select value={cat} onChange={(e) => setCat(e.target.value)} style={{ marginLeft: 6 }}>
              <option value="">Alle</option>
              {cats.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <label className="muted" style={{ fontSize: 13 }}>Sortierung
            <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} style={{ marginLeft: 6 }}>
              <option value="date">Ausführungsdatum (neueste)</option>
              <option value="eventDate">Veranstaltungsdatum</option>
              <option value="amount">Betrag (höchste)</option>
            </select>
          </label>
          {filtered && <button className="btn ghost" onClick={resetFilters} style={{ padding: "4px 10px" }}>Filter zurücksetzen</button>}
          <div className="spacer" />
          <span className="muted">{rows.length} Bestellungen · Summe <strong>{formatEur(sumCents)}</strong></span>
        </div>
        {err && <p className="error-text" style={{ margin: "8px 0 0" }}>{err}</p>}
      </div>

      <div className="refunds">
        {rows.map((f) => (
          <div key={f.orderNumber} className="refund-card">
            <div className="refund-head">
              <div className="who-wrap">
                <strong>{f.customer || "—"}</strong>
                <div className="head-meta">
                  <span className="ord-input" style={{ padding: "2px 8px" }}>#{f.orderNumber}</span>
                  {f.event && <span className="pill">{f.event}</span>}
                  {f.eventDate && <span className="pill" title="Veranstaltungsdatum">🗓 {deDate(f.eventDate)}</span>}
                  {f.date && <span className="pill" title="Ausführungsdatum (versendet am)">📦 {deDate(f.date)}</span>}
                  {f.paymentMethod && <span className="muted" style={{ fontSize: 12 }}>{f.paymentMethod}</span>}
                </div>
              </div>
              <div className="spacer" />
              <div className="amt-wrap">
                <span className="refund-amount ok">{formatEur(f.amountCents)}</span>
                {f.category && <span className="amt-sub">{f.category}</span>}
              </div>
            </div>
          </div>
        ))}
        {!rows.length && (
          <div className="card muted" style={{ textAlign: "center", padding: 28 }}>
            {all.length
              ? "Keine Bestellungen für diese Filter. Filter zurücksetzen, um alle zu sehen."
              : "Noch keine ausgeführten Bestellungen im Archiv. Sobald Bestellungen in Shopify als ausgeführt bzw. versendet markiert sind, erscheinen sie hier (nach dem nächsten Abgleich)."}
          </div>
        )}
      </div>
    </div>
  );
}
