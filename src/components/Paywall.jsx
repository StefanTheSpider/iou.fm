import { useState } from "react";
import { PLAN_INFO, SEAT_INFO, PRICE_NOTE } from "../lib/billing.js";
import BRANDING from "../branding.js";

// Voll-Screen-Sperre, wenn kein aktives Abo (und Durchsetzung aktiv ist).
// Zeigt die drei Tarife; „Abonnieren" öffnet die Stripe-Bezahlseite (SEPA-Lastschrift).
export default function Paywall({ license, onSubscribe, onManage, onLogout, onClose, busy = "", error = "", branding = BRANDING }) {
  const [chosen, setChosen] = useState("pro");
  const expiredTrial = license?.status === "trialing" || license?.status === "none";

  return (
    <div className="lock-screen" style={{ alignItems: "flex-start", overflowY: "auto", padding: "40px 20px" }}>
      <div style={{ maxWidth: 920, width: "100%" }}>
        <div className="logo" style={{ justifyContent: "center", marginBottom: 6 }}>
          {branding.logoUrl
            ? <img className="logo-img" src={branding.logoUrl} alt={branding.productName} style={{ height: 34 }} />
            : <>{branding.brandText}<span>{branding.brandAccent}</span></>}
        </div>
        <h1 style={{ textAlign: "center", margin: "8px 0 2px", fontSize: 22 }}>
          {expiredTrial ? "Dein Test ist abgelaufen" : "Abo erforderlich"}
        </h1>
        <p className="muted" style={{ textAlign: "center", marginTop: 0 }}>
          Wähle einen Tarif, um iou.fm weiter zu nutzen. Zahlung per SEPA-Lastschrift, monatlich kündbar.
          Jeder Tarif enthält {SEAT_INFO.base} Mitarbeiter; weitere in {SEAT_INFO.pack}er-Paketen.
        </p>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14, marginTop: 22 }}>
          {PLAN_INFO.map((p) => {
            const active = chosen === p.key;
            return (
              <div key={p.key}
                onClick={() => setChosen(p.key)}
                className="card"
                style={{
                  cursor: "pointer", position: "relative",
                  borderColor: active ? "var(--gold, #C9A24B)" : undefined,
                  boxShadow: active ? "0 0 0 2px var(--gold, #C9A24B) inset" : undefined,
                }}>
                {p.popular && (
                  <span style={{ position: "absolute", top: -10, right: 12, background: "var(--gold, #C9A24B)", color: "#1b1300", fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 10 }}>Beliebt</span>
                )}
                <h2 style={{ margin: "0 0 2px", fontSize: 17 }}>{p.label}</h2>
                <div style={{ fontSize: 24, fontWeight: 700 }}>{p.price}<span className="muted" style={{ fontSize: 13, fontWeight: 400 }}> {p.period}</span></div>
                <ul style={{ margin: "12px 0 0", padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 7 }}>
                  {p.features.map((f, i) => (
                    <li key={i} style={{ fontSize: 12.5, color: "var(--text, inherit)", display: "flex", gap: 7 }}>
                      <span style={{ color: "var(--gold, #C9A24B)", fontWeight: 700 }}>✓</span><span>{f}</span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>

        <p className="note" style={{ textAlign: "center", marginTop: 10 }}>{PRICE_NOTE}</p>

        {error && <p className="error-text" style={{ textAlign: "center", marginTop: 14 }}>{error}</p>}

        <div style={{ display: "flex", justifyContent: "center", gap: 10, marginTop: 20, flexWrap: "wrap" }}>
          <button className="btn" style={{ minWidth: 240 }} disabled={!!busy} onClick={() => onSubscribe(chosen)}>
            {busy === "checkout" ? "Öffne Bezahlseite…" : `${PLAN_INFO.find((p) => p.key === chosen)?.label} abonnieren`}
          </button>
          {license?.hasCustomer && (
            <button className="btn ghost" disabled={!!busy} onClick={onManage}>
              {busy === "portal" ? "Öffne Portal…" : "Bestehendes Abo verwalten"}
            </button>
          )}
        </div>
        <p className="note" style={{ textAlign: "center", marginTop: 16 }}>
          Nach dem Abschluss kehrst du hierher zurück – die App schaltet sich automatisch frei.
          <br />
          {onClose
            ? <button className="link-btn" onClick={onClose}>Später</button>
            : <button className="link-btn" onClick={onLogout}>Abmelden</button>}
        </p>
      </div>
    </div>
  );
}
