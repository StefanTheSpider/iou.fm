import { useState } from "react";

// Owner-only Schalttafel: live zwischen allen Modi wechseln, ohne sich neu
// anzumelden oder echte Einstellungen zu ändern. Overrides sind reine Vorschau.
export default function OwnerPanel({ view, setView, payoutMode, rechnungOn }) {
  const [open, setOpen] = useState(false);
  const active = view.asUser || view.payout || view.rechnung != null || view.demo;
  const set = (patch) => setView((v) => ({ ...v, ...patch }));
  const reset = () => setView({ asUser: false, payout: null, rechnung: null, demo: false });

  const Seg = ({ label, options }) => (
    <div className="owner-row">
      <span className="owner-lbl">{label}</span>
      <div className="owner-seg">
        {options.map((o) => (
          <button key={String(o.value)}
            className={`owner-btn ${o.selected ? "on" : ""}`}
            onClick={o.onClick}>{o.label}</button>
        ))}
      </div>
    </div>
  );

  return (
    <div className={`owner-wrap ${active ? "is-active" : ""}`}>
      <button className="owner-fab" onClick={() => setOpen((o) => !o)} title="Owner-Modus">
        ⚙︎ Owner{active ? " · Vorschau" : ""}
      </button>
      {open && (
        <div className="owner-panel">
          <div className="owner-head">
            <strong>Owner-Modus</strong>
            <span className="owner-note">Vorschau – ändert nichts an echten Daten/Einstellungen.</span>
          </div>

          <Seg label="Ansicht" options={[
            { value: false, label: "Admin", selected: !view.asUser, onClick: () => set({ asUser: false }) },
            { value: true, label: "Mitarbeiter", selected: view.asUser, onClick: () => set({ asUser: true }) },
          ]} />

          <Seg label="Auszahlung" options={[
            { value: "real", label: `Aktuell (${payoutMode === "sammel" ? "Sammel" : "Erstattung"})`, selected: !view.payout, onClick: () => set({ payout: null }) },
            { value: "erstattung", label: "Erstattungen", selected: view.payout === "erstattung", onClick: () => set({ payout: "erstattung" }) },
            { value: "sammel", label: "Sammelüberweisung", selected: view.payout === "sammel", onClick: () => set({ payout: "sammel" }) },
          ]} />

          <Seg label="Rechnungsprüfung" options={[
            { value: "real", label: `Aktuell (${rechnungOn ? "an" : "aus"})`, selected: view.rechnung == null, onClick: () => set({ rechnung: null }) },
            { value: "on", label: "an", selected: view.rechnung === true, onClick: () => set({ rechnung: true }) },
            { value: "off", label: "aus", selected: view.rechnung === false, onClick: () => set({ rechnung: false }) },
          ]} />

          <Seg label="Daten" options={[
            { value: "live", label: "Live", selected: !view.demo, onClick: () => set({ demo: false }) },
            { value: "demo", label: "Demo", selected: view.demo, onClick: () => set({ demo: true }) },
          ]} />

          <div className="owner-foot">
            <button className="owner-reset" onClick={reset} disabled={!active}>Zurücksetzen</button>
          </div>
        </div>
      )}
    </div>
  );
}
