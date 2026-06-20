// EBICS-HTTP-Transport. Im gebauten Tauri-Fenster nutzen wir das native HTTP-Plugin
// (kein CORS), im Browser/Dev den normalen fetch. Body ist immer text/xml.
export async function ebicsHttpPost(url, xml, headers = {}) {
  let doFetch = fetch;
  if (typeof window !== "undefined" && window.__TAURI_INTERNALS__) {
    try { const mod = await import("@tauri-apps/plugin-http"); if (mod?.fetch) doFetch = mod.fetch; } catch { /* Browser-fetch */ }
  }
  const res = await doFetch(url, { method: "POST", headers: { "Content-Type": "text/xml", ...headers }, body: xml });
  return { status: res.status, text: await res.text() };
}
