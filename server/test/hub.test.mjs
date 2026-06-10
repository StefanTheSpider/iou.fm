// Tests für den Sync-Hub inkl. server-gestützter E2E-Anmeldung.
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

const PORT = 4599;
const BASE = `http://127.0.0.1:${PORT}`;
const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "hub-"));
process.env.PORT = String(PORT);
process.env.DATA_DIR = tmp;
process.env.SUPPORT_KEY = "test-support-key";

const { server } = await import("../index.mjs");
await new Promise((r) => setTimeout(r, 150));

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error("  ✗ " + m); } };
const J = (r) => r.json();
const post = (p, b, key) => fetch(`${BASE}${p}`, {
  method: "POST",
  headers: { "Content-Type": "application/json", ...(key ? { Authorization: `Bearer ${key}` } : {}) },
  body: JSON.stringify(b),
});
const put = (p, b, key) => fetch(`${BASE}${p}`, {
  method: "PUT",
  headers: { "Content-Type": "application/json", ...(key ? { Authorization: `Bearer ${key}` } : {}) },
  body: JSON.stringify(b),
});

// Client-Krypto nachbilden (nur authHash wird realistisch berechnet; wrappedDek ist Dummy,
// da der Server ihn nie entschlüsselt).
const newSalt = () => crypto.randomBytes(16).toString("base64");
function authHashFor(password, saltB64) {
  const salt = Buffer.from(saltB64, "base64");
  const master = crypto.pbkdf2Sync(password, salt, 310000, 32, "sha256");
  return crypto.createHash("sha256").update(Buffer.concat([master, Buffer.from("auth")])).digest("hex");
}
const dummyWrapped = { iv: "iv", data: "wrapped" };

try {
  let r = await fetch(`${BASE}/health`); let b = await J(r);
  ok(r.status === 200 && b.tenants === 0 && b.users === 0, "health: leer");

  // --- Registrierung (neue Firma + Admin) ---
  const sSalt = newSalt();
  r = await post("/api/auth/register", { username: "stefan", salt: sSalt, authHash: authHashFor("geheim123", sSalt), wrappedDek: dummyWrapped, company: "Muster GmbH" });
  b = await J(r);
  ok(r.status === 201 && b.tenantId && b.accessKey && b.role === "admin", "register: Admin + Mandant angelegt");
  ok(b.owner === true, "register: Gründer ist Owner");
  const tenantId = b.tenantId, accessKey = b.accessKey;

  // accessKey nicht im Klartext im User-Record (nur im Tenant-File)
  const userRec = JSON.parse(await fs.readFile(path.join(tmp, "users", "stefan.json"), "utf8"));
  ok(!("authHash" in userRec) && userRec.authVerifier && userRec.tenantId === tenantId, "register: User-Record speichert nur Verifier");

  r = await post("/api/auth/register", { username: "stefan", salt: newSalt(), authHash: "x", wrappedDek: dummyWrapped });
  ok(r.status === 409, "register: Benutzername doppelt -> 409");

  // --- prelogin / login ---
  r = await post("/api/auth/prelogin", { username: "stefan" }); b = await J(r);
  ok(r.status === 200 && b.salt === sSalt, "prelogin: salt zurück");
  r = await post("/api/auth/prelogin", { username: "niemand" });
  ok(r.status === 404, "prelogin: unbekannt -> 404");

  r = await post("/api/auth/login", { username: "stefan", authHash: authHashFor("geheim123", sSalt) }); b = await J(r);
  ok(r.status === 200 && b.tenantId === tenantId && b.accessKey === accessKey && b.role === "admin", "login: korrekt");
  ok(b.owner === true, "login: Gründer bleibt Owner");
  ok(JSON.stringify(b.wrappedDek) === JSON.stringify(dummyWrapped), "login: wrappedDek zurück");
  r = await post("/api/auth/login", { username: "stefan", authHash: authHashFor("FALSCH", sSalt) });
  ok(r.status === 401, "login: falsches Passwort -> 401");

  // --- Dokument (Sync-Transport) ---
  r = await fetch(`${BASE}/api/tenants/${tenantId}/doc`, { headers: { Authorization: `Bearer ${accessKey}` } }); b = await J(r);
  ok(r.status === 200 && b.rev === 0, "doc: leer rev 0");
  r = await fetch(`${BASE}/api/tenants/${tenantId}/doc`, { method: "PUT", headers: { Authorization: `Bearer ${accessKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ baseRev: 0, payload: { iv: "a", data: "CIPHER" } }) });
  b = await J(r);
  ok(r.status === 200 && b.rev === 1, "doc: schreiben rev 1");
  r = await fetch(`${BASE}/api/tenants/${tenantId}/doc`, { headers: { Authorization: "Bearer falsch" } });
  ok(r.status === 401, "doc: falscher Schlüssel 401");

  // --- Admin legt Mitarbeiter an ---
  const lSalt = newSalt();
  r = await post("/api/auth/adduser", {
    adminUsername: "stefan", adminAuthHash: authHashFor("geheim123", sSalt),
    newUser: { username: "lara", salt: lSalt, authHash: authHashFor("laraPW1", lSalt), wrappedDek: dummyWrapped, role: "user" },
  }, accessKey);
  ok(r.status === 201, "adduser: Mitarbeiter angelegt");
  r = await post("/api/auth/login", { username: "lara", authHash: authHashFor("laraPW1", lSalt) }); b = await J(r);
  ok(r.status === 200 && b.tenantId === tenantId && b.role === "user", "adduser: Mitarbeiter kann sich anmelden (gleicher Mandant)");
  ok(!b.owner, "adduser: Mitarbeiter ist KEIN Owner");
  r = await post("/api/auth/adduser", { adminUsername: "stefan", adminAuthHash: "falsch", newUser: { username: "x", salt: "s", authHash: "h", wrappedDek: dummyWrapped } }, accessKey);
  ok(r.status === 401, "adduser: falscher Admin -> 401");

  // --- Liste / Löschen ---
  r = await post("/api/auth/users/list", { adminUsername: "stefan", adminAuthHash: authHashFor("geheim123", sSalt) }, accessKey); b = await J(r);
  ok(r.status === 200 && b.users.length === 2, "users/list: 2 Benutzer");
  r = await post("/api/auth/users/delete", { adminUsername: "stefan", adminAuthHash: authHashFor("geheim123", sSalt), username: "stefan" }, accessKey);
  ok(r.status === 400, "users/delete: sich selbst -> 400");
  r = await post("/api/auth/users/delete", { adminUsername: "stefan", adminAuthHash: authHashFor("geheim123", sSalt), username: "lara" }, accessKey);
  ok(r.status === 200, "users/delete: Mitarbeiter entfernt");
  r = await post("/api/auth/login", { username: "lara", authHash: authHashFor("laraPW1", lSalt) });
  ok(r.status === 401, "users/delete: entfernter Mitarbeiter kann sich nicht mehr anmelden");

  // --- Migration eines Alt-Mandanten (nur accessKeyHash, kein User-Record) ---
  const legacyId = crypto.randomUUID();
  const legacyKey = crypto.randomBytes(32).toString("base64url");
  const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");
  await fs.writeFile(path.join(tmp, "tenants", `${legacyId}.json`), JSON.stringify({
    tenantId: legacyId, accessKeyHash: sha256(legacyKey), company: "Alt GmbH", rev: 5, payload: { iv: "z", data: "ALT" }, createdAt: "x",
  }));
  const oSalt = newSalt();
  r = await post("/api/auth/migrate", { tenantId: legacyId, accessKey: legacyKey, username: "olduser", salt: oSalt, authHash: authHashFor("altPW123", oSalt), wrappedDek: dummyWrapped, role: "admin" });
  b = await J(r);
  ok(r.status === 200 && b.tenantId === legacyId, "migrate: Alt-Mandant übernommen");
  r = await post("/api/auth/migrate", { tenantId: legacyId, accessKey: "falsch", username: "x", salt: "s", authHash: "h", wrappedDek: dummyWrapped });
  ok(r.status === 401, "migrate: falscher accessKey -> 401");
  r = await post("/api/auth/login", { username: "olduser", authHash: authHashFor("altPW123", oSalt) }); b = await J(r);
  ok(r.status === 200 && b.tenantId === legacyId && b.accessKey === legacyKey, "migrate: Login danach möglich, accessKey geliefert");
  // Alt-Mandant wurde auf Klartext-accessKey gehoben
  const upgraded = JSON.parse(await fs.readFile(path.join(tmp, "tenants", `${legacyId}.json`), "utf8"));
  ok(upgraded.accessKey === legacyKey && !upgraded.accessKeyHash, "migrate: Mandant auf Klartext-accessKey gehoben");

  r = await fetch(`${BASE}/health`); b = await J(r);
  ok(b.users === 2, "health: Benutzerzahl aktualisiert (stefan + olduser)");

  // --- Support-Zugang (Vendor <-> Kunde) ---
  const SK = "test-support-key";
  // Vendor lädt Public-Key hoch, Kunde kann ihn öffentlich abrufen
  r = await put("/api/support/pubkey", { pubKeyJwk: { kty: "RSA", n: "demo" } }, SK);
  ok(r.status === 200, "support: Vendor lädt Public-Key hoch");
  r = await put("/api/support/pubkey", { pubKeyJwk: { kty: "RSA", n: "x" } }, "falsch");
  ok(r.status === 401, "support: falscher SUPPORT_KEY -> 401");
  r = await fetch(`${BASE}/api/support/pubkey`); b = await J(r);
  ok(r.status === 200 && b.pubKeyJwk?.n === "demo", "support: Public-Key öffentlich abrufbar");

  // Vendor stellt Anfrage an stefans Mandanten
  r = await post("/api/support/request", { tenantId, scope: "full", note: "Hilfe", expiresAt: new Date(Date.now() + 3600e3).toISOString() }, SK);
  b = await J(r);
  ok(r.status === 201 && b.requestId, "support: Vendor stellt Anfrage");
  const reqId = b.requestId;
  r = await post("/api/support/request", { tenantId, scope: "full" }, "falsch");
  ok(r.status === 401, "support: Anfrage ohne SUPPORT_KEY -> 401");

  // Kunde sieht die Anfrage (mit accessKey)
  r = await fetch(`${BASE}/api/tenants/${tenantId}/support-requests`, { headers: { Authorization: `Bearer ${accessKey}` } });
  b = await J(r);
  ok(r.status === 200 && b.requests.length === 1 && b.requests[0].id === reqId, "support: Kunde sieht offene Anfrage");
  r = await fetch(`${BASE}/api/tenants/${tenantId}/support-requests`, { headers: { Authorization: "Bearer falsch" } });
  ok(r.status === 401, "support: Anfragen nur mit Mandanten-Key");

  // Kunde gibt frei (liefert wrappedDek)
  r = await post(`/api/tenants/${tenantId}/support-grant`, { requestId: reqId, wrappedDek: "DEK_FUER_VENDOR", expiresAt: new Date(Date.now() + 3600e3).toISOString() }, accessKey);
  ok(r.status === 200, "support: Kunde gibt Zugang frei");

  // Vendor sieht aktiven Grant inkl. accessKey + wrappedDek
  r = await fetch(`${BASE}/api/support/grants`, { headers: { Authorization: `Bearer ${SK}` } }); b = await J(r);
  const g = (b.grants || []).find((x) => x.tenantId === tenantId);
  ok(r.status === 200 && g && g.wrappedDek === "DEK_FUER_VENDOR" && g.accessKey === accessKey && g.scope === "full", "support: Vendor erhält Grant + Schlüssel");
  r = await fetch(`${BASE}/api/support/grants`, { headers: { Authorization: "Bearer falsch" } });
  ok(r.status === 401, "support: Grants nur mit SUPPORT_KEY");

  // Kunde widerruft -> Grant verschwindet beim Vendor
  r = await post(`/api/tenants/${tenantId}/support-revoke`, { grantId: g.grantId }, accessKey);
  ok(r.status === 200, "support: Kunde widerruft");
  r = await fetch(`${BASE}/api/support/grants`, { headers: { Authorization: `Bearer ${SK}` } }); b = await J(r);
  ok(!(b.grants || []).some((x) => x.tenantId === tenantId), "support: widerrufener Grant ist weg");
} finally {
  server.close();
  await fs.rm(tmp, { recursive: true, force: true });
}

console.log(`\nHub-Auth-Tests: ${pass} ok, ${fail} fehlgeschlagen`);
process.exit(fail ? 1 : 0);
