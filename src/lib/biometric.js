// Brücke zu den nativen Touch-ID/Windows-Hello-Befehlen (Tauri).
// Im Browser (Dev) ohne Tauri sind die Funktionen deaktiviert.
import { invoke } from "@tauri-apps/api/core";

const BIO_USER = "ioufm_bio_user"; // gemerkter Benutzer fürs biometrische Entsperren (nicht geheim)
const isTauri = () => typeof window !== "undefined" && !!(window.__TAURI_INTERNALS__ || window.__TAURI__);

export async function bioAvailable() {
  if (!isTauri()) return false;
  try { return await invoke("bio_available"); } catch { return false; }
}
export function bioEnabledUser() {
  try { return localStorage.getItem(BIO_USER) || ""; } catch { return ""; }
}
export async function bioStore(username, secret) {
  await invoke("bio_enable", { account: username, secret });
  localStorage.setItem(BIO_USER, username);
}
export async function bioUnlockSecret() {
  const account = bioEnabledUser();
  if (!account) throw new Error("Kein biometrisches Login eingerichtet.");
  return await invoke("bio_unlock", { account }); // löst Touch ID/Hello aus, liefert das Secret
}
export async function bioDisable() {
  const account = bioEnabledUser();
  if (account && isTauri()) { try { await invoke("bio_disable", { account }); } catch { /* egal */ } }
  try { localStorage.removeItem(BIO_USER); } catch { /* egal */ }
}
