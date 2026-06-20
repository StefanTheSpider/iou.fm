import { useState, useEffect, useCallback, useMemo } from "react";
import { sha256Hex, belegHashFromFiles, dedupeByHash, buildSealedManifest, verifyManifest, manifestToCsv } from "../lib/belegeArchive.js";
import { toast, toastError } from "../lib/toast.js";

// Datei-Download (Tauri-WebView blockiert window.open; Blob + <a download> → „Downloads").
function downloadText(filename, text, type = "application/json") {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.rel = "noopener";
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
const short = (h) => (h ? `${h.slice(0, 8)}…${h.slice(-6)}` : "");
const cleanName = (n) => String(n || "").replace(/^[0-9a-f-]{36}_/i, "");

// Revisionssichere E-Mail-/Beleg-Aufbewahrung: eingehende Belege (v. a. Bestellbestätigungen)
// unveränderbar archivieren, Duplikate über den Inhalts-Hash ausschließen, versiegelt exportieren.
export default function Belege({ data, updateData, inbox, canPay = true }) {
  const archive = data.belegeArchive || {};
  const [busy, setBusy] = useState("");
  const [progress, setProgress] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [integrity, setIntegrity] = useState(null);

  const entries = useMemo(() => Object.values(archive), [archive]);
  const { unique, duplicates } = useMemo(() => dedupeByHash(entries), [entries]);

  // Neue Belege indexieren (Hash berechnen) – append-only, schon archivierte nie neu berechnen.
  const refresh = useCallback(async () => {
    if (!inbox) return;
    setBusy("load"); setErr("");
    try {
      const list = (await inbox.belege()) || [];
      const idx = {}; let added = 0;
      for (const b of list) {
        if (archive[b.id]) continue;                 // bereits archiviert
        setProgress(`Archiviere „${b.subject || b.id}" …`);
        let files = [];
        try { files = await inbox.files(b.id); } catch { continue; }
        const fileEntries = [];
        for (const f of files) {
          try {
            const ab = await inbox.fileBytes(b.id, f.name);
            fileEntries.push({ name: cleanName(f.name), sha256: await sha256Hex(new Uint8Array(ab)) });
          } catch { /* Datei überspringen */ }
        }
        if (!fileEntries.length) continue;
        const hash = await belegHashFromFiles(fileEntries.map((f) => f.sha256));
        idx[b.id] = {
          belegId: b.id, hash, from: b.from || "", subject: b.subject || "",
          date: String(b.date || b.receivedAt || b.createdAt || "").slice(0, 10),
          files: fileEntries, archivedAt: new Date().toISOString(),
        };
        added++;
      }
      setProgress("");
      if (added) {
        updateData((d) => ({ ...d, belegeArchive: { ...(d.belegeArchive || {}), ...idx } }), true);
        toast(`📎 ${added} neue${added === 1 ? "r Beleg" : " Belege"} revisionssicher archiviert.`);
      }
    } catch (e) { setErr(e.message || "Belege konnten nicht geladen werden."); }
    finally { setBusy(""); setProgress(""); }
  }, [inbox, archive, updateData]);

  useEffect(() => { refresh(); /* beim Öffnen einmal */ // eslint-disable-next-line
  }, []);

  // Versiegeltes Manifest (JSON + CSV) erzeugen.
  async function exportManifest() {
    setErr(""); setMsg(""); setBusy("export");
    try {
      const manifest = await buildSealedManifest(unique);
      const stamp = new Date().toISOString().slice(0, 10);
      downloadText(`belege-manifest_${stamp}.json`, JSON.stringify(manifest, null, 2));
      downloadText(`belege-manifest_${stamp}.csv`, manifestToCsv(manifest), "text/csv");
      setMsg(`Versiegeltes Manifest erstellt (Ordner „Downloads"): ${manifest.count} Belege, Siegel ${short(manifest.sealHash)}. JSON + CSV für den Steuerberater.`);
    } catch (e) { setErr(e.message || "Export fehlgeschlagen."); } finally { setBusy(""); }
  }

  // Integrität prüfen: Dateien erneut hashen und mit dem archivierten Hash vergleichen.
  async function checkIntegrity() {
    setErr(""); setMsg(""); setBusy("verify"); setIntegrity(null);
    try {
      let okCount = 0; const broken = [];
      for (const e of unique) {
        setProgress(`Prüfe „${e.subject || e.belegId}" …`);
        const fileHashes = [];
        for (const f of (e.files || [])) {
          try {
            const ab = await inbox.fileBytes(e.belegId, f.name);
            fileHashes.push(await sha256Hex(new Uint8Array(ab)));
          } catch { /* Datei fehlt */ }
        }
        const hash = await belegHashFromFiles(fileHashes);
        if (hash === e.hash) okCount++; else broken.push(e);
      }
      setProgress("");
      setIntegrity({ okCount, broken });
      if (broken.length) toastError(`${broken.length} Beleg(e) verändert oder nicht mehr abrufbar!`);
      else toast(`✓ Alle ${okCount} Belege unverändert.`);
    } catch (e) { setErr(e.message || "Prüfung fehlgeschlagen."); } finally { setBusy(""); setProgress(""); }
  }

  return (
    <div>
      <h1>Belege · revisionssicher</h1>
      <p className="sub">
        Eingehende Belege (z. B. Bestellbestätigungen) werden hier unveränderbar archiviert – mit Inhalts-Hash und
        Zeitstempel. Doppelte E-Mails werden über den Hash automatisch zu <strong>einem</strong> Eintrag zusammengefasst.
      </p>

      <div className="card">
        <div className="toolbar" style={{ marginTop: 0 }}>
          <button className="btn ghost" onClick={refresh} disabled={!!busy}>{busy === "load" ? "Lade…" : "Eingang prüfen"}</button>
          <button className="btn" onClick={exportManifest} disabled={!!busy || !unique.length}>Versiegeltes Manifest exportieren</button>
          <button className="btn ghost" onClick={checkIntegrity} disabled={!!busy || !unique.length}>Integrität prüfen</button>
          <div className="spacer" />
          <span className="muted">{unique.length} Belege{duplicates.length ? ` · ${duplicates.length} Duplikat${duplicates.length === 1 ? "" : "e"} ausgefiltert` : ""}</span>
        </div>
        {progress && <p className="note" style={{ margin: "8px 0 0" }}>{progress}</p>}
        {err && <p className="error-text" style={{ margin: "8px 0 0" }}>{err}</p>}
        {msg && <p className="note" style={{ margin: "8px 0 0", color: "var(--ok, #3ddc97)" }}>{msg}</p>}
        {integrity && (
          <p className="note" style={{ margin: "8px 0 0", color: integrity.broken.length ? "#ff7b7b" : "var(--ok, #3ddc97)" }}>
            {integrity.broken.length
              ? `⛔ ${integrity.broken.length} Beleg(e) verändert/fehlend, ${integrity.okCount} unverändert.`
              : `✓ Integrität bestätigt: alle ${integrity.okCount} Belege unverändert.`}
          </p>
        )}
      </div>

      <div className="refunds">
        {unique.map((e) => (
          <div key={e.belegId} className="refund-card">
            <div className="refund-head">
              <div className="who-wrap">
                <strong>{e.subject || "(ohne Betreff)"}</strong>
                <div className="head-meta">
                  {e.from && <span className="muted" style={{ fontSize: 12 }}>{e.from}</span>}
                  {e.date && <span className="pill">{e.date}</span>}
                  <span className="pill ok" title={`SHA-256: ${e.hash}`}>🔒 {short(e.hash)}</span>
                </div>
                <span className="muted" style={{ fontSize: 11 }}>archiviert {new Date(e.archivedAt).toLocaleString("de-DE")}</span>
              </div>
              <div className="spacer" />
              <div className="amt-wrap" style={{ textAlign: "right" }}>
                {(e.files || []).map((f) => (
                  <div key={f.name}>
                    <button className="link-btn" title={f.name} onClick={() => inbox?.openFile?.(e.belegId, f.name)}>{f.name}</button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ))}
        {!unique.length && (
          <div className="card muted" style={{ textAlign: "center", padding: 28 }}>
            Noch keine Belege archiviert. Leite Bestellbestätigungen an deine Belege-Adresse weiter (Stammdaten → Belege), dann erscheinen sie hier.
          </div>
        )}
      </div>

      <p className="note" style={{ marginTop: 14, fontSize: 12 }}>
        Hinweis: Das versiegelte Manifest (Hash-Kette) macht jede nachträgliche Änderung sofort sichtbar. Für vollständige
        GoBD-Konformität gehören zusätzlich eine Verfahrensdokumentation und ein unveränderbarer Speicherort dazu.
      </p>
    </div>
  );
}
