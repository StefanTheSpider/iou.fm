import { useState } from "react";

// Status & manuelles Aktualisieren. Verbindung/Anmeldung passieren beim Login –
// hier gibt es nichts mehr „einzurichten" und keinen Code.
export default function CloudSync({ sync }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  async function run() {
    setError(""); setBusy(true);
    try { await sync.run(); setDone(true); setTimeout(() => setDone(false), 1500); }
    catch (e) { setError(e.message || "Sync fehlgeschlagen."); }
    finally { setBusy(false); }
  }

  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>Cloud-Sync (Team)</h2>
      <p className="note">
        Anmeldung und Daten laufen über den iou.fm-Hub – <strong>Ende-zu-Ende verschlüsselt</strong> (der Server kann nichts lesen).
        Stammdaten, {`Erstattungen/Sammelüberweisung`} und Archiv sind für alle Konten der Firma gleich;
        <strong> Löhne bleiben lokal</strong> auf jedem Gerät. Sync läuft <strong>automatisch</strong> – beim Anmelden,
        beim Speichern und beim Fensterwechsel. Mitarbeiter legst du oben unter „Benutzer &amp; Zugänge" an; sie melden sich
        danach von jedem Gerät mit Benutzername + Passwort an.
      </p>
      {sync.company && <p className="note">Firma: <strong>{sync.company}</strong></p>}
      {error && <p className="error-text">{error}</p>}
      <div className="toolbar" style={{ margin: 0 }}>
        <button className="btn ghost" onClick={run} disabled={busy}>
          {busy ? "Aktualisiere…" : done ? "✓ Aktuell" : "Jetzt aktualisieren"}
        </button>
      </div>
    </div>
  );
}
