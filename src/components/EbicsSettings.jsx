import { useState } from "react";
import { generateEbicsKeys, openIniLetter, ebicsStatusLabel, EBICS_STATUS, ebicsConfigValid, createEbicsClient } from "../lib/ebics/index.js";
import { ebicsHttpPost } from "../lib/ebics/transport.js";
import { exportEbicsKeys, importEbicsKeys } from "../lib/ebics/keyBackup.js";

// Datei-Download (Tauri-WebView blockiert window.open; Blob + <a download> landet in „Downloads").
function downloadText(filename, text) {
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.rel = "noopener";
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

// Geführter EBICS-Einrichtungs-Assistent (Einstellungen → Bankanbindung).
// Opt-in: Tix & Travel (oder jeder Käufer) entscheidet hier aktiv, ob die direkte
// Bankanbindung genutzt wird, und meldet sich mit seinen EBICS-Zugangsdaten an.
// Private Schlüssel landen in data.ebicsKeys (lokal, nie zum Hub).
export default function EbicsSettings({ data, updateData, allowed = true }) {
  const cfg = data.config?.ebics || {};
  const keys = data.ebicsKeys || null;
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [backupPw, setBackupPw] = useState("");

  const enabled = !!cfg.enabled;
  const status = cfg.status || EBICS_STATUS.UNINITIALIZED;

  // Opt-in-Schalter: setzt Modul-Flag (für Tab/Senden) UND config.ebics.enabled.
  function toggleEnabled(on) {
    updateData((d) => ({
      ...d,
      config: {
        ...(d.config || {}),
        modules: { ...((d.config || {}).modules || {}), ebics: on },
        ebics: { ...((d.config || {}).ebics || {}), enabled: on },
      },
    }), true);
  }
  const setCfg = (patch) => updateData((d) => ({
    ...d, config: { ...(d.config || {}), ebics: { ...((d.config || {}).ebics || {}), ...patch } },
  }));

  async function generate() {
    setErr(""); setMsg(""); setBusy("gen");
    try {
      const k = await generateEbicsKeys();
      // Schlüssel lokal speichern + Status hochsetzen (sofort speichern).
      updateData((d) => ({
        ...d,
        ebicsKeys: k,
        config: { ...(d.config || {}), ebics: { ...((d.config || {}).ebics || {}), status: EBICS_STATUS.KEYS_GENERATED } },
      }), true);
      setMsg("EBICS-Schlüssel wurden lokal erzeugt und verschlüsselt gespeichert. Jetzt den INI-Brief drucken.");
    } catch (e) { setErr(e.message || "Schlüssel-Erzeugung fehlgeschlagen."); } finally { setBusy(""); }
  }

  // Schlüssel verschlüsselt sichern (Datei-Download). Schützt vor Verlust bei
  // Gerätewechsel/Datenreset – ohne erneute Bank-Initialisierung.
  async function backupKeys() {
    setErr(""); setMsg("");
    try {
      const text = await exportEbicsKeys(keys, backupPw);
      downloadText(`iou-ebics-backup_${cfg.partnerId || "schluessel"}.json`, text);
      setBackupPw("");
      setMsg("Sicherung erstellt (Ordner Downloads). Datei UND Passwort sicher aufbewahren – damit stellst du die Schlüssel jederzeit wieder her, ohne die Bank erneut zu initialisieren.");
    } catch (e) { setErr(e.message || "Sicherung fehlgeschlagen."); }
  }
  // Schlüssel aus einer Sicherungsdatei wiederherstellen (auch wenn aktuell keine da sind).
  async function restoreKeys(file) {
    setErr(""); setMsg("");
    if (!file) return;
    try {
      const restored = await importEbicsKeys(await file.text(), backupPw);
      updateData((d) => ({ ...d, ebicsKeys: restored }), true);
      setBackupPw("");
      setMsg("EBICS-Schlüssel wiederhergestellt. Hat die Bank diese Schlüssel bereits freigeschaltet, kannst du direkt weiterarbeiten – ohne neuen INI-Brief.");
    } catch (e) { setErr(e.message || "Wiederherstellung fehlgeschlagen."); }
  }

  // Schritt 3a: öffentliche Schlüssel elektronisch an die Bank senden (INI + HIA).
  // Bewegt kein Geld. Erst danach (plus INI-Brief) schaltet die Bank frei.
  async function sendInit() {
    setErr(""); setMsg(""); setBusy("init");
    try {
      if (!keys) throw new Error("Bitte zuerst die Schlüssel erzeugen.");
      const client = createEbicsClient({ cfg, keys, httpPost: ebicsHttpPost });
      const r = await client.sendInitialization();
      const fmt = (x) => `${x.technical || x.httpStatus || "?"}${x.reportText ? " " + x.reportText : ""}`;
      if (r.ok) {
        setCfg({ status: EBICS_STATUS.INI_SENT });
        setMsg(`INI und HIA wurden an die Bank übermittelt (INI ${fmt(r.ini)}, HIA ${fmt(r.hia)}). Jetzt den INI-Brief drucken, unterschreiben und an die Bank senden – danach schaltet die Bank frei.`);
      } else {
        setErr(`Die Bank hat die Einreichung nicht mit OK quittiert (INI ${fmt(r.ini)}, HIA ${fmt(r.hia)}). Bitte Zugangsdaten/Host-ID prüfen. Hinweis: „bereits initialisiert" kann auch bedeuten, dass die Schlüssel schon eingereicht wurden.`);
      }
    } catch (e) { setErr(e.message || "INI/HIA-Übermittlung fehlgeschlagen."); } finally { setBusy(""); }
  }

  function printIni() {
    setErr(""); setMsg("");
    try {
      if (!keys) throw new Error("Bitte zuerst die Schlüssel erzeugen.");
      openIniLetter(cfg, keys);
      setMsg("INI-Brief erstellt. Liegt im Ordner Downloads bzw. im neuen Fenster – dort öffnen, drucken, unterschreiben und an die Bank senden.");
      if (status === EBICS_STATUS.KEYS_GENERATED) setCfg({ status: EBICS_STATUS.INI_SENT });
    } catch (e) { setErr(e.message || "INI-Brief konnte nicht erstellt werden."); }
  }

  function markActive(on) {
    setCfg({ status: on ? EBICS_STATUS.ACTIVE : EBICS_STATUS.INI_SENT });
  }

  const configReady = ebicsConfigValid(cfg);

  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>Bankanbindung (EBICS) <span className="muted" style={{ fontSize: 12, fontWeight: 400 }}>· optional</span></h2>
      <p className="note">
        SEPA-Aufträge direkt aus iou.fm an die Bank übergeben – Freigabe über die TAN-/Banking-App deiner Bank (z. B. photoTAN, pushTAN, SecureGo), ohne manuellen Datei-Upload.
        Die EBICS-Schlüssel werden lokal erzeugt und bleiben Ende-zu-Ende verschlüsselt auf diesem Gerät; der Server sieht sie nie.
      </p>

      {!allowed && (
        <p className="note" style={{ background: "rgba(201,162,75,.12)", border: "1px solid rgba(201,162,75,.4)", borderRadius: 8, padding: "10px 12px", color: "#e7c982" }}>
          🔒 Die EBICS-Bankanbindung ist im Tarif <strong>Bank</strong> enthalten. Unter „Abo &amp; Lizenz" upgraden, um sie zu nutzen.
        </p>
      )}
      <label style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 4, opacity: allowed ? 1 : 0.5 }}>
        <input type="checkbox" checked={enabled} disabled={!allowed && !enabled} onChange={(e) => toggleEnabled(e.target.checked)} />
        <span><strong>Bankanbindung aktivieren</strong> – ich möchte Überweisungen direkt aus der App senden.</span>
      </label>

      {enabled && (
        <div style={{ marginTop: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
            <span className="note" style={{ margin: 0 }}>Status:</span>
            <strong style={{ color: status === EBICS_STATUS.ACTIVE ? "var(--ok, #3ddc97)" : "var(--text, inherit)" }}>
              {ebicsStatusLabel(cfg)}
            </strong>
          </div>

          <h3 style={{ margin: "8px 0 4px", fontSize: 14 }}>1 · Zugangsdaten der Bank</h3>
          <p className="note" style={{ marginTop: 0 }}>Diese Werte bekommst du von deiner Bank (EBICS-Vertrag). Sie sind nicht geheim.</p>
          <div className="row">
            <label className="field"><span>Bank</span>
              <input type="text" value={cfg.bankName || ""} onChange={(e) => setCfg({ bankName: e.target.value })} placeholder="z. B. Commerzbank" /></label>
            <label className="field"><span>EBICS-Version</span>
              <select value={cfg.version || "H005"} onChange={(e) => setCfg({ version: e.target.value })}>
                <option value="H005">H005 (EBICS 3.0)</option>
                <option value="H004">H004 (EBICS 2.5)</option>
              </select></label>
          </div>
          <div className="row">
            <label className="field"><span>Host-ID</span>
              <input type="text" value={cfg.hostId || ""} onChange={(e) => setCfg({ hostId: e.target.value })} placeholder="z. B. COBADEFF" /></label>
            <label className="field"><span>Kunden-ID (Partner-ID)</span>
              <input type="text" value={cfg.partnerId || ""} onChange={(e) => setCfg({ partnerId: e.target.value })} placeholder="z. B. K0001234" /></label>
            <label className="field"><span>Teilnehmer-ID (User-ID)</span>
              <input type="text" value={cfg.userId || ""} onChange={(e) => setCfg({ userId: e.target.value })} placeholder="z. B. T0001234" /></label>
          </div>
          <label className="field"><span>EBICS-Server-URL</span>
            <input type="text" value={cfg.ebicsUrl || ""} onChange={(e) => setCfg({ ebicsUrl: e.target.value })} placeholder="https://ebics.deine-bank.de/ebicsweb/ebicsweb" /></label>

          <h3 style={{ margin: "18px 0 4px", fontSize: 14 }}>2 · Schlüssel erzeugen</h3>
          <p className="note" style={{ marginTop: 0 }}>
            Erzeugt deine drei EBICS-Schlüssel (Signatur, Authentifizierung, Verschlüsselung) lokal auf diesem Gerät.
            {keys && <> Erzeugt am {new Date(keys.createdAt).toLocaleString("de-DE")}.</>}
          </p>
          <button className="btn" disabled={!configReady || busy === "gen"} onClick={generate}>
            {keys ? "Schlüssel neu erzeugen" : "Schlüssel erzeugen"}
          </button>
          {keys && <p className="note" style={{ marginTop: 6, color: "#e7c982" }}>⚠ „Neu erzeugen" macht einen bereits an die Bank gesendeten INI-Brief ungültig – nur nutzen, wenn du wirklich neu initialisieren willst.</p>}
          {!configReady && <p className="note" style={{ marginTop: 6 }}>Bitte zuerst Host-ID, Kunden-ID, Teilnehmer-ID und URL ausfüllen.</p>}

          <div style={{ marginTop: 14, padding: 12, border: "1px solid rgba(61,220,151,.35)", borderRadius: 8, background: "rgba(61,220,151,.06)" }}>
            <strong style={{ fontSize: 13 }}>🔐 Schlüssel sichern &amp; wiederherstellen</strong>
            <p className="note" style={{ marginTop: 4 }}>
              EBICS-Schlüssel werden <strong>einmal</strong> erzeugt und von der Bank <strong>einmal</strong> freigeschaltet – danach gelten sie dauerhaft (App-Updates ändern sie nicht).
              Sichere sie hier verschlüsselt, damit sie bei Gerätewechsel/Datenverlust <strong>nicht</strong> neu initialisiert werden müssen.
            </p>
            <input type="password" value={backupPw} onChange={(e) => setBackupPw(e.target.value)}
              placeholder="Sicherungs-Passwort (min. 8 Zeichen)" style={{ maxWidth: 320, marginBottom: 8 }} />
            <div className="toolbar" style={{ margin: 0, gap: 8 }}>
              <button className="btn ghost" disabled={!keys || backupPw.length < 8} onClick={backupKeys}>Schlüssel sichern (Backup-Datei)</button>
              <label className="btn ghost" style={{ cursor: "pointer", margin: 0 }}>
                Schlüssel wiederherstellen…
                <input type="file" accept="application/json,.json" style={{ display: "none" }}
                  onChange={(e) => { restoreKeys(e.target.files?.[0]); e.target.value = ""; }} />
              </label>
            </div>
            <p className="note" style={{ marginTop: 6, fontSize: 11 }}>Für die Wiederherstellung dasselbe Passwort eingeben, dann die Sicherungsdatei wählen.</p>
          </div>

          <h3 style={{ margin: "18px 0 4px", fontSize: 14 }}>3 · Schlüssel an die Bank übermitteln</h3>
          <p className="note" style={{ marginTop: 0 }}>
            <strong>3a)</strong> Sende deine öffentlichen Schlüssel elektronisch an die Bank (INI + HIA). Das bewegt kein Geld.
          </p>
          <button className="btn" disabled={!keys || busy === "init"} onClick={sendInit}>
            {busy === "init" ? "Sende INI/HIA…" : "INI + HIA an die Bank senden"}
          </button>
          <p className="note" style={{ marginTop: 12 }}>
            <strong>3b)</strong> Druckt den INI-Brief mit den öffentlichen Schlüssel-Hashes. Unterschreiben und per Post/Upload an die
            Bank schicken – die Bank gleicht Brief und elektronische Schlüssel ab und schaltet <strong>genau diese</strong> Schlüssel frei.
          </p>
          <button className="btn ghost" disabled={!keys} onClick={printIni}>INI-Brief öffnen / drucken</button>

          <h3 style={{ margin: "18px 0 4px", fontSize: 14 }}>4 · Freischaltung bestätigen</h3>
          <p className="note" style={{ marginTop: 0 }}>
            Sobald die Bank deinen Zugang aktiviert hat, hier auf „aktiv" setzen. Erst dann erscheint im Lohn-/Erstattungslauf
            der Button „Per EBICS senden". Anklickbar erst, wenn INI/HIA gesendet wurden – sonst kennt die Bank deine Schlüssel nicht.
          </p>
          <label style={{ display: "flex", alignItems: "center", gap: 10, opacity: (status === EBICS_STATUS.INI_SENT || status === EBICS_STATUS.ACTIVE) ? 1 : 0.5 }}>
            <input type="checkbox" checked={status === EBICS_STATUS.ACTIVE}
              disabled={status !== EBICS_STATUS.INI_SENT && status !== EBICS_STATUS.ACTIVE}
              onChange={(e) => markActive(e.target.checked)} />
            <span>Zugang ist von der Bank freigeschaltet (aktiv)</span>
          </label>

          {err && <p className="error-text" style={{ marginTop: 12 }}>{err}</p>}
          {msg && <p className="note" style={{ color: "var(--ok, #3ddc97)", marginTop: 12 }}>{msg}</p>}
        </div>
      )}
    </div>
  );
}
