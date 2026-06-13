import { useState } from "react";
import { PLAN_INFO, SEAT_INFO, PRICE_NOTE } from "../lib/billing.js";

const STATUS_LABEL = {
  active: "Aktiv", trialing: "Testphase", past_due: "Zahlung offen",
  canceled: "Gekündigt", exempt: "Freigeschaltet", none: "Kein Abo",
};

// Abo-Status, Tarifwahl, Kundenportal und Sitzplätze (Mitarbeiter) verwalten.
export default function BillingSettings({ billing, license, tenantId = "" }) {
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [ownerId, setOwnerId] = useState("");
  if (!billing) return null;

  const lic = license || {};
  const planLabel = PLAN_INFO.find((p) => p.key === lic.plan)?.label || "–";
  const seatsAllowed = lic.seatsAllowed || SEAT_INFO.base;
  const seatsUsed = lic.seatsUsed ?? 0;
  const currentPacks = Math.max(0, Math.round((seatsAllowed - SEAT_INFO.base) / SEAT_INFO.pack));

  async function go(action, fn) {
    setErr(""); setMsg(""); setBusy(action);
    try { await fn(); } catch (e) { setErr(e.message || "Fehler."); } finally { setBusy(""); }
  }
  const subscribe = (plan) => go("checkout", async () => {
    const { url } = await billing.checkout(plan);
    await billing.open(url);
    setMsg("Bezahlseite geöffnet – nach Abschluss aktualisiert sich der Status automatisch.");
    setTimeout(() => billing.refresh(), 12000);
  });
  const portal = () => go("portal", async () => {
    const { url } = await billing.portal();
    await billing.open(url);
    setTimeout(() => billing.refresh(), 8000);
  });
  const addSeats = () => go("seats", async () => {
    await billing.seats(currentPacks + 1);
    setMsg(`${SEAT_INFO.pack} weitere Mitarbeiter werden freigeschaltet (kostenpflichtig). Status aktualisiert sich in Kürze.`);
    setTimeout(() => billing.refresh(), 6000);
  });
  const removeSeats = () => go("seats", async () => {
    await billing.seats(Math.max(0, currentPacks - 1));
    setTimeout(() => billing.refresh(), 6000);
  });
  const claimOwnerStatus = () => go("owner", async () => {
    await billing.claimOwner(ownerId.trim());
    setOwnerId("");
    setMsg("Owner-Status freigeschaltet – dieses Konto ist dauerhaft von der Abo-Pflicht befreit.");
    setTimeout(() => billing.refresh(), 1500);
  });
  const isOwner = lic.status === "exempt";

  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>Abo &amp; Lizenz</h2>

      {isOwner ? (
        <p className="note" style={{ color: "var(--ok, #3ddc97)", fontSize: 14 }}>
          ✓ <strong>Owner-Status aktiv</strong> – dieses Konto nutzt iou.fm dauerhaft kostenfrei (keine Abo-Pflicht, kein Mitarbeiter-Limit).
        </p>
      ) : (
      <>
      {!lic.billingAvailable && (
        <p className="note" style={{ marginTop: 0 }}>Abo-Funktion ist serverseitig noch nicht eingerichtet (Stripe-Keys fehlen).</p>
      )}

      <div className="summary-bar" style={{ marginTop: 4 }}>
        <div className="stat"><div className="num" style={{ fontSize: 16 }}>{STATUS_LABEL[lic.status] || lic.status || "–"}</div><div className="lbl">Status</div></div>
        <div className="stat"><div className="num" style={{ fontSize: 16 }}>{planLabel}</div><div className="lbl">Tarif</div></div>
        <div className="stat"><div className="num">{seatsUsed}/{seatsAllowed}</div><div className="lbl">Mitarbeiter</div></div>
        {lic.status === "trialing" && <div className="stat"><div className="num">{lic.trialDaysLeft}</div><div className="lbl">Tage Test übrig</div></div>}
      </div>

      <h3 style={{ margin: "16px 0 6px", fontSize: 14 }}>{lic.status === "active" ? "Tarif wechseln" : "Tarif wählen"}</h3>
      <div className="row">
        {PLAN_INFO.map((p) => (
          <div key={p.key} className="field" style={{ flex: 1 }}>
            <button className={`btn ${lic.plan === p.key ? "" : "ghost"}`} style={{ width: "100%" }}
              disabled={busy === "checkout"} onClick={() => subscribe(p.key)}>
              {p.label} · {p.price}{p.period}
            </button>
          </div>
        ))}
      </div>
      <p className="note" style={{ margin: "6px 0 0" }}>{PRICE_NOTE}</p>

      <h3 style={{ margin: "16px 0 6px", fontSize: 14 }}>Mitarbeiter-Plätze</h3>
      <p className="note" style={{ marginTop: 0 }}>
        Jede Lizenz enthält {SEAT_INFO.base} Mitarbeiter. Weitere in {SEAT_INFO.pack}er-Paketen à {SEAT_INFO.packPrice} netto / Monat ({currentPacks} Paket{currentPacks === 1 ? "" : "e"} aktiv).
      </p>
      <div className="toolbar" style={{ margin: 0 }}>
        <button className="btn ghost" disabled={busy === "seats" || !lic.hasCustomer} onClick={addSeats}>+ {SEAT_INFO.pack} Mitarbeiter ({SEAT_INFO.packPrice})</button>
        {currentPacks > 0 && <button className="btn ghost" disabled={busy === "seats"} onClick={removeSeats}>− {SEAT_INFO.pack} Mitarbeiter</button>}
        <div className="spacer" />
        {lic.hasCustomer && <button className="btn ghost" disabled={busy === "portal"} onClick={portal}>{busy === "portal" ? "Öffne…" : "Abo verwalten / kündigen"}</button>}
      </div>
      {!lic.hasCustomer && <p className="note" style={{ marginTop: 8 }}>Sitzplätze lassen sich erweitern, sobald ein Abo aktiv ist.</p>}

      <details style={{ marginTop: 18 }}>
        <summary className="muted" style={{ cursor: "pointer", fontSize: 13 }}>Owner-Status freischalten (nur Anbieter)</summary>
        {tenantId && (
          <p className="note" style={{ marginTop: 8 }}>
            Mandanten-ID dieses Kontos: <code>{tenantId}</code> – für „kostenlos schalten" via Railway-Variable <code>EXEMPT_TENANTS</code>.
          </p>
        )}
        <p className="note" style={{ marginTop: 8 }}>Owner-ID eingeben, um dieses Konto dauerhaft kostenfrei zu schalten.</p>
        <div className="toolbar" style={{ margin: 0 }}>
          <input type="password" value={ownerId} onChange={(e) => setOwnerId(e.target.value)} placeholder="iou-owner-…" style={{ flex: 1, maxWidth: 360 }} />
          <button className="btn ghost" disabled={busy === "owner" || !ownerId.trim()} onClick={claimOwnerStatus}>{busy === "owner" ? "Prüfe…" : "Freischalten"}</button>
        </div>
      </details>
      </>
      )}

      {err && <p className="error-text" style={{ marginTop: 12 }}>{err}</p>}
      {msg && <p className="note" style={{ color: "var(--ok, #3ddc97)", marginTop: 12 }}>{msg}</p>}
    </div>
  );
}
