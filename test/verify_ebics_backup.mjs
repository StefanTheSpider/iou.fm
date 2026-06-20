// Verifikation der EBICS-Schlüssel-Sicherung (Backup/Restore).
import { generateEbicsKeys } from "../src/lib/ebics/keys.js";
import { exportEbicsKeys, importEbicsKeys } from "../src/lib/ebics/keyBackup.js";

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log(`${c ? "✓" : "✗"} ${m}`); };

const keys = await generateEbicsKeys();
const pw = "MeinSicherungsPasswort1";

const backup = await exportEbicsKeys(keys, pw);
ok(backup.includes('"kind": "ebics-key-backup"'), "Backup hat Kennung");
ok(!backup.includes(keys.signature.priv), "Privater Schlüssel NICHT im Klartext im Backup");
ok(backup.includes(keys.hashes.signature), "Fingerabdruck im Klartext (für INI-Brief-Abgleich)");

const restored = await importEbicsKeys(backup, pw);
ok(restored.signature.priv === keys.signature.priv, "A006-Privatschlüssel exakt wiederhergestellt");
ok(restored.authentication.priv === keys.authentication.priv, "X002-Privatschlüssel wiederhergestellt");
ok(restored.encryption.priv === keys.encryption.priv, "E002-Privatschlüssel wiederhergestellt");
ok(JSON.stringify(restored.hashes) === JSON.stringify(keys.hashes), "Hashes identisch (gleiche Schlüssel → gültiger INI-Brief)");

let blocked = false;
try { await importEbicsKeys(backup, "falschesPasswort"); } catch { blocked = true; }
ok(blocked, "Falsches Passwort wird abgelehnt");

let tamperBlocked = false;
try {
  const o = JSON.parse(backup); o.data = o.data.slice(0, -4) + "AAAA";
  await importEbicsKeys(JSON.stringify(o), pw);
} catch { tamperBlocked = true; }
ok(tamperBlocked, "Manipulierte Sicherung wird abgelehnt");

let shortPw = false;
try { await exportEbicsKeys(keys, "kurz"); } catch { shortPw = true; }
ok(shortPw, "Zu kurzes Passwort wird abgelehnt");

console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen`);
process.exit(fail ? 1 : 0);
