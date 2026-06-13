import { useState } from "react";
import { generateEbicsKeys, openIniLetter, ebicsStatusLabel, EBICS_STATUS, ebicsConfigValid } from "../lib/ebics/index.js";

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

  function printIni() {
    setErr(""); setMsg("");
    try {
      if (!keys) throw new Error("Bitte zuerst die Schlüssel erzeugen.");
      openIniLetter(cfg, keys);
      if (status === EBICS_STATUS.KEYS_GENERATED) setCfg({ status: EBICS_STATUS.INI_SENT });
    } catch (e) { setErr(e.message || "INI-Brief konnte nicht geöffnet werden."); }
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
          {!configReady && <p className="note" style={{ marginTop: 6 }}>Bitte zuerst Host-ID, Kunden-ID, Teilnehmer-ID und URL ausfüllen.</p>}

          <h3 style={{ margin: "18px 0 4px", fontSize: 14 }}>3 · INI-Brief drucken &amp; an die Bank senden</h3>
          <p className="note" style={{ marginTop: 0 }}>
            Druckt den INI-Brief mit den öffentlichen Schlüssel-Hashes. Unterschreiben und an die Bank schicken – erst danach
            schaltet die Bank deinen Zugang frei.
          </p>
          <button className="btn" disabled={!keys} onClick={printIni}>INI-Brief öffnen / drucken</button>

          <h3 style={{ margin: "18px 0 4px", fontSize: 14 }}>4 · Freischaltung bestätigen</h3>
          <p className="note" style={{ marginTop: 0 }}>
            Sobald die Bank deinen Zugang aktiviert hat (Bestätigung + App-Freigabe eingerichtet), hier auf „aktiv" setzen.
            Erst dann erscheint im Lohn-/Erstattungslauf der Button „Per EBICS senden".
          </p>
          <label style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <input type="checkbox" checked={status === EBICS_STATUS.ACTIVE} disabled={!keys} onChange={(e) => markActive(e.target.checked)} />
            <span>Zugang ist von der Bank freigeschaltet (aktiv)</span>
          </label>

          {err && <p className="error-text" style={{ marginTop: 12 }}>{err}</p>}
          {msg && <p className="note" style={{ color: "var(--ok, #3ddc97)", marginTop: 12 }}>{msg}</p>}
        </div>
      )}
    </div>
  );
}
