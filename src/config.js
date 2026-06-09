// Fest eingebaute Adresse des Sync-Hubs (pro Edition überschreibbar via VITE_HUB_URL).
// So tippt der Nutzer beim Login nur Benutzername + Passwort – keine URL, kein Code.
export const HUB_URL =
  (typeof import.meta !== "undefined" && import.meta.env && import.meta.env.VITE_HUB_URL) ||
  "https://ioufm-production.up.railway.app";
