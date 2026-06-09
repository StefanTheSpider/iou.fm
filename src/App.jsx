import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import LockScreen from "./components/LockScreen.jsx";
import Stammdaten from "./components/Stammdaten.jsx";
import Lohn from "./components/Lohn.jsx";
import Erstattungen from "./components/Erstattungen.jsx";
import Rechnungspruefung from "./components/Rechnungspruefung.jsx";
import Archiv from "./components/Archiv.jsx";
import Setup from "./components/Setup.jsx";
import Footer from "./components/Footer.jsx";
import { saveVault, restoreSession, clearSession, addUser as vaultAddUser, removeUser as vaultRemoveUser } from "./lib/vault.js";
import * as Sync from "./lib/sync.js";
import { checkForUpdate } from "./lib/update.js";
import { getFeed, triggerSync, saveIntegration, getIntegration } from "./lib/feed.js";
import { Anfragen, Stornos } from "./components/ShopifyTabs.jsx";
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
  const sessionRef = useRef(null);
  const savedTimer = useRef(null);

  useEffect(() => { sessionRef.current = session; }, [session]);

  // Beim Start auf neue Version prüfen (nur Desktop-App; sonst still).
  useEffect(() => { checkForUpdate().then((u) => { if (u) setUpdate(u); }); }, []);

  useEffect(() => {
    restoreSession().then((s) => {
      if (s) { setSession(s); sessionRef.current = s; if (s.tenantId) { pullQuiet(); refreshFeed(); } }
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

  // Nach dem Anmelden den aktuellen Cloud-Stand + Shopify-Feed holen.
  const onUnlock = useCallback((s) => {
    setSession(s); sessionRef.current = s;
    if (s.tenantId) { pullQuiet(); refreshFeed(); }
  }, [pullQuiet, refreshFeed]);

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

  const { data } = session;
  const payoutMode = data.config?.payoutMode || "erstattung";
  const payoutLabel = payoutMode === "sammel" ? "Sammelüberweisung" : "Erstattungen";
  const setupDone = !!data.config?.setupComplete;
  const isAdmin = session.currentUser.role === "admin";
  const rechnungOn = !!data.config?.modules?.rechnung;
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
            <button className={`tab ${tab === "lohn" ? "active" : ""}`} onClick={() => setTab("lohn")}>Löhne</button>
            <button className={`tab ${tab === "erstattung" ? "active" : ""}`} onClick={() => setTab("erstattung")}>{payoutLabel}</button>
            {rechnungOn && <button className={`tab ${tab === "rechnung" ? "active" : ""}`} onClick={() => setTab("rechnung")}>Rechnungsprüfung</button>}
            <button className={`tab ${tab === "anfragen" ? "active" : ""}`} onClick={() => setTab("anfragen")}>Rückbuchungen</button>
            <button className={`tab ${tab === "stornos" ? "active" : ""}`} onClick={() => setTab("stornos")}>Stornos</button>
            <button className={`tab ${tab === "archiv" ? "active" : ""}`} onClick={() => setTab("archiv")}>Archiv</button>
            {isAdmin && <button className={`tab ${tab === "stammdaten" ? "active" : ""}`} onClick={() => setTab("stammdaten")}>Stammdaten</button>}
          </nav>
        )}
        <div className="spacer" />
        {saved && <span className="save-indicator show">✓ Gespeichert</span>}
        {dirty && <button className="btn small" onClick={commit}>Änderungen speichern</button>}
        <span className="user-chip">{session.currentUser.username}{session.currentUser.role === "admin" ? " · Admin" : ""}</span>
        <button className="lock-btn" onClick={lock}>🔒 Abmelden</button>
      </header>

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
            {tab === "lohn" && <Lohn data={data} updateData={updateData} canPay={isAdmin} />}
            {tab === "erstattung" && <Erstattungen data={data} updateData={updateData} profile={payoutMode} canPay={isAdmin} feed={feed} />}
            {tab === "rechnung" && rechnungOn && <Rechnungspruefung data={data} updateData={updateData} />}
            {tab === "anfragen" && <Anfragen feed={feed} onRefresh={refreshFeed} busy={feedBusy} />}
            {tab === "stornos" && <Stornos feed={feed} canPay={isAdmin} onRefresh={refreshFeed} busy={feedBusy} />}
            {tab === "archiv" && <Archiv data={data} canPay={isAdmin} />}
            {tab === "stammdaten" && isAdmin && (
              <Stammdaten data={data} updateData={updateData} sync={sync} shopify={shopify}
                auth={{ currentUser: session.currentUser, users: session.users, addUser, removeUser }} />
            )}
          </>
        )}
      </main>

      <Footer branding={branding} />
    </div>
  );
}
