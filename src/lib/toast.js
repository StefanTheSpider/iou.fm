// Kleines, abhängigkeitsfreies Toast-System. Komponenten/Libs rufen toast(...) auf;
// die <Toaster/>-Komponente (in App.jsx) lauscht auf das Event und zeigt es an.
// Auto-schließend, mehrere gleichzeitig möglich. Kein Prop-Drilling nötig.
export function toast(message, type = "ok") {
  if (typeof window === "undefined" || !message) return;
  window.dispatchEvent(new CustomEvent("iou-toast", { detail: { message: String(message), type } }));
}
