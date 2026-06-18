import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import LockScreen from "./components/LockScreen.jsx";
import Paywall from "./components/Paywall.jsx";
import Stammdaten from "./components/Stammdaten.jsx";
import Lohn from "./components/Lohn.jsx";
import Erstattungen from "./components/Erstattungen.jsx";
import Rechnungspruefung from "./components/Rechnungspruefung.jsx";
import Rechnungen from "./components/Rechnungen.jsx";
import Archiv from "./components/Archiv.jsx";
import Setup from "./components/Setup.jsx";
import Footer from "./components/Footer.jsx";
import Toaster from "./components/Toaster.jsx";
import { saveVault, restoreSession, clearSession, addUser as vaultAddUser, removeUser as vaultRemoveUser, enableBiometric, bioAvailable, bioEnabledUser } from "./lib/vault.js";
import * as Sync from "./lib/sync.js";
import { checkForUpdate } from "./lib/update.js";
import { fetchMailInvoices } from "./lib/mailInvoices.js";
import { toast } from "./lib/toast.js";
import { getFeed, triggerSync, saveIntegration, getIntegration, shopifyOAuthStart, getAccountant, saveAccountant, sendAccountantNow, pushAppRefunds, sendInvoiceBelege, getInbox, saveInbox, getBelege, getBelegFiles, openBelegFile, fetchBelegFileBytes, uploadRechnungBelege, sendRechnungBelege } from "./lib/feed.js";
import { invoke } from "@tauri-apps/api/core";
import { getLicense, startCheckout, openPortal, setSeatPacks, claimOwner, licenseAllowsEbics, getOwnerCustomers } from "./lib/billing.js";

import { openExternal } from "./lib/openExternal.js";
// Bedienungsanleitung (auf der Landingpage gepflegt).
const HELP_URL = "https://stefanthespider.github.io/iou.fm/anleitung.html";
const openHelp = () => openExternal(HELP_URL);
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
  const [dirtyCount, setDirtyCount] = useState(0); // Anzahl ungespeicherter Änderungen (für den Button-Text)
  const [saved, setSaved] = useState(false);
  const [update, setUpdate] = useState(null); // { version, notes, install }
  const [updChecked, setUpdChecked] = useState(false); // Update-Prüfung abgeschlossen (für Lock-Screen-Auto-Login)
  const [updating, setUpdating] = useState(false);
  const [updErr, setUpdErr] = useState("");
  const [saveErr, setSaveErr] = useState(""); // sichtbarer Hinweis, falls lokales Speichern fehlschlägt
  const [feed, setFeed] = useState(null);       // Shopify-Feed vom Hub (Stornos/Refunds/Anfragen)
  const [feedBusy, setFeedBusy] = useState(false);
  const [ownerView, setOwnerView] = useState({ asUser: false, payout: null, rechnung: null, demo: false });
  const [supportStatus, setSupportStatus] = useState(null); // Kunde: offene Support-Anfragen
  const [showApproval, setShowApproval] = useState(false);
  const [bioOffer, setBioOffer] = useState(false); // „Touch ID aktivieren?"-Banner
  const [license, setLicense] = useState(null);    // Abo-/Lizenzstatus vom Hub
  const [billingBusy, setBillingBusy] = useState("");
  const [billingErr, setBillingErr] = useState("");
  const [showPaywall, setShowPaywall] = useState(false);

  // Biometrie anbieten, wenn verfügbar und noch nicht eingerichtet (echte Sitzung).
  useEffect(() => {
    (async () => {
      if (session && !session.currentUser?.support && await bioAvailable() && !bioEnabledUser()) setBioOffer(true);
      else setBioOffer(false);
    })();
  }, [session]);
  const sessionRef = useRef(null);
  const savedTimer = useRef(null);
  const dirtyRef = useRef(false); // Spiegel von `dirty` für async Callbacks (Pull darf nichts überschreiben)

  useEffect(() => { sessionRef.current = session; }, [session]);
  useEffect(() => { dirtyRef.current = dirty; }, [dirty]);

  // Lizenz-/Abo-Status laden (nicht im Vendor-Support-Modus).
  const refreshLicense = useCallback(async () => {
    const s = sessionRef.current;
    if (!s?.tenantId || s.currentUser?.support) { setLicense(null); return; }
    try { setLicense(await getLicense(s)); } catch { /* still */ }
  }, []);
  useEffect(() => { refreshLicense(); }, [session?.tenantId, refreshLicense]);

  // Abo abschließen: Stripe-Bezahlseite öffnen und auf Freischaltung warten.
  async function subscribe(plan) {
    setBillingErr(""); setBillingBusy("checkout");
    try {
      const { url } = await startCheckout(sessionRef.current, plan);
      await openExternal(url);
      const started = Date.now();
      const poll = setInterval(async () => {
        try {
          const lic = await getLicense(sessionRef.current);
          if (lic) setLicense(lic);
          if (lic?.active && lic.status === "active") { clearInterval(poll); setBillingBusy(""); setShowPaywall(false); }
        } catch { /* weiter */ }
        if (Date.now() - started > 5 * 60 * 1000) { clearInterval(poll); setBillingBusy(""); }
      }, 4000);
    } catch (e) { setBillingErr(e.message || "Fehler."); setBillingBusy(""); }
  }
  async function manageBilling() {
    setBillingErr(""); setBillingBusy("portal");
    try { const { url } = await openPortal(sessionRef.current); await openExternal(url); setTimeout(refreshLicense, 8000); }
    catch (e) { setBillingErr(e.message || "Fehler."); }
    finally { setBillingBusy(""); }
  }

  // Löhne sind streng Admin-only: Mitarbeiter niemals auf dem Lohn-Tab landen lassen.
  useEffect(() => {
    if (session && session.currentUser.role !== "admin" && tab === "lohn") setTab("erstattung");
  }, [session, tab]);

  // Auf neue Version prüfen – beim Start UND danach laufend (alle 15 min + bei Fenster-Fokus),
  // damit der „Jetzt aktualisieren"-Button auch im laufenden Betrieb erscheint, ohne Neustart.
  // Den Lock-Screen-Auto-Login (Biometrie) erst nach der ersten Prüfung auslösen, damit ein
  // vorhandenes Update VOR dem Anmelden installiert wird (kein doppeltes Login). Erste Prüfung
  // spätestens nach 6 s freigeben, falls sie hängt (offline).
  useEffect(() => {
    let cancelled = false;
    const run = () => checkForUpdate()
      .then((u) => { if (u && !cancelled) setUpdate(u); })
      .catch(() => {});
    const t = setTimeout(() => { if (!cancelled) setUpdChecked(true); }, 6000);
    run().finally(() => { clearTimeout(t); if (!cancelled) setUpdChecked(true); });
    const iv = setInterval(run, 15 * 60 * 1000);
    const onFocus = () => run();
    window.addEventListener("focus", onFocus);
    return () => { cancelled = true; clearTimeout(t); clearInterval(iv); window.removeEventListener("focus", onFocus); };
  }, []);

  // Zentrale Update-Installation: lädt + installiert und startet die App neu (kehrt bei
  // Erfolg nicht zurück). Bei Fehler Loader aus + Meldung, damit man normal weiterarbeiten kann.
  const runUpdate = useCallback(async () => {
    if (!update) return;
    setUpdErr(""); setUpdating(true);
    try { await update.install(); }
    catch (e) { setUpdating(false); setUpdErr(e.message || String(e)); throw e; }
  }, [update]);

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

  // Hell/Dunkel ist eine PERSÖNLICHE Einstellung pro Gerät/Nutzer (localStorage),
  // NICHT Teil der synchronisierten Tenant-Daten. So ändert die Wahl eines Nutzers
  // nicht die Darstellung aller anderen. Logo/Farben bleiben White-Label (geteilt).
  const [userMode, setUserMode] = useState(() => {
    try { return localStorage.getItem("iou.themeMode") || ""; } catch { return ""; }
  });
  const setThemeMode = useCallback((m) => {
    try { if (m) localStorage.setItem("iou.themeMode", m); else localStorage.removeItem("iou.themeMode"); } catch { /* ignore */ }
    setUserMode(m || "");
  }, []);
  // Persönlicher Modus gewinnt; sonst der White-Label-Vorgabemodus des Tenants.
  const effectiveTheme = useMemo(
    () => ({ ...branding.theme, mode: userMode || branding.theme.mode }),
    [branding.theme, userMode]
  );

  useEffect(() => { applyTheme(effectiveTheme); }, [effectiveTheme]);
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
      // Während des Pulls könnte der Nutzer schon etwas geändert haben (z. B. erste Rechnung
      // hinzugefügt). Dann NICHT überschreiben – sonst verschwindet die Eingabe wieder.
      if (res?.data && !dirtyRef.current) { applyMerged(res.data); await saveVault(sessionRef.current, res.data); }
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
      saveVault(next, nextData).then(() => { setDirty(false); setDirtyCount(0); setSaveErr(""); flashSaved(); pushQuiet(); })
        .catch((e) => { console.error("Speichern fehlgeschlagen", e); setSaveErr("Speichern fehlgeschlagen – deine letzte Änderung wurde NICHT gespeichert. Bitte erneut versuchen."); });
    } else {
      setDirty(true);
      setDirtyCount((n) => n + 1);
    }
  }, [flashSaved, pushQuiet]);

  const commit = useCallback(() => {
    const s = sessionRef.current;
    if (!s) return;
    saveVault(s, s.data).then(() => { setDirty(false); setDirtyCount(0); setSaveErr(""); flashSaved(); pushQuiet(); })
      .catch((e) => { console.error("Speichern fehlgeschlagen", e); setSaveErr("Speichern fehlgeschlagen – deine Änderungen wurden NICHT gespeichert. Bitte erneut versuchen."); });
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
    connect: (shop) => shopifyOAuthStart(sessionRef.current, shop),
    syncNow: async () => { const r = await triggerSync(sessionRef.current); await refreshFeed(); return r; },
  }), [refreshFeed]);

  const accountant = useMemo(() => ({
    get: () => getAccountant(sessionRef.current),
    save: (cfg) => saveAccountant(sessionRef.current, cfg),
    sendNow: (month) => sendAccountantNow(sessionRef.current, month),
  }), []);

  // Belege per E-Mail (Inbox-Adresse, Weiterleitung, Archiv).
  const inbox = useMemo(() => ({
    get: () => getInbox(sessionRef.current),
    save: (cfg) => saveInbox(sessionRef.current, cfg),
    clearConfirm: () => saveInbox(sessionRef.current, { clearDatevConfirm: true }),
    clearNotices: () => saveInbox(sessionRef.current, { clearDatevNotices: true }),
    belege: () => getBelege(sessionRef.current),
    files: (beId) => getBelegFiles(sessionRef.current, beId),
    openFile: (beId, name) => openBelegFile(sessionRef.current, beId, name),
    fileBytes: (beId, name) => fetchBelegFileBytes(sessionRef.current, beId, name),
  }), []);

  // Per E-Mail weitergeleitete Rechnungen automatisch im Hintergrund einlesen – sobald sie
  // eingehen, nicht erst beim Öffnen des Rechnungen-Tabs. Idempotent (Dubletten-/Seen-Schutz).
  const mailSyncBusy = useRef(false);
  const syncMailInvoices = useCallback(async () => {
    const s = sessionRef.current;
    if (!s?.tenantId || s.currentUser?.support || mailSyncBusy.current) return;
    mailSyncBusy.current = true;
    try {
      const d = s.data || {};
      const { newRows, newSeen } = await fetchMailInvoices({
        mailbox: inbox, invoices: d.invoices || [], creditors: d.creditors || {},
        accounts: d.accounts || [], seenIds: d.invoiceMailSeen || [],
      });
      if (newRows.length || newSeen.length) {
        updateData((dd) => ({
          ...dd,
          invoices: [...newRows, ...(dd.invoices || [])],
          invoiceMailSeen: [...((dd.invoiceMailSeen) || []), ...newSeen].slice(-3000),
        }), true);
        if (newRows.length) toast(`📥 ${newRows.length} neue Rechnung${newRows.length === 1 ? "" : "en"} per E-Mail eingegangen – bitte im Rechnungen-Tab prüfen.`);
      }
    } catch { /* offline → beim nächsten Mal */ }
    finally { mailSyncBusy.current = false; }
  }, [inbox, updateData]);

  useEffect(() => {
    if (!session?.tenantId) return;
    const t = setTimeout(syncMailInvoices, 1500);          // kurz nach Login
    const iv = setInterval(syncMailInvoices, 90 * 1000);   // danach laufend
    const onFocus = () => syncMailInvoices();              // beim Zurückkommen ins Fenster
    window.addEventListener("focus", onFocus);
    return () => { clearTimeout(t); clearInterval(iv); window.removeEventListener("focus", onFocus); };
  }, [session?.tenantId, syncMailInvoices]);

  // Abo/Lizenz-Aktionen für die Stammdaten-Oberfläche.
  const billing = useMemo(() => ({
    get: () => getLicense(sessionRef.current),
    checkout: (plan) => startCheckout(sessionRef.current, plan),
    portal: () => openPortal(sessionRef.current),
    seats: (packs) => setSeatPacks(sessionRef.current, packs),
    claimOwner: (ownerId) => claimOwner(sessionRef.current, ownerId),
    customers: () => getOwnerCustomers(sessionRef.current),
    open: openExternal,
    refresh: refreshLicense,
  }), [refreshLicense]);

  const UpdateBanner = () => update ? (
    <div className="update-banner">
      <span>🔄 Neue Version <strong>{update.version}</strong> verfügbar.</span>
      <button className="btn small" disabled={updating} onClick={() => { runUpdate().catch(() => {}); }}>
        {updating ? "Installiere…" : "Jetzt aktualisieren"}
      </button>
      <button className="link-btn" onClick={() => setUpdate(null)}>später</button>
      {updErr && <span style={{ opacity: 0.85 }}>· Fehler: {updErr}</span>}
    </div>
  ) : null;

  // Vollbild-Loader während der Aktualisierung (Download/Installation/Neustart).
  const UpdatingOverlay = () => updating ? (
    <div className="update-overlay">
      <div className="spinner" />
      <div className="update-overlay-text">Einen Moment bitte – die App wird auf den neuesten Stand gebracht…</div>
      <div className="update-overlay-sub">Die App startet gleich automatisch neu.</div>
    </div>
  ) : null;

  if (restoring) {
    return <><UpdatingOverlay /><div className="lock-screen"><div className="muted">Wird entsperrt…</div></div></>;
  }
  if (!session) {
    return <><UpdatingOverlay /><UpdateBanner />
      <LockScreen update={update} updReady={updChecked} onUpdate={runUpdate} onUnlock={onUnlock} branding={branding} /></>;
  }

  // Vendor-Owner: NUR das per OWNER_ID freigeschaltete Anbieter-Konto (nicht jeder Mandanten-
  // Gründer!). Nur dieses Konto hat Vendor-Rechte: Support-Login in andere Konten + Modus-Vorschau.
  const inSupport = session.currentUser.support === true; // Vendor in fremdem Kundenkonto
  const isOwner = !!license?.isOwnerTenant && !inSupport;
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
  const ebicsAllowed = licenseAllowsEbics(license); // EBICS nur Bank-Tarif (zahlend) oder Sonderstatus

  // Lizenz-Sperre: nur wenn Durchsetzung aktiv und kein gültiges Abo/Trial (nie im Support-/Demo-Modus).
  const billingBlocked = license && license.enforce && !license.active && !inSupport && !demoMode;
  if (billingBlocked || (showPaywall && !inSupport)) {
    return (
      <>
        <UpdatingOverlay />
        <UpdateBanner />
        <Paywall
          license={license}
          onSubscribe={subscribe}
          onManage={manageBilling}
          onLogout={lock}
          onClose={billingBlocked ? undefined : () => setShowPaywall(false)}
          busy={billingBusy}
          error={billingErr}
          branding={branding}
        />
      </>
    );
  }

  const Brand = () => branding.logoUrl
    ? <img className="logo-img" src={branding.logoUrl} alt={branding.productName} />
    : <>{branding.brandText}<span>{branding.brandAccent}</span></>;

  return (
    <div className="app">
      <Toaster />
      <UpdatingOverlay />
      <UpdateBanner />
      {saveErr && (
        <div className="owner-banner" style={{ background: "rgba(255,107,107,.14)", borderColor: "rgba(255,107,107,.6)", color: "#ffb3b3" }}>
          ⚠ {saveErr}
          <button className="btn small" style={{ marginLeft: 12 }} onClick={commit}>Jetzt erneut speichern</button>
          <button className="btn small ghost" style={{ marginLeft: 8 }} onClick={() => setSaveErr("")}>ausblenden</button>
        </div>
      )}
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
        {dirty && (
          <button className="btn" onClick={commit} style={{ boxShadow: "0 0 0 3px rgba(231,177,90,.25)", fontWeight: 700 }} title="Noch nicht gespeicherte Änderungen jetzt sichern">
            💾 {dirtyCount > 1 ? "Änderungen speichern" : "Änderung speichern"}
          </button>
        )}
        <button className="lock-btn" onClick={() => setThemeMode(effectiveTheme.mode === "light" ? "dark" : "light")} title="Hell/Dunkel umschalten (nur für dich, auf diesem Gerät)" aria-label="Darstellung umschalten">
          {effectiveTheme.mode === "light" ? "🌙 Dunkel" : "☀️ Hell"}
        </button>
        <button className="lock-btn" onClick={openHelp} title="Bedienungsanleitung öffnen" aria-label="Bedienungsanleitung">📖 Anleitung</button>
        <span className="user-chip">{session.currentUser.username}{session.currentUser.role === "admin" ? " · Admin" : ""}</span>
        <button className="lock-btn" onClick={lock}>🔒 Abmelden</button>
      </header>

      {license?.status === "trialing" && license?.active && !inSupport && (
        <div className="owner-banner" style={{ background: "linear-gradient(90deg, rgba(201,162,75,.18), rgba(201,162,75,.06))", borderColor: "rgba(201,162,75,.5)", color: "#e7c982" }}>
          Testphase – noch <strong>{license.trialDaysLeft} Tag{license.trialDaysLeft === 1 ? "" : "e"}</strong>.
          <button className="btn small" style={{ marginLeft: 12 }} onClick={() => setShowPaywall(true)}>Jetzt abonnieren</button>
        </div>
      )}
      {license && license.status === "past_due" && !inSupport && (
        <div className="owner-banner" style={{ background: "rgba(255,107,107,.12)", borderColor: "rgba(255,107,107,.5)", color: "#ffb3b3" }}>
          Zahlung offen – bitte das Zahlungsmittel prüfen.
          <button className="btn small" style={{ marginLeft: 12 }} onClick={manageBilling} disabled={!!billingBusy}>Abo verwalten</button>
        </div>
      )}

      {bioOffer && !inSupport && (
        <div className="owner-banner" style={{ background: "linear-gradient(90deg, rgba(61,220,151,.16), rgba(61,220,151,.06))", borderColor: "rgba(61,220,151,.5)", color: "#7ef0bd" }}>
          Schneller anmelden: <strong>Touch ID / Windows Hello</strong> für dieses Gerät aktivieren?
          <button className="btn small" style={{ marginLeft: 12 }} onClick={async () => {
            try { await enableBiometric(sessionRef.current); setBioOffer(false); } catch (e) { setUpdErr("Biometrie konnte nicht aktiviert werden: " + (e.message || "")); }
          }}>Aktivieren</button>
          <button className="btn small ghost" style={{ marginLeft: 8 }} onClick={() => setBioOffer(false)}>Später</button>
        </div>
      )}

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
            {tab === "lohn" && isAdmin && <Lohn data={data} updateData={effUpdateData} canPay={isAdmin} ebicsAllowed={ebicsAllowed} />}
            {tab === "erstattung" && <Erstattungen data={data} updateData={effUpdateData} profile={payoutMode} canPay={isAdmin} feed={feed} onAppRefunds={demoMode ? null : bookAppRefunds} userName={session.currentUser.username} ebicsAllowed={ebicsAllowed} />}
            {tab === "rechnung" && rechnungOn && <Rechnungspruefung data={data} updateData={effUpdateData} />}
            {tab === "rechnungen" && rechnungZahlungOn && <Rechnungen data={data} updateData={effUpdateData} canPay={isAdmin} userName={session.currentUser.username} ebicsAllowed={ebicsAllowed} onSendBelege={demoMode ? null : (payload) => sendInvoiceBelege(sessionRef.current, payload)} onUploadBelege={demoMode ? null : (batchId, files) => uploadRechnungBelege(sessionRef.current, batchId, files)} onSendRechnungBelege={demoMode ? null : (batchId) => sendRechnungBelege(sessionRef.current, batchId)} mailbox={demoMode ? null : inbox} />}
            {tab === "anfragen" && <Anfragen feed={feed} onRefresh={refreshFeed} busy={feedBusy} />}
            {tab === "stornos" && <Stornos feed={feed} canPay={isAdmin} onRefresh={refreshFeed} busy={feedBusy} />}
            {tab === "archiv" && <Archiv data={data} canPay={isAdmin} onSendRechnungBelege={demoMode ? null : (batchId) => sendRechnungBelege(sessionRef.current, batchId)} />}
            {tab === "stammdaten" && isAdmin && (
              <Stammdaten data={data} updateData={effUpdateData} sync={sync} shopify={shopify} accountant={accountant}
                billing={billing} license={license} ebicsAllowed={ebicsAllowed} tenantId={session.tenantId} inbox={inbox}
                themeMode={effectiveTheme.mode} onThemeMode={setThemeMode}
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
