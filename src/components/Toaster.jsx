import { useEffect, useState } from "react";

// Zeigt Toasts an. Fehler („error") erscheinen groß und mittig oben und bleiben
// stehen, bis man sie wegklickt – damit man sie nicht übersieht. Bestätigungen
// (ok/info) erscheinen dezent unten rechts und schließen sich selbst.
// Gerendert einmal in App.jsx, lauscht auf das „iou-toast"-Event (src/lib/toast.js).
export default function Toaster() {
  const [items, setItems] = useState([]); // { id, message, type }

  useEffect(() => {
    function onToast(e) {
      const id = Math.random().toString(36).slice(2);
      const type = e.detail?.type || "ok";
      const it = { id, message: e.detail?.message || "", type };
      setItems((xs) => [...xs.filter((x) => !(x.type === "error" && type === "error" && x.message === it.message)), it]);
      // Fehler bleiben stehen (manuell schließen); Bestätigungen schließen nach 3,8 s.
      if (type !== "error") setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), 3800);
    }
    window.addEventListener("iou-toast", onToast);
    return () => window.removeEventListener("iou-toast", onToast);
  }, []);

  const dismiss = (id) => setItems((xs) => xs.filter((x) => x.id !== id));
  const errors = items.filter((it) => it.type === "error");
  const notes = items.filter((it) => it.type !== "error");

  return (
    <>
      {/* Fehler: groß, mittig oben, unübersehbar */}
      {errors.length > 0 && (
        <div style={{ position: "fixed", top: 18, left: 0, right: 0, zIndex: 10000,
          display: "flex", flexDirection: "column", alignItems: "center", gap: 10, pointerEvents: "none" }}>
          {errors.map((it) => (
            <div key={it.id} role="alert"
              style={{ pointerEvents: "auto", display: "flex", alignItems: "flex-start", gap: 12,
                width: "min(620px, 92vw)", background: "#3a1113", border: "2px solid #ff5f5f",
                color: "#ffd9d9", borderRadius: 12, padding: "14px 16px",
                boxShadow: "0 18px 50px rgba(0,0,0,.55)", fontSize: 15, lineHeight: 1.4 }}>
              <span style={{ fontSize: 22, lineHeight: 1 }}>⚠️</span>
              <div style={{ flex: 1, fontWeight: 600 }}>{it.message}</div>
              <button onClick={() => dismiss(it.id)} aria-label="Schließen"
                style={{ background: "transparent", border: "none", color: "#ffb3b3", fontSize: 20,
                  lineHeight: 1, cursor: "pointer", padding: "0 2px" }}>✕</button>
            </div>
          ))}
        </div>
      )}

      {/* Bestätigungen: dezent unten rechts */}
      {notes.length > 0 && (
        <div style={{ position: "fixed", right: 18, bottom: 18, zIndex: 9999, display: "flex", flexDirection: "column", gap: 8, maxWidth: 420 }}>
          {notes.map((it) => {
            const c = it.type === "info"
              ? { bg: "rgba(91,140,255,.16)", bd: "rgba(91,140,255,.6)", fg: "#bcd0ff" }
              : { bg: "rgba(61,220,151,.16)", bd: "rgba(61,220,151,.6)", fg: "#bdf0d6" };
            return (
              <div key={it.id} onClick={() => dismiss(it.id)}
                style={{ background: c.bg, border: `1px solid ${c.bd}`, color: c.fg, borderRadius: 10, padding: "10px 14px",
                  boxShadow: "0 8px 24px rgba(0,0,0,.35)", cursor: "pointer", fontSize: 14, backdropFilter: "blur(6px)" }}>
                ✓ {it.message}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
