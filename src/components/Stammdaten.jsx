import { useState } from "react";
import { inspectIban, formatIban } from "../lib/iban.js";
import { normalizeColor } from "../lib/theme.js";
import CloudSync from "./CloudSync.jsx";

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

export default function Stammdaten({ data, updateData, auth, sync }) {
  const isAdmin = auth?.currentUser?.role === "admin";
  return (
    <div>
      <h1>Stammdaten</h1>
      <p className="sub">Auftraggeberkonten, Zugänge, Shopify-Anbindung und Darstellung – verschlüsselt lokal gespeichert.</p>
      {auth && <Users auth={auth} />}
      {isAdmin && sync && <CloudSync sync={sync} />}
      {isAdmin && <ModuleConfig data={data} updateData={updateData} />}
      {auth?.currentUser?.role === "admin" && <DatevConfig data={data} updateData={updateData} />}
      <Accounts data={data} updateData={updateData} />
      <Suppliers data={data} updateData={updateData} />
      <ShopifySettings data={data} updateData={updateData} />
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
  const setMode = (m) => updateData((d) => ({ ...d, config: { ...(d.config || {}), payoutMode: m } }));
  const toggleRechnung = (on) => updateData((d) => ({
    ...d, config: { ...(d.config || {}), modules: { ...((d.config || {}).modules || {}), rechnung: on } },
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

function ShopifySettings({ data, updateData }) {
  const sp = data.shopify || {};
  const set = (patch) => updateData((d) => ({ ...d, shopify: { ...(d.shopify || {}), ...patch } }));

  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>Shopify-Anbindung</h2>
      <p className="note">
        Für den Bestell-Import im Erstattungs-Modul (Kundenname, gezahlter Betrag, Event).
        Den Admin-API-Token bekommst du in Shopify unter <em>Einstellungen → Apps und Vertriebskanäle → App entwickeln → Admin-API-Token</em>.
        Token wird verschlüsselt im Tresor gespeichert (oben mit „Änderungen speichern" sichern).
      </p>
      <label className="field"><span>Shop-Domain (…myshopify.com)</span>
        <input type="text" value={sp.domain || ""} onChange={(e) => set({ domain: e.target.value })}
          placeholder="dein-shop.myshopify.com" /></label>
      <label className="field"><span>Admin-API-Token</span>
        <input type="password" value={sp.token || ""} onChange={(e) => set({ token: e.target.value })}
          placeholder="shpat_…" /></label>
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

