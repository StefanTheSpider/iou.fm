import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import "./styles.css";

// Produktions-Härtung (kleiner Deterrent, kein echter Schutz): Kontextmenü und
// DevTools-Shortcuts unterbinden. Der eigentliche Schutz liegt in der E2E-
// Verschlüsselung, den lokal gehaltenen Schlüsseln und dem kompilierten Rust-Kern.
if (import.meta.env.PROD) {
  window.addEventListener("contextmenu", (e) => e.preventDefault());
  window.addEventListener("keydown", (e) => {
    const k = (e.key || "").toLowerCase();
    if (k === "f12" ||
        ((e.ctrlKey || e.metaKey) && e.shiftKey && (k === "i" || k === "j" || k === "c")) ||
        ((e.ctrlKey || e.metaKey) && k === "u")) {
      e.preventDefault();
    }
  });
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
