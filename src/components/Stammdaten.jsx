import { useState, useEffect } from "react";
import { inspectIban, formatIban } from "../lib/iban.js";
import { normalizeColor } from "../lib/theme.js";
import { invoke } from "@tauri-apps/api/core";
import CloudSync from "./CloudSync.jsx";
import EbicsSettings from "./EbicsSettings.jsx";
import BillingSettings from "./BillingSettings.jsx";

// URL im System-Browser öffnen (Tauri), im Browser-Dev als neuer Tab.
async function openExternal(url) {
  try { await invoke("open_external", { url }); }
  catch { window.open(url, "_blank", "noopener"); }
}

function IbanStatus({ info }) {
  if (!info) return null;
  if (info.ok)
    return (
      <span className="pill ok">🟢 gültig{info.bic ? ` · ${info.bic}` : ""}</span>
    );
  return <span className="pill bad">🔴 {info.reason}</span>;
}

function useIbanField() {
  const [value, setValue] = useState("");
  const [info, setInfo] = useState(null);
  async function check(v, online = false) {
    if (!v.trim()) { setInfo(null); return null; }
    const r = await inspectIban(v, { online });
    setInfo(r);
    return r;
  }
  return { value, setValue, info, setInfo, check };
}

export default function Stammdaten({ data, updateData, auth, sync, shopify, accountant, billing, license, ebicsAllowed = false, tenantId = "" }) {
  const isAdmin = auth?.currentUser?.role === "admin";
  return (
    <div>
      <h1>Stammdaten</h1>
      <p className="sub">Auftraggeberkonten, Zugänge, Shop-Anbindung und Darstellung – verschlüsselt lokal gespeichert.</p>
      {isAdmin && billing && <BillingSettings billing={billing} license={license} tenantId={tenantId} />}
      {auth && <Users auth={auth} />}
      {isAdmin && sync && <CloudSync sync={sync} />}
      {isAdmin && <ModuleConfig data={data} updateData={updateData} />}
      {auth?.currentUser?.role === "admin" && <DatevConfig data={data} updateData={updateData} />}
      <Accounts data={data} updateData={updateData} />
      <Suppliers data={data} updateData={updateData} />
      <ShopifySettings data={data} updateData={updateData} shopify={isAdmin ? shopify : null} />
      {isAdmin && <EcommerceSettings data={data} updateData={updateData} />}
      {isAdmin && <EbicsSettings data={data} updateData={updateData} allowed={ebicsAllowed} />}
      {isAdmin && accountant && <AccountantSettings accountant={accountant} />}
      <Branding data={data} updateData={updateData} />
    </div>
  );
}

function DatevConfig({ data, updateData }) {
  const d = data.config?.datev || {};
  const set = (patch) => updateData((x) => ({
    ...x, config: { ...(x.config || {}), datev: { ...((x.config || {}).datev || {}), ...patch } },
  }));
  const f = (key, ph) => (
    <input type="text" value={d[key] ?? ""} placeholder={ph} onChange={(e) => set({ [key]: e.target.value })} />
  );
  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>DATEV-Export</h2>
      <p className="note">Für den Buchhaltungs-Export im Archiv (DATEV-Buchungsstapel). Die genauen Sachkonten bitte mit dem Steuerberater abstimmen (SKR03/04 unterscheiden sich).</p>
      <div className="row">
        <label className="field"><span>Berater-Nr.</span>{f("berater", "z. B. 341513")}</label>
        <label className="field"><span>Mandanten-Nr.</span>{f("mandant", "z. B. 50852")}</label>
        <label className="field"><span>Wirtschaftsjahr-Beginn (JJJJMMTT)</span>{f("wjBeginn", "20260101")}</label>
      </div>
      <div className="row">
        <label className="field"><span>Geldkonto (Bank)</span>{f("bankKonto", "1200")}</label>
        <label className="field"><span>Konto Löhne</span>{f("kontoLohn", "4120")}</label>
        <label className="field"><span>Konto Erstattungen</span>{f("kontoErstattung", "4830")}</label>
        <label className="field"><span>Konto Sammelüberw.</span>{f("kontoSammel", "4980")}</label>
      </div>
    </div>
  );
}

function Suppliers({ data, updateData }) {
  const iban = useIbanField();
  const [name, setName] = useState("");
  const [purpose, setPurpose] = useState("");
  const suppliers = data.suppliers || [];

  async function add(e) {
    e.preventDefault();
    const info = await iban.check(iban.value);
    if (!info?.ok) return;
    updateData((d) => ({
      ...d,
      suppliers: [...(d.suppliers || []), { id: crypto.randomUUID(), name: name.trim(), iban: info.iban, bic: info.bic || "", purpose: purpose.trim() }],
    }));
    setName(""); setPurpose(""); iban.setValue(""); iban.setInfo(null);
  }
  const remove = (id) => updateData((d) => ({ ...d, suppliers: (d.suppliers || []).filter((s) => s.id !== id) }));

  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>Lieferanten / Empfänger ({suppliers.length})</h2>
      <p className="note">Wiederkehrende Empfänger – einmal anlegen, dann in der Rechnungsprüfung & Sammelüberweisung auswählen.</p>
      {suppliers.length > 0 && (
        <div className="table-wrap" style={{ marginBottom: 16 }}>
          <table>
            <thead><tr><th>Name</th><th>IBAN</th><th>BIC</th><th></th></tr></thead>
            <tbody>{suppliers.map((s) => (
              <tr key={s.id}><td>{s.name}</td><td>{formatIban(s.iban)}</td><td>{s.bic || <span className="muted">—</span>}</td>
                <td><button className="btn danger small" onClick={() => remove(s.id)}>Löschen</button></td></tr>
            ))}</tbody>
          </table>
        </div>
      )}
      <form onSubmit={add}>
        <div className="row">
          <label className="field"><span>Name</span>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Lieferant GmbH" /></label>
          <label className="field"><span>IBAN</span>
            <input className="mono" type="text" value={iban.value} onChange={(e) => iban.setValue(e.target.value)} onBlur={(e) => iban.check(e.target.value)} placeholder="DE…" /></label>
        </div>
        <div className="toolbar" style={{ margin: "4px 0 0" }}>
          <IbanStatus info={iban.info} />
          <div className="spacer" />
          <button className="btn" type="submit">Lieferant hinzufügen</button>
        </div>
      </form>
    </div>
  );
}

function ModuleConfig({ data, updateData }) {
  const mode = data.config?.payoutMode || "erstattung";
  const rechnung = !!data.config?.modules?.rechnung;
  const rechnungZahlung = !!data.config?.modules?.rechnungZahlung;
  const iopts = data.config?.invoiceOpts || {};
  const setMode = (m) => updateData((d) => ({ ...d, config: { ...(d.config || {}), payoutMode: m } }));
  const toggleRechnung = (on) => updateData((d) => ({
    ...d, config: { ...(d.config || {}), modules: { ...((d.config || {}).modules || {}), rechnung: on } },
  }));
  const toggleZahlung = (on) => updateData((d) => ({
    ...d, config: { ...(d.config || {}), modules: { ...((d.config || {}).modules || {}), rechnungZahlung: on } },
  }));
  const setIopt = (k, v) => updateData((d) => ({
    ...d, config: { ...(d.config || {}), invoiceOpts: { ...((d.config || {}).invoiceOpts || {}), [k]: v } },
  }));
  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>Module</h2>
      <p className="note">Bestimmt, was das zweite Modul ist. „Erstattungen" mit Shop-Import &amp; Stornogebühr (z. B. Ticket-/Onlineshop) oder „Sammelüberweisung" – allgemein (Empfänger, IBAN, Betrag) für jede Firma.</p>
      <label className="field" style={{ maxWidth: 380 }}><span>Zweites Modul</span>
        <select value={mode} onChange={(e) => setMode(e.target.value)}>
          <option value="erstattung">Erstattungen (Shop / Rückzahlungen)</option>
          <option value="sammel">Sammelüberweisung (allgemein)</option>
        </select>
      </label>
      <label style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
        <input type="checkbox" checked={rechnung} onChange={(e) => toggleRechnung(e.target.checked)} />
        <span><strong>Rechnungsprüfung</strong> aktivieren – Rechnungen gegen die tatsächlich angenommene Ware abgleichen, freigegebenen Betrag in die Sammelüberweisung übernehmen (z. B. Gastronomie/Lieferanten).</span>
      </label>
      <label style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10 }}>
        <input type="checkbox" checked={rechnungZahlung} onChange={(e) => toggleZahlung(e.target.checked)} />
        <span><strong>Rechnungen (Zahlungen)</strong> aktivieren – Rechnungs-PDFs einlesen (E-Rechnung/Mustererkennung + Lieferanten-Gedächtnis) und als SEPA-Datei auszahlen.</span>
      </label>
      {rechnungZahlung && (
        <div style={{ margin: "8px 0 0 30px", display: "flex", flexDirection: "column", gap: 6 }}>
          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input type="checkbox" checked={!!iopts.useDueDate} onChange={(e) => setIopt("useDueDate", e.target.checked)} />
            <span className="note" style={{ margin: 0 }}>Fälligkeitsdatum nutzen (steuert das SEPA-Ausführungsdatum)</span></label>
          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input type="checkbox" checked={!!iopts.skonto} onChange={(e) => setIopt("skonto", e.target.checked)} />
            <span className="note" style={{ margin: 0 }}>Skonto-Abzug je Rechnung erlauben</span></label>
          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input type="checkbox" checked={!!iopts.approval} onChange={(e) => setIopt("approval", e.target.checked)} />
            <span className="note" style={{ margin: 0 }}>Vier-Augen-Prinzip (nur Admin erstellt die SEPA-Datei)</span></label>
        </div>
      )}
    </div>
  );
}

function Users({ auth }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("user");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  if (auth.currentUser.role !== "admin") return null;

  async function add(e) {
    e.preventDefault(); setError(""); setBusy(true);
    try { await auth.addUser(username, password, role); setUsername(""); setPassword(""); setRole("user"); }
    catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>Benutzer &amp; Zugänge ({auth.users.length})</h2>
      <p className="note">Als Admin legst du Mitarbeiter-Logins an. Jeder meldet sich mit eigenem Benutzernamen + Passwort an – die Daten bleiben dabei durchgehend verschlüsselt. Änderungen hier werden sofort gespeichert.</p>

      <div className="table-wrap" style={{ marginBottom: 16 }}>
        <table>
          <thead><tr><th>Benutzer</th><th>Rolle</th><th></th></tr></thead>
          <tbody>
            {auth.users.map((u) => {
              const isSelf = u.username.toLowerCase() === auth.currentUser.username.toLowerCase();
              return (
                <tr key={u.username}>
                  <td>{u.username}{isSelf && <span className="muted"> · du</span>}</td>
                  <td>{u.role === "admin" ? "Admin" : "Mitarbeiter"}</td>
                  <td>{!isSelf && (
                    <button className="btn danger small" onClick={() => auth.removeUser(u.username)}>Entfernen</button>
                  )}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <form onSubmit={add} autoComplete="off">
        <div className="row">
          <label className="field"><span>Benutzername</span>
            <input type="text" value={username} autoComplete="off" onChange={(e) => setUsername(e.target.value)} placeholder="z. B. lara" /></label>
          <label className="field"><span>Passwort</span>
            <input type="password" value={password} autoComplete="off" onChange={(e) => setPassword(e.target.value)} placeholder="min. 6 Zeichen" /></label>
          <label className="field"><span>Rolle</span>
            <select value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="user">Mitarbeiter</option>
              <option value="admin">Admin</option>
            </select></label>
        </div>
        {error && <p className="error-text">{error}</p>}
        <div className="toolbar" style={{ margin: 0 }}>
          <div className="spacer" />
          <button className="btn" type="submit" disabled={busy}>Benutzer anlegen</button>
        </div>
      </form>
    </div>
  );
}

const TAG_FIELDS = [
  ["sportDe", "Sport-Tags (DE)", "sport"],
  ["konzertDe", "Konzert-Tags (DE)", "konzert"],
  ["reisen", "Reisen-Tags", "reisen"],
  ["at", "Österreich-Tags (optional, Land kommt aus dem Titel)", ""],
];
const splitTags = (s) => String(s || "").split(",").map((t) => t.trim()).filter(Boolean);

function ShopifySettings({ data, updateData, shopify }) {
  const sp = data.shopify || {};
  const tagStr = sp.tagStr || {};
  const set = (patch) => updateData((d) => ({ ...d, shopify: { ...(d.shopify || {}), ...patch } }));
  const setTag = (k, v) => set({ tagStr: { ...(sp.tagStr || {}), [k]: v } });
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [showManual, setShowManual] = useState(false);
  const [shopInput, setShopInput] = useState("");
  const [conn, setConn] = useState(null);        // { shopifyDomain, hasToken }
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    let alive = true;
    if (shopify?.getIntegration) shopify.getIntegration().then((i) => { if (alive && i) setConn(i); }).catch(() => {});
    return () => { alive = false; };
  }, [shopify]);

  // OAuth-Verbindung starten: Browser öffnen + auf Rückkehr warten (Polling).
  async function connect() {
    setErr(""); setMsg(""); setConnecting(true);
    try {
      const url = await shopify.connect(shopInput);
      await openExternal(url);
      setMsg("Browser geöffnet – bestätige die Verbindung bei Shopify. Diese Seite aktualisiert sich automatisch.");
      const started = Date.now();
      const poll = setInterval(async () => {
        try {
          const i = await shopify.getIntegration();
          if (i?.hasToken) { setConn(i); setMsg(`✓ Verbunden mit ${i.shopifyDomain || shopInput}.`); setConnecting(false); clearInterval(poll); }
        } catch { /* weiterversuchen */ }
        if (Date.now() - started > 5 * 60 * 1000) { setConnecting(false); clearInterval(poll); }
      }, 3000);
    } catch (e) { setErr(e.message || "Verbindung fehlgeschlagen."); setConnecting(false); }
  }

  async function saveServer() {
    setErr(""); setMsg(""); setBusy("save");
    try {
      const tags = {}; for (const [k] of TAG_FIELDS) tags[k] = splitTags(tagStr[k]);
      await shopify.save({ domain: sp.domain, token: sp.token, tags });
      setMsg("Auf dem Server hinterlegt – der Nacht-Abgleich nutzt das jetzt.");
    } catch (e) { setErr(e.message || "Fehler."); } finally { setBusy(""); }
  }
  async function syncNow() {
    setErr(""); setMsg(""); setBusy("sync");
    try {
      const r = await shopify.syncNow();
      setMsg(`Abgleich fertig: ${r.cancellations ?? 0} Stornos, ${r.refunds ?? 0} Erstattungen, ${r.requests ?? 0} offene Rückbuchungen${r.winRate != null ? `, Gewinnquote ${r.winRate} %` : ""} (gescannt: ${r.scanned ?? 0} Bestellungen).`);
    } catch (e) { setErr(e.message || "Abgleich fehlgeschlagen."); } finally { setBusy(""); }
  }

  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>Shopify-Anbindung</h2>
      <p className="note">
        Für den Bestell-Import (Erstattungen) und den nächtlichen Server-Abgleich (Stornos, Rückerstattungen, offene Rückbuchungen).
        Lege in Shopify eine Custom App mit <strong>nur Lese-Rechten</strong> an (<em>read_orders</em>, ggf. <em>read_all_orders</em>, <em>read_customers</em>) – <strong>keine</strong> Schreibrechte.
        Domain + Token werden lokal (Tresor) gespeichert; für den Nacht-Cron zusätzlich verschlüsselt auf dem Server.
      </p>
      {/* Einfacher Weg: 1 Klick verbinden (OAuth) */}
      {shopify && (
        conn?.hasToken ? (
          <div className="card" style={{ background: "rgba(61,220,151,0.08)", borderColor: "var(--ok, #3ddc97)" }}>
            <strong style={{ color: "var(--ok, #3ddc97)" }}>✓ Mit Shopify verbunden</strong>
            {conn.shopifyDomain && <span className="muted"> · {conn.shopifyDomain}</span>}
            <div style={{ marginTop: 8 }}>
              <button className="btn ghost small" onClick={() => setConn(null)}>Anderen Shop verbinden</button>
            </div>
          </div>
        ) : (
          <div className="card">
            <h3 style={{ margin: "0 0 4px", fontSize: 14 }}>Mit einem Klick verbinden</h3>
            <p className="note" style={{ marginTop: 0 }}>Shop-Domain eingeben, „Verbinden" klicken und im Browser bei Shopify bestätigen. Kein Token nötig.</p>
            <div className="row">
              <label className="field" style={{ flex: 1 }}><span>Shop-Domain</span>
                <input type="text" value={shopInput} onChange={(e) => setShopInput(e.target.value)} placeholder="dein-shop.myshopify.com" /></label>
              <div style={{ display: "flex", alignItems: "flex-end" }}>
                <button className="btn" onClick={connect} disabled={connecting || !shopInput.trim()}>
                  {connecting ? "Warte auf Bestätigung…" : "Mit Shopify verbinden"}
                </button>
              </div>
            </div>
            <button className="link-btn" style={{ marginTop: 6 }} onClick={() => setShowManual((v) => !v)}>
              {showManual ? "Erweiterte Einrichtung ausblenden" : "Erweitert: manuell mit Token verbinden"}
            </button>
          </div>
        )
      )}

      {/* Erweitert / Fallback: manuell Domain + Token */}
      {(!shopify || showManual) && (
        <>
          <label className="field"><span>Shop-Domain (…myshopify.com)</span>
            <input type="text" value={sp.domain || ""} onChange={(e) => set({ domain: e.target.value })}
              placeholder="dein-shop.myshopify.com" /></label>
          <label className="field"><span>Admin-API-Token (read-only)</span>
            <input type="password" value={sp.token || ""} onChange={(e) => set({ token: e.target.value })}
              placeholder="shpat_… / shppa_…" /></label>
        </>
      )}

      {shopify && (
        <>
          <h3 style={{ margin: "16px 0 4px", fontSize: 14 }}>Kategorie-Tags für die Buchhaltung</h3>
          <p className="note" style={{ marginTop: 0 }}>
            Land (DE/Österreich) wird automatisch aus dem Veranstaltungs-Titel erkannt. Sport vs. Konzerte über Tags
            (Komma-getrennt). Typ „Reisen" ergibt die Kategorie Reisen. Mehrere Tags je Feld mit Komma trennen.
          </p>
          <div className="row">
            {TAG_FIELDS.map(([k, label, ph]) => (
              <label className="field" key={k}><span>{label}</span>
                <input type="text" value={tagStr[k] ?? ph} placeholder={ph || "—"} onChange={(e) => setTag(k, e.target.value)} /></label>
            ))}
          </div>
          {err && <p className="error-text">{err}</p>}
          {msg && <p className="note" style={{ color: "var(--ok, #3ddc97)" }}>{msg}</p>}
          <div className="toolbar" style={{ marginBottom: 0 }}>
            <span className="note">Server-Abgleich läuft täglich um 0 Uhr; hier kannst du ihn auch sofort anstoßen.</span>
            <div className="spacer" />
            <button className="btn ghost" onClick={saveServer} disabled={!!busy || !sp.domain}>{busy === "save" ? "Speichere…" : "Auf Server hinterlegen"}</button>
            <button className="btn" onClick={syncNow} disabled={!!busy}>{busy === "sync" ? "Gleiche ab…" : "Jetzt abgleichen"}</button>
          </div>
        </>
      )}
    </div>
  );
}

function EcommerceSettings({ data, updateData }) {
  const eco = data.ecommerce || { platform: "shopify" };
  const platform = eco.platform || "shopify";
  const woo = eco.woo || {};
  const sw = eco.shopware || {};
  const setPlatform = (p) => updateData((d) => ({ ...d, ecommerce: { ...(d.ecommerce || {}), platform: p } }));
  const setWoo = (patch) => updateData((d) => ({ ...d, ecommerce: { ...(d.ecommerce || {}), woo: { ...((d.ecommerce || {}).woo || {}), ...patch } } }));
  const setSw = (patch) => updateData((d) => ({ ...d, ecommerce: { ...(d.ecommerce || {}), shopware: { ...((d.ecommerce || {}).shopware || {}), ...patch } } }));

  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>Shop-System für den Bestell-Import</h2>
      <p className="note">
        Wähle dein Shop-System. Beim Laden einer Bestellnummer unter „Erstattungen" wird genau dieses System abgefragt.
        Zugangsdaten bleiben lokal im verschlüsselten Tresor.
      </p>
      <label className="field" style={{ maxWidth: 320 }}><span>Plattform</span>
        <select value={platform} onChange={(e) => setPlatform(e.target.value)}>
          <option value="shopify">Shopify</option>
          <option value="woocommerce">WooCommerce</option>
          <option value="shopware">Shopware 6</option>
        </select>
      </label>

      {platform === "shopify" && (
        <p className="note" style={{ marginTop: 0 }}>Shopify richtest du oben unter „Shopify-Anbindung" ein (Ein-Klick-Verbindung).</p>
      )}

      {platform === "woocommerce" && (
        <>
          <p className="note" style={{ marginTop: 0 }}>
            In WooCommerce unter <strong>WooCommerce → Einstellungen → Erweitert → REST-API</strong> einen Schlüssel mit
            <strong> nur Leserechten</strong> anlegen.
          </p>
          <label className="field"><span>Shop-URL</span>
            <input type="text" value={woo.siteUrl || ""} onChange={(e) => setWoo({ siteUrl: e.target.value })} placeholder="https://dein-shop.de" /></label>
          <div className="row">
            <label className="field"><span>Consumer Key</span>
              <input type="text" value={woo.consumerKey || ""} onChange={(e) => setWoo({ consumerKey: e.target.value })} placeholder="ck_…" /></label>
            <label className="field"><span>Consumer Secret</span>
              <input type="password" value={woo.consumerSecret || ""} onChange={(e) => setWoo({ consumerSecret: e.target.value })} placeholder="cs_…" /></label>
          </div>
        </>
      )}

      {platform === "shopware" && (
        <>
          <p className="note" style={{ marginTop: 0 }}>
            In Shopware unter <strong>Einstellungen → System → Integrationen</strong> eine Integration mit Leserechten
            für Bestellungen anlegen.
          </p>
          <label className="field"><span>Shop-URL</span>
            <input type="text" value={sw.siteUrl || ""} onChange={(e) => setSw({ siteUrl: e.target.value })} placeholder="https://dein-shop.de" /></label>
          <div className="row">
            <label className="field"><span>Client-ID (Access Key ID)</span>
              <input type="text" value={sw.clientId || ""} onChange={(e) => setSw({ clientId: e.target.value })} placeholder="SWIA…" /></label>
            <label className="field"><span>Client-Secret</span>
              <input type="password" value={sw.clientSecret || ""} onChange={(e) => setSw({ clientSecret: e.target.value })} placeholder="••••••••" /></label>
          </div>
        </>
      )}
    </div>
  );
}

function Accounts({ data, updateData }) {
  const iban = useIbanField();
  const [label, setLabel] = useState("");
  const [name, setName] = useState("");

  async function add(e) {
    e.preventDefault();
    const info = await iban.check(iban.value);
    if (!info?.ok) return;
    const acc = {
      id: crypto.randomUUID(),
      label: label.trim() || name.trim(),
      name: name.trim(),
      iban: info.iban,
      bic: info.bic || "",
      bank: info.bank || "",
    };
    updateData((d) => ({ ...d, accounts: [...(d.accounts || []), acc] }));
    setLabel(""); setName(""); iban.setValue(""); iban.setInfo(null);
  }

  function remove(id) {
    updateData((d) => ({ ...d, accounts: d.accounts.filter((a) => a.id !== id) }));
  }

  const accounts = data.accounts || [];

  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>Auftraggeberkonten ({accounts.length})</h2>
      <p className="note">Von welchen Konten überwiesen werden soll. Beim Erstellen einer SEPA-Datei wählst du eins aus.</p>

      {accounts.length > 0 && (
        <div className="table-wrap" style={{ marginBottom: 16 }}>
          <table>
            <thead>
              <tr><th>Bezeichnung</th><th>Auftraggeber</th><th>IBAN</th><th>BIC</th><th></th></tr>
            </thead>
            <tbody>
              {accounts.map((a) => (
                <tr key={a.id}>
                  <td>{a.label}</td>
                  <td>{a.name}</td>
                  <td>{formatIban(a.iban)}</td>
                  <td>{a.bic || <span className="muted">—</span>}</td>
                  <td><button className="btn danger small" onClick={() => remove(a.id)}>Löschen</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <form onSubmit={add}>
        <div className="row">
          <label className="field"><span>Bezeichnung (z. B. „Commerzbank Hauptkonto")</span>
            <input type="text" value={label} onChange={(e) => setLabel(e.target.value)} /></label>
          <label className="field"><span>Auftraggeber-Name</span>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Muster GmbH" /></label>
        </div>
        <label className="field"><span>IBAN</span>
          <input type="text" value={iban.value}
            onChange={(e) => iban.setValue(e.target.value)}
            onBlur={(e) => iban.check(e.target.value)}
            placeholder="DE00 0000 0000 0000 0000 00" />
        </label>
        <div className="toolbar" style={{ margin: "4px 0 0" }}>
          <IbanStatus info={iban.info} />
          <div className="spacer" />
          <button className="btn" type="submit">Konto hinzufügen</button>
        </div>
      </form>
    </div>
  );
}

function ColorField({ label, value, onChange, allowEmpty }) {
  const hex = normalizeColor(value) || "#000000";
  return (
    <label className="field">
      <span>{label}</span>
      <div className="inline-edit">
        <input type="color" value={hex} onChange={(e) => onChange(e.target.value)}
          style={{ width: 44, height: 40, padding: 2, flex: "none" }} />
        <input type="text" value={value || ""}
          placeholder={allowEmpty ? "leer = Standard" : "#3ddc97 oder rgb(61,220,151)"}
          onChange={(e) => onChange(e.target.value)} />
      </div>
    </label>
  );
}

function Branding({ data, updateData }) {
  const b = data.branding || {};
  const t = b.theme || {};
  const set = (patch) => updateData((d) => ({ ...d, branding: { ...(d.branding || {}), ...patch } }));
  const setTheme = (patch) => updateData((d) => ({
    ...d, branding: { ...(d.branding || {}), theme: { ...((d.branding || {}).theme || {}), ...patch } },
  }));

  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>Darstellung (White-Label)</h2>
      <p className="note">Name, Logo und Farben anpassen – wirkt sofort, verschlüsselt im Tresor gespeichert. Farben als HEX (#3ddc97) oder RGB (rgb(61,220,151)). Der Urheber-Hinweis „fork and merge UG" bleibt erhalten.</p>

      <div className="row">
        <label className="field"><span>Produktname</span>
          <input type="text" value={b.productName ?? ""} placeholder="iou.fm" onChange={(e) => set({ productName: e.target.value })} /></label>
        <label className="field"><span>Wortmarke</span>
          <input type="text" value={b.brandText ?? ""} placeholder="iou" onChange={(e) => set({ brandText: e.target.value })} /></label>
        <label className="field"><span>Wortmarke-Akzent</span>
          <input type="text" value={b.brandAccent ?? ""} placeholder=".fm" onChange={(e) => set({ brandAccent: e.target.value })} /></label>
      </div>
      <label className="field"><span>Logo-URL (optional, ersetzt die Wortmarke)</span>
        <input type="text" value={b.logoUrl ?? ""} placeholder="https://… (leer lassen für Wortmarke)" onChange={(e) => set({ logoUrl: e.target.value })} /></label>

      <div className="row">
        <label className="field"><span>Modus</span>
          <select value={t.mode || "dark"} onChange={(e) => setTheme({ mode: e.target.value })}>
            <option value="dark">Dunkel</option>
            <option value="light">Hell</option>
          </select></label>
        <ColorField label="Primärfarbe (Buttons, aktiv)" value={t.primary ?? "#3ddc97"} onChange={(v) => setTheme({ primary: v })} />
        <ColorField label="Sekundärfarbe (Links, Beträge)" value={t.secondary ?? "#5b8cff"} onChange={(v) => setTheme({ secondary: v })} />
        <ColorField label="Textfarbe (optional)" value={t.text ?? ""} onChange={(v) => setTheme({ text: v })} allowEmpty />
      </div>
    </div>
  );
}


function AccountantSettings({ accountant }) {
  const [email, setEmail] = useState("");
  const [cc, setCc] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [info, setInfo] = useState(null);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => {
    accountant.get().then((a) => {
      if (a) { setEmail(a.email || ""); setCc(a.cc || ""); setEnabled(!!a.enabled); setInfo(a); }
    }).catch(() => {});
  }, [accountant]);

  async function save() {
    setErr(""); setMsg(""); setBusy("save");
    try { await accountant.save({ email: email.trim(), cc: cc.trim(), enabled }); setMsg("Gespeichert."); }
    catch (e) { setErr(e.message); } finally { setBusy(""); }
  }
  async function sendNow() {
    setErr(""); setMsg(""); setBusy("send");
    try { const r = await accountant.sendNow(); setMsg(`Testmail gesendet (${r.month}) an ${r.to}.`); }
    catch (e) { setErr(e.message); } finally { setBusy(""); }
  }

  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>Buchhalter / Steuerberater – Monatsversand</h2>
      <p className="note">
        Am Monatsende (letzter Tag, 23:59 Uhr) schickt der Hub automatisch die Stornos &amp; Erstattungen des Monats
        als CSV per Mail – mit Kopie (CC) an deine Adresse. Das SEPA-Zahlungsarchiv ist Ende-zu-Ende-verschlüsselt
        und wird NICHT versendet.
      </p>
      <label className="field"><span>E-Mail Buchhalter/Steuerberater</span>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="buchhaltung@kanzlei.de" /></label>
      <label className="field"><span>CC (eigene Adresse)</span>
        <input type="email" value={cc} onChange={(e) => setCc(e.target.value)} placeholder="du@firma.de" /></label>
      <label style={{ display: "flex", gap: 8, alignItems: "center", margin: "8px 0" }}>
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        Automatischen Monatsversand aktivieren
      </label>
      {info && info.mailReady === false && (
        <p className="note" style={{ color: "#ffb84d" }}>Hinweis: Auf dem Server ist noch kein RESEND_API_KEY gesetzt – ohne den kann nicht gemailt werden.</p>
      )}
      {info?.lastSentAt && <p className="note">Zuletzt versendet: {info.lastSentMonth} am {new Date(info.lastSentAt).toLocaleString("de-DE")}</p>}
      {err && <p className="error-text">{err}</p>}
      {msg && <p className="note" style={{ color: "var(--ok, #3ddc97)" }}>{msg}</p>}
      <div className="toolbar" style={{ marginBottom: 0 }}>
        <button className="btn ghost" onClick={save} disabled={!!busy}>{busy === "save" ? "Speichere…" : "Speichern"}</button>
        <div className="spacer" />
        <button className="btn" onClick={sendNow} disabled={!!busy || !email.trim()}>{busy === "send" ? "Sende…" : "Testmail jetzt senden"}</button>
      </div>
    </div>
  );
}
