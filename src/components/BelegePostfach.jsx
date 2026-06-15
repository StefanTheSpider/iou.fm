import { useState, useEffect, Fragment } from "react";

// Belege & Buchhaltung – EINE Sektion für alles rund um Belege:
//  • persönliche Empfangs-Adresse (eingehende Belege per E-Mail sammeln, revisionssicher archivieren)
//  • zentrale Empfänger (Steuerberater + DATEV) – nur EINMAL gepflegt, von beiden Funktionen genutzt
//  • zwei Auslöser: (A) eingehende Belege automatisch weiterleiten, (B) bezahlte Rechnungs-Belege
//    nach dem SEPA-Lauf automatisch senden.
// Die Empfänger liegen in der serverseitigen Inbox-Config (eine Quelle); der Rechnungs-Versand
// adressiert automatisch dieselben Empfänger.
export default function BelegePostfach({ inbox, data = null, updateData = null, rechnungOn = false, onOpen = null }) {
  const [cfg, setCfg] = useState(null);
  const [belege, setBelege] = useState(null);
  const [detail, setDetail] = useState(null); // { id, files: [{name,size,type}] }
  const [dlBusy, setDlBusy] = useState("");    // gerade ladende Datei (Name)
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => { (async () => { try { setCfg(await inbox.get()); } catch { /* still */ } })(); }, [inbox]);
  if (!inbox) return null;

  const set = (patch) => setCfg((c) => ({ ...(c || {}), ...patch }));
  const iopts = data?.config?.invoiceOpts || {};
  const setAutoSendInvoices = (on) => {
    if (!updateData) return;
    updateData((d) => ({ ...d, config: { ...(d.config || {}), invoiceOpts: { ...((d.config || {}).invoiceOpts || {}), autoSendBelege: on } } }));
  };

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
  async function refreshCfg() {
    setBusy("refresh"); setErr("");
    try { setCfg(await inbox.get()); } catch (e) { setErr(e.message || "Aktualisieren fehlgeschlagen."); } finally { setBusy(""); }
  }
  async function clearNotices() {
    try { await inbox.clearNotices(); setCfg((c) => ({ ...(c || {}), datevNotices: [] })); } catch (e) { setErr(e.message || "Fehler."); }
  }
  // Dateien eines Belegs nachladen und aufklappen (Original-.eml, PDF, Anhänge).
  async function toggleFiles(beId) {
    setErr("");
    if (detail?.id === beId) { setDetail(null); return; }
    setBusy("files-" + beId);
    try { setDetail({ id: beId, files: await inbox.files(beId) }); }
    catch (e) { setErr(e.message || "Dateien konnten nicht geladen werden."); }
    finally { setBusy(""); }
  }
  async function openOne(beId, name) {
    setErr(""); setMsg(""); setDlBusy(name);
    try {
      await inbox.openFile(beId, name);
      setMsg(`✓ Datei in den Ordner „Downloads" geladen – dort per Doppelklick öffnen.`);
    } catch (e) { setErr(e.message || "Datei konnte nicht geladen werden."); }
    finally { setDlBusy(""); }
  }
  function fileLabel(name) {
    if (/_beleg\.pdf$/i.test(name)) return "📄 PDF-Beleg (lesbar) herunterladen";
    if (/\.eml$/i.test(name)) return "✉️ Original-Mail (.eml) – nur technischer Nachweis";
    if (/\.pdf$/i.test(name)) return "📄 " + name.replace(/^[0-9a-f-]{36}_/i, "") + " (lesbar)";
    return "📎 " + name.replace(/^[0-9a-f-]{36}_/i, "");
  }
  const fmtKB = (n) => (n >= 1024 * 1024 ? (n / 1024 / 1024).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB");
  function copyAddr() { try { navigator.clipboard.writeText(cfg.address); setMsg("Adresse kopiert."); } catch { /* egal */ } }
  function copySender() { try { navigator.clipboard.writeText(cfg.senderEmail); setMsg("Absenderadresse kopiert."); } catch { /* egal */ } }
  async function confirmDone() {
    setErr(""); setBusy("confirm");
    try { await inbox.clearConfirm(); set({ datevConfirmLink: "" }); setMsg("✓ DATEV-Absender freigegeben – alles erledigt."); }
    catch (e) { setErr(e.message || "Fehler."); } finally { setBusy(""); }
  }

  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>Belege &amp; Buchhaltung <span className="muted" style={{ fontSize: 12, fontWeight: 400 }}>· optional</span></h2>
      <p className="note">
        Ein Ort für alle Belege: eingehende Belege per E-Mail sammeln, deinen Steuerberater/DATEV
        <strong> einmal</strong> hinterlegen und festlegen, was automatisch dorthin geht. Alles wird
        revisionssicher (mit Zeitstempel + Prüfsumme) archiviert.
      </p>

      {!cfg ? <p className="note">Lädt …</p> : !cfg.available ? (
        <p className="note" style={{ background: "rgba(201,162,75,.12)", border: "1px solid rgba(201,162,75,.4)", borderRadius: 8, padding: "10px 12px", color: "#e7c982" }}>
          🔧 Der E-Mail-Empfang ist serverseitig noch nicht eingerichtet (Inbound-Dienst fehlt). Adresse wird aktiv, sobald das steht.
        </p>
      ) : (
        <>
          {cfg.datevConfirmLink && (
            <p className="note" style={{ background: "rgba(90,217,160,.12)", border: "1px solid rgba(90,217,160,.45)", borderRadius: 8, padding: "12px 14px", color: "#bdf0d6" }}>
              ✅ <strong>Fast fertig:</strong> einmal in DATEV freigeben – danach verschwindet dieser Hinweis automatisch.
              <br />
              <button className="btn" style={{ marginTop: 8 }} disabled={busy === "confirm"} onClick={async () => { if (onOpen) { try { await onOpen(cfg.datevConfirmLink); } catch { /* egal */ } } await confirmDone(); }}>{busy === "confirm" ? "…" : "DATEV-Absender jetzt freigeben"}</button>
              <button className="btn ghost small" style={{ marginLeft: 8 }} onClick={() => { try { navigator.clipboard.writeText(cfg.datevConfirmLink); setMsg("Link kopiert."); } catch { /* egal */ } }}>Link kopieren</button>
              <button className="btn ghost small" style={{ marginLeft: 8 }} disabled={busy === "confirm"} onClick={confirmDone}>schon erledigt? ausblenden</button>
            </p>
          )}

          <label className="field"><span>Deine Empfangs-Adresse <span className="muted" style={{ fontWeight: 400 }}>· dahin leitest du Belege weiter</span></span>
            <div style={{ display: "flex", gap: 8 }}>
              <input type="text" readOnly value={cfg.address || ""} style={{ flex: 1 }} onFocus={(e) => e.target.select()} />
              <button className="btn ghost" onClick={copyAddr}>Kopieren</button>
            </div>
          </label>
          <p className="note" style={{ marginTop: 0 }}>Richte in deinem Mailprogramm eine Weiterleitung an diese Adresse ein (oder leite Mails manuell weiter).</p>

          {cfg.senderEmail && (
            <label className="field" style={{ marginTop: 10 }}>
              <span>iou.fm-Absenderadresse <span className="muted" style={{ fontWeight: 400 }}>· in DATEV als freigegebenen Absender hinterlegen</span></span>
              <div style={{ display: "flex", gap: 8 }}>
                <input type="text" readOnly value={cfg.senderEmail} style={{ flex: 1 }} onFocus={(e) => e.target.select()} />
                <button className="btn ghost" onClick={copySender}>Kopieren</button>
              </div>
            </label>
          )}

          <h3 style={{ margin: "16px 0 6px", fontSize: 14 }}>Empfänger (Steuerberater / DATEV)</h3>
          <label className="field" style={{ display: "block" }}><span>Steuerberater-E-Mail</span>
            <input type="email" style={{ width: "100%" }} value={cfg.belegEmail || ""} onChange={(e) => set({ belegEmail: e.target.value })} placeholder="kanzlei@example.de" title={cfg.belegEmail || ""} /></label>
          <label className="field" style={{ display: "block", marginTop: 8 }}><span>DATEV-Beleg-E-Mail <span className="muted" style={{ fontWeight: 400 }}>· Unternehmen online, optional · endet auf @uploadmail.datev.de</span></span>
            <input type="email" style={{ width: "100%" }} value={cfg.datevEmail || ""} onChange={(e) => set({ datevEmail: e.target.value })} placeholder="…@uploadmail.datev.de" title={cfg.datevEmail || ""} /></label>
          <p className="note" style={{ marginTop: 0 }}>Diese Empfänger gelten für beide Funktionen unten. Beide Felder dürfen befüllt sein.</p>
          {[cfg.belegEmail, cfg.datevEmail].some((x) => x && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(x).trim())) && (
            <p className="note" style={{ background: "rgba(255,107,107,.12)", border: "1px solid rgba(255,107,107,.5)", borderRadius: 8, padding: "10px 12px", color: "#ffb3b3", marginTop: 4 }}>
              ⚠️ Eine Empfänger-Adresse ist <strong>keine vollständige E-Mail-Adresse</strong> (es fehlt z. B. <code>@…</code>). Die DATEV-Upload-Adresse endet i. d. R. auf <code>@uploadmail.datev.de</code>. Ohne gültige Adresse schlägt der Versand fehl.
            </p>
          )}
          {cfg.senderEmail && (
            <p className="note" style={{ background: "rgba(201,162,75,.12)", border: "1px solid rgba(201,162,75,.4)", borderRadius: 8, padding: "10px 12px", color: "#e7c982", marginTop: 4 }}>
              ⚠️ <strong>Wichtig für DATEV:</strong> DATEV nimmt nur Mails von freigegebenen Absendern an.
              Hinterlege in DATEV Unternehmen online unter <em>Belegtransfer → freigegebene Absender</em> diese Adresse:
              <br /><code style={{ userSelect: "all" }}>{cfg.senderEmail}</code>
              <button className="btn ghost small" style={{ marginLeft: 8 }} onClick={copySender}>Kopieren</button>
            </p>
          )}

          <h3 style={{ margin: "16px 0 6px", fontSize: 14 }}>Automatisch an die Empfänger senden</h3>
          <label style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <input type="checkbox" checked={!!cfg.autoForward} onChange={(e) => set({ autoForward: e.target.checked })} />
            <span><strong>Eingehende Belege</strong> – per E-Mail empfangene Belege gehen direkt an die Empfänger oben. <span className="muted">(Speichern nicht vergessen.)</span></span>
          </label>
          {rechnungOn && updateData && (
            <label style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
              <input type="checkbox" checked={!!iopts.autoSendBelege} onChange={(e) => setAutoSendInvoices(e.target.checked)} />
              <span><strong>Bezahlte Rechnungen</strong> – nach jedem Rechnungs-SEPA-Lauf gehen die Rechnungs-PDFs an dieselben Empfänger. <span className="muted">(wird sofort gespeichert)</span></span>
            </label>
          )}

          <h3 style={{ margin: "16px 0 6px", fontSize: 14 }}>DATEV-Rückmeldungen</h3>
          <p className="note" style={{ marginTop: 0 }}>Was DATEV zu deinen gesendeten Belegen zurückmeldet (Erfolg/Fehler). So siehst du, ob ein Beleg in DATEV angekommen ist – statt im Stillen zu raten.</p>
          <div className="toolbar" style={{ marginBottom: 8, marginTop: 0 }}>
            <button className="btn ghost small" disabled={busy === "refresh"} onClick={refreshCfg}>{busy === "refresh" ? "Lädt…" : "Aktualisieren"}</button>
            {(cfg.datevNotices || []).length > 0 && <button className="btn ghost small" onClick={clearNotices}>Liste leeren</button>}
          </div>
          {(cfg.datevNotices || []).length === 0
            ? <p className="note" style={{ marginTop: 0 }}>Noch keine Rückmeldung von DATEV. Sende einen Beleg und klick nach ~1–2 Minuten auf „Aktualisieren".</p>
            : (cfg.datevNotices || []).map((n, i) => (
                <div key={i} className="note" style={{ marginTop: 0, marginBottom: 6, padding: "8px 10px", borderRadius: 8, border: "1px solid", borderColor: n.isError ? "rgba(255,107,107,.5)" : "rgba(90,217,160,.45)", background: n.isError ? "rgba(255,107,107,.10)" : "rgba(90,217,160,.10)", color: n.isError ? "#ffb3b3" : "#bdf0d6" }}>
                  <strong>{n.isError ? "⚠️ Fehler" : "✓ OK"}</strong> · {new Date(n.receivedAt).toLocaleString("de-DE")}<br />
                  <span style={{ color: "var(--text)" }}>{n.subject || "(ohne Betreff)"}</span>
                  {n.text ? <><br /><span className="muted" style={{ fontSize: 12 }}>{n.text.slice(0, 240)}</span></> : null}
                </div>
              ))}

          <div className="toolbar" style={{ marginBottom: 0, marginTop: 14 }}>
            <span className="note">Im Archiv: {belege ? belege.length : (cfg.count ?? 0)} Beleg(e).</span>
            <div className="spacer" />
            <button className="btn ghost" disabled={busy === "archive"} onClick={loadArchive}>{busy === "archive" ? "Lädt…" : "Archiv anzeigen"}</button>
            <button className="btn" disabled={busy === "save"} onClick={save}>{busy === "save" ? "Speichere…" : "E-Mail-Einstellungen speichern"}</button>
          </div>

          {belege && belege.length > 0 && (
            <div className="table-wrap" style={{ marginTop: 12 }}>
              <table>
                <thead><tr><th>Empfangen</th><th>Von</th><th>Betreff</th><th>Anhänge</th><th></th></tr></thead>
                <tbody>
                  {belege.slice(0, 50).map((b) => (
                    <Fragment key={b.id}>
                    <tr style={{ cursor: "pointer" }} onClick={() => toggleFiles(b.id)} title="Beleg ansehen">
                      <td style={{ whiteSpace: "nowrap" }}>{new Date(b.receivedAt).toLocaleString("de-DE")}</td>
                      <td style={{ maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={b.from}>{b.from}</td>
                      <td style={{ maxWidth: 360, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={b.subject}>{b.subject}</td>
                      <td style={{ textAlign: "center" }}>{(b.attachments || []).length}</td>
                      <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                        <button className="btn small" disabled={busy === "files-" + b.id} onClick={(e) => { e.stopPropagation(); toggleFiles(b.id); }}>
                          {busy === "files-" + b.id ? "Lädt…" : (detail?.id === b.id ? "Schließen" : "Ansehen")}
                        </button>
                      </td>
                    </tr>
                    {detail?.id === b.id && (
                      <tr>
                        <td colSpan={5} style={{ background: "var(--raised-2, rgba(255,255,255,.03))" }}>
                          <div style={{ padding: "6px 2px" }}>
                            <div className="note" style={{ marginBottom: 6 }}>
                              <strong>📄 PDF = der lesbare Beleg</strong> (zum Anschauen/Buchen). <strong>✉️ .eml = nur das technische Original</strong> (Roh-Nachweis, zeigt im Schnell-Viewer oft nur die Kopfzeilen – mit „Mail" öffnen für den Inhalt).
                              <br />Klick lädt die Datei in deinen Ordner „Downloads" – dort mit Doppelklick öffnen.
                              <br />Revisionssicher abgelegt · Prüfsumme (SHA-256): <code style={{ fontSize: 11 }}>{b.sha256}</code>
                            </div>
                            {detail.files.length === 0 && <p className="note">Keine abgelegten Dateien gefunden.</p>}
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                              {detail.files.map((f) => (
                                <button key={f.name} className="btn small" disabled={dlBusy === f.name} onClick={() => openOne(b.id, f.name)} title={f.name}>
                                  {dlBusy === f.name ? "Lädt…" : fileLabel(f.name)} <span className="muted" style={{ fontWeight: 400 }}>· {fmtKB(f.size)}</span>
                                </button>
                              ))}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                    </Fragment>
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
