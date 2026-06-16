// Externe URL zuverlässig öffnen. Im Tauri-App-Fenster funktioniert ein blanker
// <a target="_blank"> bzw. window.open NICHT – deshalb immer über das Rust-Kommando
// "open_external" (System-Browser). Nur im Browser-Dev fällt es auf window.open zurück.
import { invoke } from "@tauri-apps/api/core";

export async function openExternal(url) {
  if (!url) return;
  try { await invoke("open_external", { url }); }
  catch { window.open(url, "_blank", "noopener"); }
}
