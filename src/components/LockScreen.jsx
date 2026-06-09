import { useState } from "react";
import { login, register } from "../lib/vault.js";
import BRANDING from "../branding.js";

// Login ist der primäre Screen: von jedem Gerät nur mit Benutzername + Passwort.
// „Neue Firma einrichten" (Admin-Registrierung) ist die sekundäre Option.
export default function LockScreen({ onUnlock, branding = BRANDING }) {
  const [mode, setMode] = useState("login"); // "login" | "register"
  const [company, setCompany] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const isRegister = mode === "register";

  async function submit(e) {
    e.preventDefault();
    setError("");
    if (!username.trim()) return setError("Bitte Benutzernamen eingeben.");
    if (!password) return setError("Bitte Passwort eingeben.");
    setBusy(true);
    try {
      if (isRegister) {
        if (password.length < 8) throw new Error("Admin-Passwort sollte mindestens 8 Zeichen haben.");
        if (password !== confirm) throw new Error("Passwörter stimmen nicht überein.");
        onUnlock(await register(username, password, company.trim()));
      } else {
        onUnlock(await login(username, password));
      }
    } catch (err) {
      setError(err.message || "Anmeldung fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="lock-screen">
      <form className="lock-box" onSubmit={submit} autoComplete="on">
        <div className="logo">
          {branding.logoUrl
            ? <img className="logo-img" src={branding.logoUrl} alt={branding.productName} style={{ height: 34 }} />
            : <>{branding.brandText}<span>{branding.brandAccent}</span></>}
        </div>
        <p className="muted" style={{ marginTop: 0 }}>
          {isRegister ? "Neue Firma einrichten – Admin-Konto anlegen" : "Anmelden"}
        </p>

        {isRegister && (
          <label className="field" style={{ textAlign: "left", marginTop: 18 }}>
            <span>Firmenname (optional)</span>
            <input type="text" value={company} onChange={(e) => setCompany(e.target.value)}
              autoComplete="organization" placeholder="z. B. Muster GmbH" />
          </label>
        )}

        <label className="field" style={{ textAlign: "left", marginTop: isRegister ? 0 : 18 }}>
          <span>Benutzername</span>
          <input type="text" name="username" value={username} onChange={(e) => setUsername(e.target.value)}
            autoComplete="username" autoFocus placeholder="z. B. stefan" />
        </label>

        <label className="field" style={{ textAlign: "left" }}>
          <span>Passwort</span>
          <input type="password" name="password" value={password} onChange={(e) => setPassword(e.target.value)}
            autoComplete={isRegister ? "new-password" : "current-password"} placeholder="••••••••" />
        </label>

        {isRegister && (
          <label className="field" style={{ textAlign: "left" }}>
            <span>Passwort bestätigen</span>
            <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password" placeholder="••••••••" />
          </label>
        )}

        {error && <p className="error-text">{error}</p>}

        <button className="btn" type="submit" disabled={busy} style={{ width: "100%", marginTop: 8 }}>
          {busy ? "Bitte warten…" : isRegister ? "Admin-Konto anlegen" : "Anmelden"}
        </button>

        <button type="button" className="link-btn" style={{ marginTop: 12 }}
          onClick={() => { setMode(isRegister ? "login" : "register"); setError(""); }}>
          {isRegister ? "← Zurück zur Anmeldung" : "Neue Firma einrichten →"}
        </button>

        <p className="note" style={{ marginTop: 16 }}>
          {isRegister
            ? "Du legst das Admin-Konto deiner Firma an. Mitarbeiter-Logins erstellst du danach unter Stammdaten."
            : "Anmeldung von jedem Gerät – Ende-zu-Ende verschlüsselt. Dein Login kann im Passwortmanager gespeichert werden."}
        </p>
      </form>
    </div>
  );
}
