import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import LockScreen from "./components/LockScreen.jsx";
import Stammdaten from "./components/Stammdaten.jsx";
import Lohn from "./components/Lohn.jsx";
import Erstattungen from "./components/Erstattungen.jsx";
import Rechnungspruefung from "./components/Rechnungspruefung.jsx";
import Rechnungen from "./components/Rechnungen.jsx";
import Archiv from "./components/Archiv.jsx";
import Setup from "./components/Setup.jsx";
import Footer from "./components/Footer.jsx";
import { saveVault, restoreSession, clearSession, addUser as vaultAddUser, removeUser as vaultRemoveUser } from "./lib/vault.js";
import * as Sync from "./lib/sync.js";
import { checkForUpdate } from "./lib/update.js";
import { getFeed, triggerSync, saveIntegration, getIntegration, getAccountant, saveAccountant, sendAccountantNow, pushAppRefunds } from "./lib/feed.js";
import { Anfragen, Stornos } from "./components/ShopifyTabs.jsx";
import OwnerPanel from "./components/OwnerPanel.jsx";
import { SupportApprovalModal, VendorSupport } from "./components/Support.jsx";
import { customerStatus } from "./lib/support.js";
import { DEMO_DATA } from "./lib/demoData.js";
import BRANDING from "./branding.js";
import { applyTheme } from "./lib/theme.js";

export default function App() {
  const [session, setSession] = useState(null); // { data, key, salt }
  const [restoring, setRestoring] = useState(true);
  const [tab, setTab] = useState("lohn");
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  const [update, setUpdate] = useState(null); // { version, notes, install }
  const [updating, setUpdating] = useState(false);
  const [updErr, setUpdErr] = useState("");
  const [feed, setFeed] = useState(null);       // Shopify-Feed vom Hub (Stornos/Refunds/Anfragen)
  const [feedBusy, setFeedBusy] = useState(false);
  const [ownerView, setOwnerView] = useState({ asUser: false, payout: null, rechnung: null, demo: false });
  const [supportStatus, setSupportStatus] = useState(null); // Kunde: offene Support-Anfragen
  const [showApproval, setShowApproval] = useState(false);
  const sessionRef = useRef(null);
  const savedTimer = useRef(null);

  useEffect(() => { sessionRef.current = session; }, [session]);

  // Löhne sind streng Admin-only: Mitarbeiter niemals auf dem Lohn-Tab landen lassen.
  useEffect(() => {
    if (session && session.currentUser.role !== "admin" && tab === "lohn") setTab("erstattung");
  }, [session, tab]);

  // Beim Start auf neue Version prüfen (nur Desktop-App; sonst still).
  useEffect(() => { checkForUpdate().then((u) => { if (u) setUpdate(u); }); }, []);

  useEffect(() => {
    restoreSession().then((s) => {
      if (s) { setSession(s); sessionRef.current = s; if (s.tenantId) { pullQuiet(); refreshFeed(); refreshSupport(); backfillAppRefunds(s); } }
    }).finally(() => setRestoring(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const branding = useMemo(() => {
    const b = session?.data?.branding || {};
    return { ...BRANDING, ...b, theme: { ...BRANDING.theme, ...(b.theme || {}) } };
  }, [session]);

  useEffect(() => { applyTheme(branding.theme); }, [branding.theme]);
  useEffect(() => { document.title = branding.productName; }, [branding.productName]);

  // Vor Verlassen warnen, wenn ungespeichert.
  useEffect(() => {
    const h = (e) => { if (dirty) { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  const flashSaved = useCallback(() => {
    setSaved(true);
    clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(() => setSaved(false), 1800);
  }, []);

  // Gemergte Daten aus dem Sync in die Session übernehmen.
  const applyMerged = useCallback((newData) => {
    const s = sessionRef.current; if (!s) return;
    const next = { ...s, data: newData };
    sessionRef.current = next; setSession(next);
  }, []);

  // Hochladen (mit Konflikt-Merge); bei Konflikt geänderte Daten lokal sichern.
  const pushQuiet = useCallback(async () => {
    if (!sessionRef.current?.tenantId) return;
    try {
      const res = await Sync.push(sessionRef.current);
      if (res?.data && res.data !== sessionRef.current.data) {
        applyMerged(res.data);
        await saveVault(sessionRef.current, res.data);
      }
    } catch (e) { console.warn("Sync (push) fehlgeschlagen:", e.message); }
  }, [applyMerged]);

  // Herunterladen + zusammenführen (beim Anmelden / manuell / Fenster-Fokus).
  const pullQuiet = useCallback(async () => {
    if (!sessionRef.current?.tenantId) return;
    try {
      const res = await Sync.pull(sessionRef.current);
      if (res?.data) { applyMerged(res.data); await saveVault(sessionRef.current, res.data); }
    } catch (e) { console.warn("Sync (pull) fehlgeschlagen:", e.message); }
  }, [applyMerged]);

  // Shopify-Feed (Stornos/Refunds/Anfragen) vom Hub laden.
  const refreshFeed = useCallback(async () => {
    if (!sessionRef.current?.tenantId) return;
    setFeedBusy(true);
    try { const f = await getFeed(sessionRef.current); if (f) setFeed(f); }
    catch (e) { console.warn("Feed laden fehlgeschlagen:", e.message); }
    finally { setFeedBusy(false); }
  }, []);

  // Kunde: prüfen, ob der Support Zugang angefragt hat (nicht in Support-Sitzungen).
  const refreshSupport = useCallback(async () => {
    const s = sessionRef.current;
    if (!s?.tenantId || s.currentUser?.support) return;
    try {
      const st = await customerStatus(s);
      setSupportStatus(st);
      if ((st.requests || []).length > 0) setShowApproval(true);
    } catch { /* offline egal */ }
  }, []);

  // Vendor: Support-Sitzung betreten/verlassen.
  const enterSupport = useCallback((supportSession) => {
    setSession(supportSession); sessionRef.current = supportSession;
    setFeed(null); setSupportStatus(null); setShowApproval(false); setTab("erstattung");
  }, []);
  const exitSupport = useCallback(async () => {
    const real = await restoreSession();
    if (real) { setSession(real); sessionRef.current = real; setTab("erstattung"); if (real.tenantId) { refreshFeed(); } }
    else { lock(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshFeed]);

  // Auto-Pull: aktuellen Cloud-Stand automatisch holen, wenn das Fenster wieder
  // in den Fokus kommt und alle 60 s – aber nur, wenn nichts Ungespeichertes
  // offen ist (sonst würden Eingaben überschrieben). Niemand muss „synchronisieren" klicken.
  useEffect(() => {
    if (!session || !session.tenantId) return;
    const maybePull = () => { if (!dirty && document.visibilityState === "visible") pullQuiet(); };
    window.addEventListener("focus", maybePull);
    document.addEventListener("visibilitychange", maybePull);
    const id = setInterval(maybePull, 60000);
    return () => {
      window.removeEventListener("focus", maybePull);
      document.removeEventListener("visibilitychange", maybePull);
      clearInterval(id);
    };
  }, [session, dirty, pullQuiet]);

  // Standard: Änderung wird nur im Speicher gehalten und als "ungespeichert"
  // markiert (Speichern-Button erscheint). Mit immediate=true sofort sichern.
  const updateData = useCallback((mutator, immediate = false) => {
    const prev = sessionRef.current;
    if (!prev) return;
    const nextData = mutator(prev.data);
    const next = { ...prev, data: nextData };
    sessionRef.current = next;
    setSession(next);
    if (immediate) {
      saveVault(next, nextData).then(() => { setDirty(false); flashSaved(); pushQuiet(); })
        .catch((e) => console.error("Speichern fehlgeschlagen", e));
    } else {
      setDirty(true);
    }
  }, [flashSaved, pushQuiet]);

  const commit = useCallback(() => {
    const s = sessionRef.current;
    if (!s) return;
    saveVault(s, s.data).then(() => { setDirty(false); flashSaved(); pushQuiet(); })
      .catch((e) => console.error("Speichern fehlgeschlagen", e));
  }, [flashSaved, pushQuiet]);

  function lock() {
    // window.confirm gibt es in der Desktop-WebView nicht – daher beim Abmelden
    // ungespeicherte Änderungen sicherheitshalber speichern (kein Datenverlust).
    const s = sessionRef.current;
    const finish = () => { clearSession(); setSession(null); sessionRef.current = null; setDirty(false); };
    if (dirty && s) saveVault(s, s.data).then(finish).catch(finish);
    else finish();
  }

  const addUser = useCallback(async (username, password, role) => {
    const users = await vaultAddUser(sessionRef.current, username, password, role);
    setSession((s) => (s ? { ...s, users } : s));
    if (sessionRef.current) sessionRef.current = { ...sessionRef.current, users };
  }, []);
  const removeUser = useCallback(async (username) => {
    const users = await vaultRemoveUser(sessionRef.current, username);
    setSession((s) => (s ? { ...s, users } : s));
    if (sessionRef.current) sessionRef.current = { ...sessionRef.current, users };
  }, []);

  // In iou.fm getätigte Erstattungen (ohne IBAN) für den Buchhalter-Export melden.
  const bookAppRefunds = useCallback(async (refunds) => {
    await pushAppRefunds(sessionRef.current, refunds);
    refreshFeed();
  }, [refreshFeed]);

  // Einmaliger Backfill: vorhandene Erstattungs-Batches (letzte ~3 Monate) nachmelden.
  const backfillAppRefunds = useCallback(async (sess) => {
    if (!sess?.tenantId || sess.currentUser?.support) return;
    const since = new Date(Date.now() - 95 * 864e5).toISOString().slice(0, 10);
    const summaries = [];
    for (const b of (sess.data?.batches || [])) {
      if (b.kind !== "erstattung") continue;
      const date = (b.execDate || b.createdAt || "").slice(0, 10);
      if (date && date < since) continue;
      for (const p of (b.payments || [])) {
        const m = String(p.purpose || "").match(/^Erstattung\s+(\S+)\s*(.*)$/i);
        summaries.push({
          orderNumber: m ? m[1].replace(/^#/, "") : "", customer: p.name || "",
          event: m ? m[2].trim() : "", purpose: p.purpose || "", amountCents: p.amountCents, date, currency: "EUR",
        });
      }
    }
    if (summaries.length) { try { await pushAppRefunds(sess, summaries); refreshFeed(); } catch { /* egal */ } }
  }, [refreshFeed]);

  // Nach dem Anmelden den aktuellen Cloud-Stand + Shopify-Feed holen.
  const onUnlock = useCallback((s) => {
    setSession(s); sessionRef.current = s;
    if (s.tenantId) { pullQuiet(); refreshFeed(); refreshSupport(); backfillAppRefunds(s); }
  }, [pullQuiet, refreshFeed, refreshSupport, backfillAppRefunds]);

  // Status/Manueller Refresh für die Stammdaten-Oberfläche (Sync läuft automatisch).
  const sync = useMemo(() => ({
    company: session?.company || "",
    run: async () => { await pullQuiet(); await pushQuiet(); },
  }), [session, pullQuiet, pushQuiet]);

  // Shopify-Integration (nur Admin): Server-Konfig + manueller Abgleich.
  const shopify = useMemo(() => ({
    getIntegration: () => getIntegration(sessionRef.current),
    save: (cfg) => saveIntegration(sessionRef.current, cfg),
    syncNow: async () => { const r = await triggerSync(sessionRef.current); await refreshFeed(); return r; },
  }), [refreshFeed]);

  const accountant = useMemo(() => ({
    get: () => getAccountant(sessionRef.current),
    save: (cfg) => saveAccountant(sessionRef.current, cfg),
    sendNow: (month) => sendAccountantNow(sessionRef.current, month),
  }), []);

  const UpdateBanner = () => update ? (
    <div className="update-banner">
      <span>Neue Version <strong>{update.version}</strong> verfügbar.</span>
      <button className="btn small" disabled={updating} onClick={async () => {
        setUpdErr(""); setUpdating(true);
        try { await update.install(); }
        catch (e) { setUpdating(false); setUpdErr(e.message || String(e)); }
      }}>{updating ? "Installiere…" : "Jetzt aktualisieren & neu starten"}</button>
      <button className="link-btn" onClick={() => setUpdate(null)}>später</button>
      {updErr && <span style={{ opacity: 0.85 }}>· Fehler: {updErr}</span>}
    </div>
  ) : null;

  if (restoring) {
    return <div className="lock-screen"><div className="muted">Wird entsperrt…</div></div>;
  }
  if (!session) {
    return <><UpdateBanner /><LockScreen onUnlock={onUnlock} branding={branding} /></>;
  }

  // Owner-Modus: live zwischen Modi umschalten (reine Vorschau, ändert nichts Echtes).
  const isOwner = session.currentUser.owner === true;
  const inSupport = session.currentUser.support === true; // Vendor in fremdem Kundenkonto
  const ov = isOwner ? ownerView : { asUser: false, payout: null, rechnung: null, demo: false };
  const demoMode = !!ov.demo;
  const data = demoMode ? DEMO_DATA : session.data;
  const effUpdateData = demoMode ? () => {} : updateData; // im Demo-Modus nichts speichern
  const payoutMode = ov.payout || data.config?.payoutMode || "erstattung";
  const payoutLabel = payoutMode === "sammel" ? "Sammelüberweisung" : "Erstattungen";
  const setupDone = !!data.config?.setupComplete;
  const isAdmin = (session.currentUser.role === "admin") && !ov.asUser;
  const rechnungOn = ov.rechnung != null ? ov.rechnung : !!data.config?.modules?.rechnung;
  const rechnungZahlungOn = !!data.config?.modules?.rechnungZahlung;
  const Brand = () => branding.logoUrl
    ? <img className="logo-img" src={branding.logoUrl} alt={branding.productName} />
    : <>{branding.brandText}<span>{branding.brandAccent}</span></>;

  return (
    <div className="app">
      <UpdateBanner />
      <header className="topbar">
        <div className="brand"><Brand /></div>
        {setupDone && (
          <nav className="tabs">
            {isAdmin && <button className={`tab ${tab === "lohn" ? "active" : ""}`} onClick={() => setTab("lohn")}>Löhne</button>}
            <button className={`tab ${tab === "erstattung" ? "active" : ""}`} onClick={() => setTab("erstattung")}>{payoutLabel}</button>
            {rechnungOn && <button className={`tab ${tab === "rechnung" ? "active" : ""}`} onClick={() => setTab("rechnung")}>Rechnungsprüfung</button>}
            {rechnungZahlungOn && <button className={`tab ${tab === "rechnungen" ? "active" : ""}`} onClick={() => setTab("rechnungen")}>Rechnungen</button>}
            <button className={`tab ${tab === "anfragen" ? "active" : ""}`} onClick={() => setTab("anfragen")}>Rückbuchungen</button>
            <button className={`tab ${tab === "stornos" ? "active" : ""}`} onClick={() => setTab("stornos")}>Stornos</button>
            <button className={`tab ${tab === "archiv" ? "active" : ""}`} onClick={() => setTab("archiv")}>Archiv</button>
            {isAdmin && <button className={`tab ${tab === "stammdaten" ? "active" : ""}`} onClick={() => setTab("stammdaten")}>Stammdaten</button>}
            {isOwner && <button className={`tab ${tab === "support" ? "active" : ""}`} onClick={() => setTab("support")}>Support</button>}
          </nav>
        )}
        <div className="spacer" />
        {saved && <span className="save-indicator show">✓ Gespeichert</span>}
        {dirty && <button className="btn small" onClick={commit}>Änderungen speichern</button>}
        <span className="user-chip">{session.currentUser.username}{session.currentUser.role === "admin" ? " · Admin" : ""}</span>
        <button className="lock-btn" onClick={lock}>🔒 Abmelden</button>
      </header>

      {inSupport && (
        <div className="support-banner">
          ⚠ SUPPORT-SITZUNG im Kundenkonto „{session.company || session.tenantId}"
          {session.supportGrant?.expiresAt ? ` · gültig bis ${new Date(session.supportGrant.expiresAt).toLocaleString("de-DE")}` : ""}
          <button className="btn small" style={{ marginLeft: 12 }} onClick={exitSupport}>Sitzung beenden</button>
        </div>
      )}

      {isOwner && (ov.asUser || ov.payout || ov.rechnung != null || ov.demo) && (
        <div className="owner-banner">
          Owner-Vorschau aktiv{ov.demo ? " · Demo-Daten" : ""}{ov.asUser ? " · Ansicht: Mitarbeiter" : ""}
          {ov.payout ? ` · ${ov.payout === "sammel" ? "Sammelüberweisung" : "Erstattungen"}` : ""}
          {ov.rechnung != null ? ` · Rechnungsprüfung ${ov.rechnung ? "an" : "aus"}` : ""} — keine echten Daten betroffen.
        </div>
      )}

      <main className="main">
        {!setupDone ? (
          isAdmin ? (
            <Setup data={data} updateData={updateData}
              onComplete={() => updateData((d) => ({ ...d, config: { ...(d.config || {}), setupComplete: true } }), true)} />
          ) : (
            <div className="card muted" style={{ textAlign: "center", padding: 48 }}>
              Die App wird gerade von einem Administrator eingerichtet. Bitte später erneut anmelden.
            </div>
          )
        ) : (
          <>
            {tab === "lohn" && isAdmin && <Lohn data={data} updateData={effUpdateData} canPay={isAdmin} />}
            {tab === "erstattung" && <Erstattungen data={data} updateData={effUpdateData} profile={payoutMode} canPay={isAdmin} feed={feed} onAppRefunds={demoMode ? null : bookAppRefunds} />}
            {tab === "rechnung" && rechnungOn && <Rechnungspruefung data={data} updateData={effUpdateData} />}
            {tab === "rechnungen" && rechnungZahlungOn && <Rechnungen data={data} updateData={effUpdateData} canPay={isAdmin} />}
            {tab === "anfragen" && <Anfragen feed={feed} onRefresh={refreshFeed} busy={feedBusy} />}
            {tab === "stornos" && <Stornos feed={feed} canPay={isAdmin} onRefresh={refreshFeed} busy={feedBusy} />}
            {tab === "archiv" && <Archiv data={data} canPay={isAdmin} />}
            {tab === "stammdaten" && isAdmin && (
              <Stammdaten data={data} updateData={effUpdateData} sync={sync} shopify={shopify} accountant={accountant}
                auth={{ currentUser: session.currentUser, users: session.users, addUser, removeUser }} />
            )}
            {tab === "support" && isOwner && <VendorSupport onOpenSession={enterSupport} />}
          </>
        )}
      </main>

      {isOwner && !inSupport && (
        <OwnerPanel view={ownerView} setView={setOwnerView}
          payoutMode={session.data.config?.payoutMode || "erstattung"}
          rechnungOn={!!session.data.config?.modules?.rechnung} />
      )}
      {showApproval && !inSupport && supportStatus && (
        <SupportApprovalModal session={session} status={supportStatus}
          onClose={() => setShowApproval(false)} onChanged={refreshSupport} />
      )}
      <Footer branding={branding} />
    </div>
  );
}
