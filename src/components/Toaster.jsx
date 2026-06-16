import { useEffect, useState } from "react";

// Zeigt kurze, auto-schließende Bestätigungen (Toasts) unten rechts.
// Wird einmal in der App gerendert und lauscht auf das „iou-toast"-Event (src/lib/toast.js).
export default function Toaster() {
  const [items, setItems] = useState([]); // { id, message, type }

  useEffect(() => {
    function onToast(e) {
      const id = Math.random().toString(36).slice(2);
      const it = { id, message: e.detail?.message || "", type: e.detail?.type || "ok" };
      setItems((xs) => [...xs, it]);
      setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), 3800);
    }
    window.addEventListener("iou-toast", onToast);
    return () => window.removeEventListener("iou-toast", onToast);
  }, []);

  if (!items.length) return null;
  const color = (t) => t === "error" ? { bg: "rgba(255,107,107,.16)", bd: "rgba(255,107,107,.6)", fg: "#ffb3b3" }
    : t === "info" ? { bg: "rgba(91,140,255,.16)", bd: "rgba(91,140,255,.6)", fg: "#bcd0ff" }
    : { bg: "rgba(61,220,151,.16)", bd: "rgba(61,220,151,.6)", fg: "#bdf0d6" };

  return (
    <div style={{ position: "fixed", right: 18, bottom: 18, zIndex: 9999, display: "flex", flexDirection: "column", gap: 8, maxWidth: 420 }}>
      {items.map((it) => {
        const c = color(it.type);
        return (
          <div key={it.id}
            onClick={() => setItems((xs) => xs.filter((x) => x.id !== it.id))}
            style={{ background: c.bg, border: `1px solid ${c.bd}`, color: c.fg, borderRadius: 10, padding: "10px 14px",
              boxShadow: "0 8px 24px rgba(0,0,0,.35)", cursor: "pointer", fontSize: 14, backdropFilter: "blur(6px)" }}>
            {it.type === "error" ? "⚠ " : "✓ "}{it.message}
          </div>
        );
      })}
    </div>
  );
}
