// EBICS-Schlüssel-Sicherung (verschlüsseltes Backup/Restore).
//
// Hintergrund: EBICS-Schlüssel werden EINMAL erzeugt und von der Bank EINMAL freigeschaltet.
// Danach gelten sie dauerhaft – ein App-Update ändert nur Code, NICHT die Schlüssel. Geht
// der lokale Speicher aber verloren (Gerätewechsel, Datenreset), wären die Schlüssel weg und
// man müsste neu bei der Bank initialisieren. Genau das verhindert diese passwortgeschützte
// Sicherung: Datei wegspeichern → auf jedem Gerät / nach jedem Reset wiederherstellen, ohne
// die Bank erneut zu behelligen. Die Schlüssel verlassen das Gerät nur in DIESER vom Nutzer
// kontrollierten, mit eigenem Passwort verschlüsselten Datei.

const enc = new TextEncoder();
const dec = new TextDecoder();
const ITER = 310000;
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const rand = (n) => crypto.getRandomValues(new Uint8Array(n));

async function deriveKey(passphrase, salt) {
  const base = await crypto.subtle.importKey("raw", enc.encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: ITER, hash: "SHA-256" },
    base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]
  );
}

// Erzeugt einen verschlüsselten Backup-String (zum Download als Datei).
export async function exportEbicsKeys(keys, passphrase) {
  if (!keys) throw new Error("Keine EBICS-Schlüssel zum Sichern vorhanden.");
  if (!passphrase || passphrase.length < 8) throw new Error("Bitte ein Sicherungs-Passwort mit mindestens 8 Zeichen wählen.");
  const salt = rand(16), iv = rand(12);
  const key = await deriveKey(passphrase, salt);
  const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(JSON.stringify(keys)));
  return JSON.stringify({
    app: "iou.fm", kind: "ebics-key-backup", v: 1, createdAt: new Date().toISOString(),
    hashes: keys.hashes || null,           // Fingerabdrücke im Klartext, zum Abgleich mit dem INI-Brief
    salt: b64(salt), iv: b64(iv), data: b64(data),
  }, null, 2);
}

// Stellt die Schlüssel aus einem Backup-String wieder her.
export async function importEbicsKeys(backupJson, passphrase) {
  let o;
  try { o = typeof backupJson === "string" ? JSON.parse(backupJson) : backupJson; }
  catch { throw new Error("Die Datei ist keine gültige EBICS-Sicherung (kein JSON)."); }
  if (!o || o.kind !== "ebics-key-backup" || !o.salt || !o.iv || !o.data) {
    throw new Error("Keine gültige EBICS-Schlüssel-Sicherung.");
  }
  const key = await deriveKey(passphrase, unb64(o.salt));
  let plain;
  try { plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(o.iv) }, key, unb64(o.data)); }
  catch { throw new Error("Falsches Passwort oder beschädigte Sicherungsdatei."); }
  const keys = JSON.parse(dec.decode(plain));
  if (!keys?.signature?.priv || !keys?.authentication?.priv || !keys?.encryption?.priv) {
    throw new Error("Sicherung unvollständig – die EBICS-Schlüssel fehlen.");
  }
  return keys;
}
