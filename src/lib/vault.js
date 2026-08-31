// iou.fm – server-gestützte, Ende-zu-Ende-verschlüsselte Anmeldung.
//
// Aus dem Passwort werden zwei Werte abgeleitet:
//   - authHash : geht an den Hub (der speichert nur sha256(authHash)).
//   - vaultKey : bleibt auf dem Gerät, entpackt den DEK (Datenschlüssel).
// Der Hub authentifiziert und liefert den verschlüsselten Block; lesen kann er
// ihn nicht. Anmeldung daher von jedem Gerät nur mit Benutzername + Passwort.
//
// Lokal bleibt ein verschlüsselter Cache der VOLLEN Daten (für Offline und für
// die Löhne, die nie zum Hub übertragen werden). Geteilt wird nur sharedSubset.

import { HUB_URL } from "../config.js";
import { bioStore, bioUnlockSecret, bioDisable } from "./biometric.js";
export { bioAvailable, bioEnabledUser, bioDisable } from "./biometric.js";

const SESSION_KEY = "iou_session_v3";
const LEGACY_STORE = "sepa2_vault_v2"; // alter lokaler Tresor (für Migration)
const ITER = 310000;
const enc = new TextEncoder();
const dec = new TextDecoder();

// Hinweis zu EBICS: Verbindungsparameter (Host-/Kunden-/Teilnehmer-ID, URL) liegen in
// config.ebics – das sind keine Geheimnisse und dürfen mit dem Hub syncen. Die PRIVATEN
// EBICS-Schlüssel liegen ausschließlich in `ebicsKeys` (lokal) und sind bewusst NICHT in
// SHARED_KEYS – sie verlassen das Gerät nie (wie die Löhne). E2E bleibt unangetastet.
export const DEFAULT_DATA = { accounts: [], suppliers: [], gfIbans: [], refunds: [], invoices: [], creditors: {}, batches: [], deletedIds: [], belegeArchive: {}, shopify: {}, ecommerce: { platform: "shopify" }, branding: {}, ebicsKeys: null, config: { payoutMode: "erstattung", setupComplete: false, modules: { rechnung: false, ebics: false }, ebics: { enabled: false, bankName: "", hostId: "", partnerId: "", userId: "", ebicsUrl: "", version: "H005", status: "uninitialized" } } };

// Bytes -> Base64, chunk-weise. WICHTIG: kein `String.fromCharCode(...bytes)` mit Spread,
// das übergibt jedes Byte als Argument und sprengt bei großen Daten den Stack
// ("Maximum call stack size exceeded" – z. B. beim Frischanmelden mit großem Datensatz).
const b64 = (buf) => {
  const bytes = new Uint8Array(buf);
  let bin = "";
  const CHUNK = 0x8000; // 32 KB pro Block – sicher unter dem Argument-Limit
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
};
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const rand = (n) => crypto.getRandomValues(new Uint8Array(n));
const hex = (bytes) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
const api = (p) => HUB_URL.replace(/\/+$/, "") + p;

async function postJson(path, body, accessKey) {
  return fetch(api(path), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(accessKey ? { Authorization: `Bearer ${accessKey}` } : {}) },
    body: JSON.stringify(body),
  });
}

// --- Krypto ------------------------------------------------------------------
async function deriveMaster(password, salt) {
  const base = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: ITER, hash: "SHA-256" }, base, 256);
  return new Uint8Array(bits);
}
async function sha256(...parts) {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const buf = new Uint8Array(total); let o = 0;
  for (const p of parts) { buf.set(p, o); o += p.length; }
  return new Uint8Array(await crypto.subtle.digest("SHA-256", buf));
}
async function deriveKeys(password, salt) {
  const master = await deriveMaster(password, salt);
  const authHash = hex(await sha256(master, enc.encode("iou-auth")));
  const vkBits = await sha256(master, enc.encode("iou-vault"));
  const vaultKey = await crypto.subtle.importKey("raw", vkBits, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
  return { authHash, vaultKey };
}
const importDek = (raw) => crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, true, ["encrypt", "decrypt"]);

async function wrap(key, rawBytes) {
  const iv = rand(12);
  const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, rawBytes);
  return { iv: b64(iv), data: b64(data) };
}
async function unwrap(key, blob) {
  return crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(blob.iv) }, key, unb64(blob.data));
}
export async function syncEncrypt(session, obj) {
  const iv = rand(12);
  const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, session.dek, enc.encode(JSON.stringify(obj)));
  return { iv: b64(iv), data: b64(data) };
}
export async function syncDecryptRaw(session, blob) {
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(blob.iv) }, session.dek, unb64(blob.data));
  return JSON.parse(dec.decode(plain));
}

// --- Daten-Split (Löhne bleiben lokal) ---------------------------------------
const SHARED_KEYS = ["accounts", "suppliers", "refunds", "invoices", "creditors", "shopify", "branding", "config", "invoiceMailSeen", "deletedIds", "belegeArchive"];
export function sharedSubset(data) {
  const out = {};
  for (const k of SHARED_KEYS) out[k] = data[k];
  out.batches = (data.batches || []).filter((b) => b.kind !== "lohn");
  return out;
}
const indexById = (arr = []) => { const m = new Map(); for (const x of arr) if (x && x.id != null) m.set(x.id, x); return m; };
function unionById(a = [], b = []) { const m = indexById(a); for (const x of b || []) if (x && x.id != null) m.set(x.id, x); return Array.from(m.values()); }
// Wie unionById, ABER: ein bereits „erledigter" (bezahlter/ausgeführter) Eintrag darf NIE wieder
// auf „offen" zurückfallen – egal, welche Seite beim Sync älter ist. Vorher gewann stumpf die
// (evtl. veraltete) Server-Version → frisch bezahlte Rechnungen UND Erstattungen tauchten nach dem
// nächsten Abgleich wieder als „offen" auf. Gilt für Rechnungen und Erstattungen. Bezahlte Daten
// gehen nie verloren.
function mergeKeepDone(a = [], b = []) {
  const m = indexById(a);
  for (const x of b || []) {
    if (!x || x.id == null) continue;
    const cur = m.get(x.id);
    // Lokal bereits erledigt, Server noch offen → lokale (erledigte) Version behalten.
    if (cur && cur.status === "erledigt" && x.status !== "erledigt") continue;
    m.set(x.id, x); // sonst Server-Version übernehmen (inkl. Server=erledigt gewinnt über offen)
  }
  return Array.from(m.values());
}
export function mergeShared(localData, shared) {
  const lohn = (localData.batches || []).filter((b) => b.kind === "lohn");
  const localNonLohn = (localData.batches || []).filter((b) => b.kind !== "lohn");
  // Lösch-Merker (Tombstones): IDs, die auf irgendeinem Gerät gelöscht wurden, werden NUR
  // vereinigt – nie verkleinert. Dadurch übersteht eine Löschung Sync UND Update, statt dass
  // die rein additive unionById-Zusammenführung den Eintrag (z. B. eine Erstattung) wieder
  // einspielt. Anschließend werden getilgte IDs aus allen per-ID gemischten Listen entfernt.
  const deletedIds = Array.from(new Set([...(localData.deletedIds || []), ...(shared.deletedIds || [])])).slice(-10000);
  const tomb = new Set(deletedIds);
  const alive = (arr) => arr.filter((x) => !(x && x.id != null && tomb.has(x.id)));
  return {
    ...localData,
    accounts: alive(unionById(localData.accounts, shared.accounts)),
    suppliers: alive(unionById(localData.suppliers, shared.suppliers)),
    refunds: alive(mergeKeepDone(localData.refunds, shared.refunds)),
    invoices: alive(mergeKeepDone(localData.invoices, shared.invoices)),
    creditors: { ...(localData.creditors || {}), ...(shared.creditors || {}) },
    // Revisionssicheres Belege-Archiv: nur VEREINIGEN, nie verkleinern (append-only) –
    // einmal archivierte Belege bleiben dauerhaft erhalten.
    belegeArchive: { ...(localData.belegeArchive || {}), ...(shared.belegeArchive || {}) },
    shopify: shared.shopify ?? localData.shopify,
    branding: shared.branding ?? localData.branding,
    config: { ...(localData.config || {}), ...(shared.config || {}) },
    batches: [...alive(unionById(localNonLohn, shared.batches)), ...lohn],
    deletedIds,
    // Schon eingelesene Beleg-IDs nur VEREINIGEN, nie verkleinern – sonst werden per
    // E-Mail eingegangene (und teils längst bezahlte) Rechnungen nach Sync/Neustart erneut importiert.
    invoiceMailSeen: Array.from(new Set([...(localData.invoiceMailSeen || []), ...(shared.invoiceMailSeen || [])])).slice(-5000),
  };
}

// --- Revision (für Konflikt-Schutz beim Sync) --------------------------------
const revKey = (tenantId) => `iou_rev_${tenantId}`;
export const getRev = (tenantId) => Number(localStorage.getItem(revKey(tenantId)) || 0);
export const setRev = (tenantId, rev) => localStorage.setItem(revKey(tenantId), String(rev));

// --- Lokaler Cache (volle Daten, inkl. Löhne) --------------------------------
const cacheKey = (tenantId, username) => `iou_cache_${tenantId}_${String(username).toLowerCase()}`;
async function saveCache(session, data) {
  const blob = await syncEncrypt(session, data);
  localStorage.setItem(cacheKey(session.tenantId, session.currentUser.username), JSON.stringify(blob));
}
async function loadCache(session) {
  try {
    const blob = JSON.parse(localStorage.getItem(cacheKey(session.tenantId, session.currentUser.username)));
    if (!blob) return null;
    return await syncDecryptRaw(session, blob);
  } catch { return null; }
}

// --- Hub-Dokument ------------------------------------------------------------
async function getDoc(tenantId, accessKey) {
  const r = await fetch(api(`/api/tenants/${tenantId}/doc`), { headers: { Authorization: `Bearer ${accessKey}` } });
  if (!r.ok) throw new Error("Daten konnten nicht geladen werden.");
  return r.json();
}

// --- Session-Persistenz (Reload) ---------------------------------------------
async function persistSession(session) {
  const raw = await crypto.subtle.exportKey("raw", session.dek);
  sessionStorage.setItem(SESSION_KEY, JSON.stringify({
    dek: b64(raw), tenantId: session.tenantId, accessKey: session.accessKey,
    username: session.currentUser.username, role: session.currentUser.role, owner: !!session.currentUser.owner,
    authHash: session.authHash, company: session.company || "",
  }));
}

async function buildSession({ tenantId, accessKey, role, owner = false, username, authHash, dek }) {
  const session = { dek, tenantId, accessKey, authHash, company: "", currentUser: { username, role, owner: !!owner }, users: [{ username, role }], data: { ...DEFAULT_DATA } };
  // Geteilten Stand vom Hub holen …
  let shared = null;
  try {
    const doc = await getDoc(tenantId, accessKey);
    session.company = doc.company || "";
    setRev(tenantId, doc.rev || 0);
    if (doc.payload) shared = await syncDecryptRaw(session, doc.payload);
  } catch { /* offline -> nur lokaler Cache */ }
  // … mit lokalem Cache (Löhne!) zusammenführen.
  const cached = await loadCache(session);
  const base = cached || { ...DEFAULT_DATA };
  session.data = shared ? mergeShared(base, shared) : base;
  await persistSession(session);
  await saveCache(session, session.data);
  if (role === "admin") { try { session.users = await fetchUsers(session); } catch { /* egal */ } }
  return session;
}

// --- Öffentliche API ---------------------------------------------------------
export async function register(username, password, company = "") {
  const salt = rand(16);
  const { authHash, vaultKey } = await deriveKeys(password, salt);
  const dekKey = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
  const rawDek = await crypto.subtle.exportKey("raw", dekKey);
  const wrappedDek = await wrap(vaultKey, rawDek);
  const r = await postJson("/api/auth/register", { username: username.trim(), salt: b64(salt), authHash, wrappedDek, company: company.trim() });
  if (r.status === 409) throw new Error("Benutzername ist bereits vergeben.");
  if (!r.ok) throw new Error("Registrierung fehlgeschlagen.");
  const { tenantId, accessKey, role, owner } = await r.json();
  return buildSession({ tenantId, accessKey, role, owner, username: username.trim(), authHash, dek: dekKey });
}

export async function login(username, password) {
  return doLogin(username.trim(), password, true);
}
async function doLogin(username, password, allowMigrate) {
  const pre = await postJson("/api/auth/prelogin", { username });
  if (pre.status === 404) {
    if (allowMigrate && (await tryMigrateLegacy(username, password))) return doLogin(username, password, false);
    throw new Error("Benutzer nicht gefunden.");
  }
  if (!pre.ok) throw new Error("Hub nicht erreichbar.");
  const { salt } = await pre.json();
  const { authHash, vaultKey } = await deriveKeys(password, unb64(salt));
  const r = await postJson("/api/auth/login", { username, authHash });
  if (r.status === 401) throw new Error("Falsches Passwort.");
  if (!r.ok) throw new Error("Anmeldung fehlgeschlagen.");
  const { tenantId, accessKey, wrappedDek, role, owner } = await r.json();
  let rawDek;
  try { rawDek = await unwrap(vaultKey, wrappedDek); }
  catch { throw new Error("Schlüssel passt nicht (Passwort?)."); }
  const dekKey = await importDek(rawDek);
  return buildSession({ tenantId, accessKey, role, owner, username, authHash, dek: dekKey });
}

// Migration: alten lokalen Tresor (sepa2_vault_v2) erkennen, mit dem Passwort
// entsperren und denselben Mandanten per /api/auth/migrate ins Login-System heben.
async function tryMigrateLegacy(username, password) {
  let s; try { s = JSON.parse(localStorage.getItem(LEGACY_STORE)); } catch { return false; }
  if (!s || !s.users || !s.sync || !s.sync.tenantId || !s.sync.accessKey) return false;
  const u = s.users.find((x) => x.username.toLowerCase() === username.toLowerCase());
  if (!u) return false;
  // Alt-Entsperrung: PBKDF2 -> AES-Key, entpackt rawDek.
  let rawDek;
  try {
    const base = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveKey"]);
    const key = await crypto.subtle.deriveKey(
      { name: "PBKDF2", salt: unb64(u.salt), iterations: ITER, hash: "SHA-256" },
      base, { name: "AES-GCM", length: 256 }, false, ["decrypt"]
    );
    rawDek = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(u.wrapIv) }, key, unb64(u.wrappedDek));
  } catch { return false; } // falsches Passwort für Alt-Tresor
  // Neue Login-Hülle für denselben rawDek erzeugen.
  const salt = rand(16);
  const { authHash, vaultKey } = await deriveKeys(password, salt);
  const wrappedDek = await wrap(vaultKey, rawDek);
  const r = await postJson("/api/auth/migrate", {
    tenantId: s.sync.tenantId, accessKey: s.sync.accessKey, username,
    salt: b64(salt), authHash, wrappedDek, role: u.role || "admin",
  });
  return r.ok;
}

export async function restoreSession() {
  const raw = sessionStorage.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    const s = JSON.parse(raw);
    const dek = await importDek(unb64(s.dek));
    const session = { dek, tenantId: s.tenantId, accessKey: s.accessKey, authHash: s.authHash, company: s.company || "", currentUser: { username: s.username, role: s.role, owner: !!s.owner }, users: [{ username: s.username, role: s.role }], data: { ...DEFAULT_DATA } };
    const cached = await loadCache(session);
    session.data = cached || { ...DEFAULT_DATA };
    if (s.role === "admin") { try { session.users = await fetchUsers(session); } catch { /* offline */ } }
    return session;
  } catch { return null; }
}

// Lokal sichern (volle Daten, verschlüsselt). Hub-Push macht der Sync-Layer.
export async function saveVault(session, data) {
  await saveCache(session, data);
}

export async function addUser(session, username, password, role = "user") {
  if (session.currentUser.role !== "admin") throw new Error("Nur Admins dürfen Benutzer anlegen.");
  if (!username.trim() || password.length < 6) throw new Error("Benutzername nötig, Passwort min. 6 Zeichen.");
  const rawDek = await crypto.subtle.exportKey("raw", session.dek);
  const salt = rand(16);
  const { authHash, vaultKey } = await deriveKeys(password, salt);
  const wrappedDek = await wrap(vaultKey, rawDek);
  const r = await postJson("/api/auth/adduser", {
    adminUsername: session.currentUser.username, adminAuthHash: session.authHash,
    newUser: { username: username.trim(), salt: b64(salt), authHash, wrappedDek, role },
  }, session.accessKey);
  if (r.status === 409) throw new Error("Benutzername ist bereits vergeben.");
  if (!r.ok) throw new Error("Benutzer konnte nicht angelegt werden.");
  return fetchUsers(session);
}

export async function removeUser(session, username) {
  if (session.currentUser.role !== "admin") throw new Error("Nur Admins dürfen Benutzer entfernen.");
  const r = await postJson("/api/auth/users/delete", {
    adminUsername: session.currentUser.username, adminAuthHash: session.authHash, username,
  }, session.accessKey);
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    if (j.error === "cannot_remove_self") throw new Error("Sich selbst kann man nicht entfernen.");
    if (j.error === "last_admin") throw new Error("Der letzte Admin kann nicht entfernt werden – lege erst einen weiteren Admin an.");
    if (j.error === "not_admin") throw new Error("Nur Admins dürfen Benutzer entfernen.");
    throw new Error("Benutzer konnte nicht entfernt werden.");
  }
  return fetchUsers(session);
}

export async function fetchUsers(session) {
  const r = await postJson("/api/auth/users/list", {
    adminUsername: session.currentUser.username, adminAuthHash: session.authHash,
  }, session.accessKey);
  if (!r.ok) return session.users;
  const { users } = await r.json();
  return users;
}

export function clearSession() {
  sessionStorage.removeItem(SESSION_KEY);
}

// --- Biometrisches Entsperren (Touch ID / Windows Hello) --------------------
// Speichert nach erfolgreichem Login die zum Wiederaufbau der Sitzung nötigen
// Werte (inkl. Datenschlüssel) im OS-Schlüsselspeicher – biometrisch geschützt.
export async function enableBiometric(session) {
  const raw = await crypto.subtle.exportKey("raw", session.dek);
  const blob = JSON.stringify({
    dek: b64(raw), tenantId: session.tenantId, accessKey: session.accessKey,
    username: session.currentUser.username, role: session.currentUser.role,
    owner: !!session.currentUser.owner, authHash: session.authHash,
  });
  await bioStore(session.currentUser.username, blob);
}
// Entsperrt per Touch ID/Hello und baut die Sitzung ohne Passwort wieder auf.
export async function unlockWithBiometrics() {
  let blob;
  try {
    blob = await bioUnlockSecret();
  } catch (err) {
    const raw = typeof err === "string" ? err : (err?.message || "");
    // Marker vorhanden, aber Schlüsseldatei fehlt (z. B. nach Umstieg vom Schlüsselbund
    // oder gelöschtem App-Datenordner): veralteten Marker entfernen und sauber melden.
    if (/no such file|os error 2|not.?found|entry not found/i.test(raw)) {
      try { await bioDisable(); } catch { /* egal */ }
      throw new Error("Touch ID muss einmal neu eingerichtet werden – bitte mit Passwort anmelden und Touch ID aktivieren.");
    }
    throw err;
  }
  const s = JSON.parse(blob);
  const dek = await importDek(unb64(s.dek));
  return buildSession({ tenantId: s.tenantId, accessKey: s.accessKey, role: s.role, owner: s.owner, username: s.username, authHash: s.authHash, dek });
}
