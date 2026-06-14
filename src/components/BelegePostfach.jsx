import { useState, useEffect } from "react";

// Belege per E-Mail: eigene Weiterleitungs-Adresse, Auto-Weiterleitung an DATEV/
// Steuerberater und revisionssicheres Archiv. Der Endkunde trägt nur E-Mails ein.
export default function BelegePostfach({ inbox }) {
  const [cfg, setCfg] = useState(null);
  const [belege, setBelege] = useState(null);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => { (async () => { try { setCfg(await inbox.get()); } catch { /* still */ } })(); }, [inbox]);
  if (!inbox) return null;

  const set = (patch) => setCfg((c) => ({ ...(c || {}), ...patch }));
  async function save() {
    setErr(""); setMsg(""); setBusy("save");
    try {
      await inbox.save({ autoForward: !!cfg.autoForward, datevEmail: cfg.datevEmail || "", belegEmail: cfg.belegEmail || "" });
      setMsg("Gespeichert.");
    } catch (e) { setErr(e.message || "Fehler."); } finally { setBusy(""); }
  }
  async function loadArchive() {
    setBusy("archive");
    try { setBelege(await inbox.belege()); } catch { setBelege([]); } finally { setBusy(""); }
  }
  function copyAddr() { try { navigator.clipboard.writeText(cfg.address); setMsg("Adresse kopiert."); } catch { /* egal */ } }

  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>Belege per E-Mail <span className="muted" style={{ fontSize: 12, fontWeight: 400 }}>· optional</span></h2>
      <p className="note">
        Leite Bestellbestätigungen und Einkaufs-Belege an deine persönliche iou.fm-Adresse weiter. Sie werden
        revisionssicher (mit Zeitstempel + Prüfsumme) archiviert und – wenn aktiviert – automatisch an deinen
        Steuerberater oder direkt an DATEV (Unternehmen online) weitergeleitet.
      </p>

      {!cfg ? <p className="note">Lädt …</p> : !cfg.available ? (
        <p className="note" style={{ background: "rgba(201,162,75,.12)", border: "1px solid rgba(201,162,75,.4)", borderRadius: 8, padding: "10px 12px", color: "#e7c982" }}>
          🔧 Der E-Mail-Empfang ist serverseitig noch nicht eingerichtet (Inbound-Dienst fehlt). Adresse wird aktiv, sobald das steht.
        </p>
      ) : (
        <>
          <label className="field"><span>Deine Weiterleitungs-Adresse</span>
            <div style={{ display: "flex", gap: 8 }}>
              <input type="text" readOnly value={cfg.address || ""} style={{ flex: 1 }} onFocus={(e) => e.target.select()} />
              <button className="btn ghost" onClick={copyAddr}>Kopieren</button>
            </div>
          </label>
          <p className="note" style={{ marginTop: 0 }}>Richte in deinem Mailprogramm eine Weiterleitung an diese Adresse ein (oder leite Mails manuell weiter).</p>

          <label style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
            <input type="checkbox" checked={!!cfg.autoForward} onChange={(e) => set({ autoForward: e.target.checked })} />
            <span><strong>Automatisch weiterleiten</strong> – empfangene Belege gehen direkt an Steuerberater/DATEV.</span>
          </label>
          {cfg.autoForward && (
            <>
              <div className="row" style={{ marginTop: 6 }}>
                <label className="field"><span>Steuerberater-E-Mail</span>
                  <input type="email" value={cfg.belegEmail || ""} onChange={(e) => set({ belegEmail: e.target.value })} placeholder="kanzlei@example.de" /></label>
                <label className="field"><span>DATEV-Beleg-E-Mail (optional)</span>
                  <input type="email" value={cfg.datevEmail || ""} onChange={(e) => set({ datevEmail: e.target.value })} placeholder="…@datev-upload.de" /></label>
              </div>
              {cfg.datevEmail && cfg.senderEmail && (
                <p className="note" style={{ background: "rgba(201,162,75,.12)", border: "1px solid rgba(201,162,75,.4)", borderRadius: 8, padding: "10px 12px", color: "#e7c982", marginTop: 4 }}>
                  ⚠️ <strong>Wichtig für DATEV:</strong> DATEV nimmt nur Mails von freigegebenen Absendern an.
                  Hinterlege in DATEV Unternehmen online unter <em>Belegtransfer → freigegebene Absender</em> diese Adresse:
                  <br /><code style={{ userSelect: "all" }}>{cfg.senderEmail}</code>
                  <button className="btn ghost small" style={{ marginLeft: 8 }} onClick={() => { try { navigator.clipboard.writeText(cfg.senderEmail); setMsg("Absender kopiert."); } catch { /* egal */ } }}>Kopieren</button>
                </p>
              )}
            </>
          )}

          <div className="toolbar" style={{ marginBottom: 0 }}>
            <span className="note">Im Archiv: {belege ? belege.length : (cfg.count ?? 0)} Beleg(e).</span>
            <div className="spacer" />
            <button className="btn ghost" disabled={busy === "archive"} onClick={loadArchive}>{busy === "archive" ? "Lädt…" : "Archiv anzeigen"}</button>
            <button className="btn" disabled={busy === "save"} onClick={save}>{busy === "save" ? "Speichere…" : "Speichern"}</button>
          </div>

          {belege && belege.length > 0 && (
            <div className="table-wrap" style={{ marginTop: 12 }}>
              <table>
                <thead><tr><th>Empfangen</th><th>Von</th><th>Betreff</th><th>Anhänge</th></tr></thead>
                <tbody>
                  {belege.slice(0, 50).map((b) => (
                    <tr key={b.id}>
                      <td>{new Date(b.receivedAt).toLocaleString("de-DE")}</td>
                      <td>{b.from}</td>
                      <td>{b.subject}</td>
                      <td>{(b.attachments || []).length}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {belege && belege.length === 0 && <p className="note" style={{ marginTop: 8 }}>Noch keine Belege empfangen.</p>}

          {err && <p className="error-text" style={{ marginTop: 10 }}>{err}</p>}
          {msg && <p className="note" style={{ color: "var(--ok, #3ddc97)", marginTop: 10 }}>{msg}</p>}
        </>
      )}
    </div>
  );
}
