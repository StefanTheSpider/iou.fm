// Verifiziert die Mehrbenutzer-Envelope-Verschlüsselung end-to-end.
// (Mockt localStorage/sessionStorage; nutzt die Web-Crypto-API von Node 22.)
const mk = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
globalThis.localStorage = mk();
globalThis.sessionStorage = mk();

const { vaultExists, setupAdmin, login, saveVault, addUser, removeUser, restoreSession } = await import("../src/lib/vault.js");

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log(`${c ? "✓" : "✗"} ${m}`); };
const err = async (fn, m) => { try { await fn(); ok(false, m + " (kein Fehler!)"); } catch { ok(true, m); } };

ok(!vaultExists(), "frisch: kein Tresor");

const admin = await setupAdmin("stefan", "geheim12345", { company: "Tix + Travel GmbH" });
ok(vaultExists(), "nach Setup: Tresor existiert");
ok(admin.currentUser.role === "admin", "erster Benutzer ist Admin");

await saveVault(admin, { ...admin.data, accounts: [{ id: "a1", label: "Ticketkonto", iban: "DE89370400440532013000" }] });

const relogin = await login("stefan", "geheim12345");
ok(relogin.data.accounts?.length === 1, "Admin-Login entschlüsselt gespeicherte Daten");
await err(() => login("stefan", "falsch"), "falsches Passwort wird abgelehnt");
await err(() => login("gibtsnicht", "x"), "unbekannter Benutzer wird abgelehnt");

await addUser(relogin, "lara", "lara123", "user");
const laraView = await login("lara", "lara123");
ok(laraView.currentUser.role === "user", "Mitarbeiter-Login funktioniert");
ok(laraView.data.accounts?.length === 1, "Mitarbeiter sieht dieselben (entschlüsselten) Daten");
await err(() => login("lara", "nope"), "Mitarbeiter falsches Passwort abgelehnt");

await err(() => addUser(laraView, "x", "yyyyyy", "user"), "Nicht-Admin darf keine Benutzer anlegen");

const users = await removeUser(relogin, laraView.currentUser.id);
ok(users.length === 1, "Admin kann Mitarbeiter entfernen");
await err(() => login("lara", "lara123"), "entfernter Mitarbeiter kann sich nicht mehr anmelden");
await err(() => removeUser(relogin, relogin.currentUser.id), "letzter Admin kann nicht entfernt werden");

await login("stefan", "geheim12345"); // merkt gültige Session
const restored = await restoreSession();
ok(restored && restored.currentUser.username === "stefan" && restored.data.accounts?.length === 1,
  "Session-Wiederherstellung (Reload) ohne erneutes Login");

console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen`);
process.exit(fail ? 1 : 0);
