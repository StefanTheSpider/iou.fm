import { useState, useRef, useEffect } from "react";

// Textfeld mit lokalem Tipp-Puffer: tippt SOFORT (nur lokaler State, kein globales Re-Render) und
// übernimmt in den geteilten Zustand erst bei kurzer Tipppause (Debounce) und beim Verlassen des
// Feldes. Das behebt „verschluckte" Zeichen bei schnellem Tippen zuverlässig, unabhängig davon,
// wie schwer die Liste gerade ist.
//
// Wichtig: Kommt WÄHREND des Tippens eine Änderung von außen (z. B. Sync von einem anderen Gerät),
// wird das gerade fokussierte Feld NICHT überschrieben – fremde Werte übernimmt der Puffer nur,
// wenn man nicht genau in diesem Feld ist.
export default function BufferedInput({ value = "", onCommit, delay = 500, as: Tag = "input", ...rest }) {
  const [local, setLocal] = useState(value ?? "");
  const focused = useRef(false);
  const timer = useRef(null);
  const committed = useRef(value ?? "");   // zuletzt übernommener/empfangener Wert

  // Externe (z. B. Sync-)Änderungen übernehmen – aber nur, wenn wir NICHT in diesem Feld tippen.
  useEffect(() => {
    const v = value ?? "";
    if (!focused.current && v !== committed.current) {
      committed.current = v;
      setLocal(v);
    }
  }, [value]);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  function commit(v) {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    if (v !== committed.current) { committed.current = v; onCommit?.(v); }
  }

  return (
    <Tag
      {...rest}
      value={local}
      onFocus={(e) => { focused.current = true; rest.onFocus?.(e); }}
      onChange={(e) => {
        const v = e.target.value;
        setLocal(v);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => commit(v), delay);
      }}
      onBlur={(e) => { focused.current = false; commit(local); rest.onBlur?.(e); }}
    />
  );
}
