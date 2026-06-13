// Wählt die passende fetch-Implementierung: explizit > Tauri-HTTP (kein CORS) > Browser-fetch.
const isTauri = () => typeof window !== "undefined" && !!window.__TAURI_INTERNALS__;

export async function pickFetch(explicit) {
  if (explicit) return explicit;
  if (isTauri()) {
    try {
      const mod = await import("@tauri-apps/plugin-http");
      if (mod?.fetch) return mod.fetch;
    } catch { /* Plugin nicht verfügbar -> Browser-fetch */ }
  }
  return fetch;
}

// Base64 (auch in Tauri/Node verfügbar machen).
export function b64(s) {
  if (typeof btoa === "function") return btoa(s);
  return Buffer.from(s, "utf8").toString("base64");
}
