// iou.fm – Sync-Hub
// -------------------------------------------------------------
// Einzige Cloud-Komponente. Speichert pro Mandant eine EIGENE DB-Datei und
// darin NUR Ende-zu-Ende-verschluesselten Chiffretext. Der Server kann die
// Inhalte nicht lesen (keine Datenschluessel hier).
//
// Anmeldung (server-gestuetzt, aber weiterhin E2E – Modell wie Bitwarden):
//   Aus dem Passwort leitet der Client ZWEI Werte ab:
//     - authHash  -> an den Server (der speichert nur sha256(authHash) = "verifier")
//     - vaultKey  -> bleibt auf dem Geraet, entpackt den DEK (Datenschluessel)
//   Der Server kann den Nutzer authentifizieren und den verschluesselten Block
//   herausgeben, ihn aber NICHT entschluesseln.
//
// Endpunkte:
//   GET  /health
//   POST /api/auth/register   { username, salt, authHash, wrappedDek, company }
//   POST /api/auth/prelogin   { username } -> { salt }
//   POST /api/auth/login      { username, authHash } -> { tenantId, accessKey, wrappedDek, role }
//   POST /api/auth/adduser    (Bearer accessKey) Admin legt Mitarbeiter an
//   POST /api/auth/migrate    bestehenden Mandanten auf das Login-System heben
//   GET/PUT/DELETE /api/tenants/:id[/doc]  (Bearer accessKey) – Sync-Transport

import http from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fetchOrdersSince, fetchOpenDisputeOrders, fetchResolvedDisputeOrders, tallyDisputeOutcomes, collectFromOrders } from "./shopify.mjs";
import { buildAccountantCsv, thisMonthKey, isLastDayOfMonth, sendViaResend } from "./accountant.mjs";
import { oauthConfigured, normalizeShop, buildAuthUrl, verifyState, verifyShopifyHmac, exchangeToken } from "./shopify-oauth.mjs";
import { TRIAL_DAYS, PLANS, planExists, priceIdForPlan, seatPriceId, licenseView, applyStripeEvent, billingEnforced } from "./billing.mjs";
import { stripeConfigured, createCheckoutSession, createPortalSession, setSeatPacks, verifyWebhook } from "./stripe.mjs";

const PUBLIC_URL = (process.env.PUBLIC_URL || "https://ioufm-production.up.railway.app").replace(/\/+$/, "");

const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = process.env.DATA_DIR || "./data";
const TENANT_DIR = path.join(DATA_DIR, "tenants");
const USER_DIR = path.join(DATA_DIR, "users");
const MAX_BODY = 8 * 1024 * 1024;
const ORIGIN = process.env.CORS_ORIGIN || "*";

const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");
const newId = () => crypto.randomUUID();
const newKey = () => crypto.randomBytes(32).toString("base64url");
const eq = (a, b) => {
  const x = Buffer.from(String(a || "")); const y = Buffer.from(String(b || ""));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

// --- At-Rest-Verschlüsselung für den Shopify-Token --------------------------
// Schlüssel aus ENV HUB_SECRET. Ohne HUB_SECRET wird der Token im Klartext
// gespeichert (nur für lokale Entwicklung) – auf Railway HUB_SECRET setzen!
const HUB_SECRET = process.env.HUB_SECRET || "";
const TOK_KEY = HUB_SECRET ? crypto.createHash("sha256").update(HUB_SECRET).digest() : null;

// --- Support-Zugang (Anbieter/Vendor) ---------------------------------------
// SUPPORT_KEY ist das Vendor-Credential (nur fork-and-merge kennt es). Die
// Kundendaten bleiben E2E-verschlüsselt: der Vendor sieht nur, was der Kunde
// per wrappedDek (für den Support-Public-Key) explizit & befristet freigibt.
const SUPPORT_KEY = process.env.SUPPORT_KEY || "";

// --- Monatlicher Buchhaltungs-Versand (Resend) ------------------------------
const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
const RESEND_FROM = process.env.RESEND_FROM || "iou.fm <onboarding@resend.dev>";
async function sendAccountantFor(t, ym) {
  const a = t.accountant || {};
  if (!a.enabled || !a.email) return { skipped: true, reason: "not_configured" };
  if (!RESEND_API_KEY) return { skipped: true, reason: "no_resend_key" };
  const csv = buildAccountantCsv(t.shopifyFeed || {}, ym, t.appRefunds || []);
  await sendViaResend({
    apiKey: RESEND_API_KEY, from: RESEND_FROM, to: a.email, cc: a.cc || null,
    subject: `Stornos & Erstattungen ${ym} – ${t.company || "iou.fm"}`,
    text: `Anbei die Stornierungen und Rückerstattungen für ${ym}.\n\nAutomatisch erstellt von iou.fm.`,
    filename: `Stornos_Erstattungen_${ym}.csv`, csv,
  });
  t.accountant.lastSentMonth = ym;
  t.accountant.lastSentAt = new Date().toISOString();
  await writeTenant(t);
  return { ok: true, month: ym, to: a.email };
}
async function runAllAccountantMails() {
  let files = [];
  try { files = (await fs.readdir(TENANT_DIR)).filter((f) => f.endsWith(".json")); } catch { return; }
  const ym = thisMonthKey();
  for (const f of files) {
    const t = await readJson(path.join(TENANT_DIR, f));
    if (t?.accountant?.enabled && t.accountant.lastSentMonth !== ym) {
      try { await sendAccountantFor(t, ym); } catch (e) { console.warn("Buchhaltungs-Mail fehlgeschlagen", t.tenantId, e.message); }
    }
  }
}
function scheduleMonthlyMail() {
  const msUntil2359 = () => {
    const n = new Date(); const next = new Date(n);
    next.setHours(23, 59, 0, 0);
    if (next <= n) next.setDate(next.getDate() + 1);
    return next - n;
  };
  const tick = async () => {
    try { if (isLastDayOfMonth(new Date())) await runAllAccountantMails(); }
    catch (e) { console.warn("Monats-Mail-Tick:", e.message); }
    setTimeout(tick, msUntil2359());
  };
  setTimeout(tick, msUntil2359());
}
const SUPPORT_FILE = path.join(DATA_DIR, "support.json");
const supportAuth = (req) => !!SUPPORT_KEY && eq(bearer(req), SUPPORT_KEY);
const now = () => Date.now();
const notExpired = (g) => !g.expiresAt || new Date(g.expiresAt).getTime() > now();
function encToken(plain) {
  if (!plain) return "";
  if (!TOK_KEY) return plain;
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", TOK_KEY, iv);
  const ct = Buffer.concat([c.update(String(plain), "utf8"), c.final()]);
  return "enc:v1:" + Buffer.concat([iv, c.getAuthTag(), ct]).toString("base64");
}
function decToken(stored) {
  if (!stored || typeof stored !== "string" || !stored.startsWith("enc:v1:")) return stored || "";
  if (!TOK_KEY) return ""; // verschlüsselt, aber kein Schlüssel vorhanden
  try {
    const buf = Buffer.from(stored.slice(7), "base64");
    const d = crypto.createDecipheriv("aes-256-gcm", TOK_KEY, buf.subarray(0, 12));
    d.setAuthTag(buf.subarray(12, 28));
    return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString("utf8");
  } catch { return ""; }
}

// --- Pro-Mandant-Schreibsperre ----------------------------------------------
const locks = new Map();
function withLock(id, fn) {
  const prev = locks.get(id) || Promise.resolve();
  const next = prev.then(fn, fn);
  locks.set(id, next.catch(() => {}));
  return next;
}

const validId = (id) => /^[0-9a-f-]{36}$/i.test(id || "");
const validUser = (u) => /^[a-zA-Z0-9._@-]{1,64}$/.test(u || "");
const tenantFile = (id) => path.join(TENANT_DIR, `${id}.json`);
const userFile = (u) => path.join(USER_DIR, `${String(u).toLowerCase()}.json`);

async function readJson(file) { try { return JSON.parse(await fs.readFile(file, "utf8")); } catch { return null; } }
async function writeJson(file, obj) {
  const tmp = file + ".tmp";
  await fs.writeFile(tmp, JSON.stringify(obj));
  await fs.rename(tmp, file); // atomar
}
const readTenant = (id) => readJson(tenantFile(id));
const writeTenant = (t) => writeJson(tenantFile(t.tenantId), t);
const readUser = (u) => readJson(userFile(u));
const writeUser = (rec) => writeJson(userFile(rec.username), rec);

// Mandanten-Zugriffsschluessel pruefen: neuer Klartext-accessKey ODER Alt-Hash.
function tenantKeyOk(provided, t) {
  if (!provided || !t) return false;
  if (t.accessKey) return eq(provided, t.accessKey);
  if (t.accessKeyHash) return eq(sha256(provided), t.accessKeyHash);
  return false;
}

// --- Shopify-Sync pro Mandant -----------------------------------------------
const DAY = 24 * 60 * 60 * 1000;
const mergeById = (existing = [], incoming = [], keyFn) => {
  const m = new Map(existing.map((x) => [keyFn(x), x]));
  for (const x of incoming) m.set(keyFn(x), x); // Neues gewinnt (Status-Update)
  return Array.from(m.values());
};

// Holt Stornos/Refunds/Anfragen seit letztem Lauf und schreibt sie in den Feed.
async function syncTenant(t) {
  const intg = t.integration;
  if (!intg || !intg.shopify || !intg.shopify.token || !intg.shopify.domain) return { skipped: true };
  const since = intg.lastSyncAt || new Date(Date.now() - 90 * DAY).toISOString();
  const token = decToken(intg.shopify.token);
  if (!token) return { skipped: true, reason: "token_unreadable" };
  // 1) Stornos + Rückerstattungen seit letztem Lauf (Archiv, wird angehängt).
  const nodes = await fetchOrdersSince(intg.shopify.domain, token, since);
  const found = collectFromOrders(nodes, { tagCfg: intg.tags || {}, since: intg.lastSyncAt || null });
  // 2) Offene Rückbuchungen/Disputes (Live-Snapshot, datumsunabhängig).
  const disputeNodes = await fetchOpenDisputeOrders(intg.shopify.domain, token);
  const openDisputes = collectFromOrders(disputeNodes, { tagCfg: intg.tags || {} })
    .requests.filter((r) => r.status === "offen");
  // 3) Abgeschlossene Rückbuchungen für die Gewinn-/Verlust-Quote.
  const resolvedNodes = await fetchResolvedDisputeOrders(intg.shopify.domain, token);
  const disputeStats = tallyDisputeOutcomes([...disputeNodes, ...resolvedNodes]);

  const feed = t.shopifyFeed || { cancellations: [], refunds: [], requests: [] };
  feed.cancellations = mergeById(feed.cancellations, found.cancellations, (c) => c.orderNumber);
  feed.refunds = mergeById(feed.refunds, found.refunds, (r) => `${r.orderNumber}|${r.refundId}`);
  feed.requests = openDisputes; // voller Ersatz: gelöste Disputes verschwinden automatisch
  feed.disputeStats = disputeStats; // Gewinnquote über alle Disputes
  feed.syncedAt = new Date().toISOString();
  t.shopifyFeed = feed;
  t.integration.lastSyncAt = feed.syncedAt;
  await writeTenant(t);
  return { ok: true, scanned: nodes.length, disputesScanned: disputeNodes.length, resolvedScanned: resolvedNodes.length, cancellations: found.cancellations.length, refunds: found.refunds.length, requests: openDisputes.length, winRate: disputeStats.winRate, syncedAt: feed.syncedAt };
}

async function runAllSyncs() {
  let files = [];
  try { files = (await fs.readdir(TENANT_DIR)).filter((f) => f.endsWith(".json")); } catch { return; }
  for (const f of files) {
    const t = await readJson(path.join(TENANT_DIR, f));
    if (t) { try { await syncTenant(t); } catch (e) { console.warn("Sync fehlgeschlagen", t.tenantId, e.message); } }
  }
}

// Nacht-Cron: jeden Tag um ~00:00 lokaler Zeit (TZ via ENV, Default Europe/Berlin).
function scheduleNightly() {
  const next = new Date();
  next.setHours(24, 0, 30, 0); // nächste 00:00:30
  const ms = next.getTime() - Date.now();
  setTimeout(() => { runAllSyncs().catch(() => {}); setInterval(() => runAllSyncs().catch(() => {}), DAY); }, ms);
  console.log(`Shopify-Nacht-Cron: nächster Lauf in ${Math.round(ms / 60000)} min`);
}

// --- HTTP-Helfer -------------------------------------------------------------
function send(res, code, obj) {
  const body = obj === undefined ? "" : JSON.stringify(obj);
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": ORIGIN,
    "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Authorization,Content-Type,If-Match",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Cache-Control": "no-store",
  });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error("too_large")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
      catch { reject(new Error("bad_json")); }
    });
    req.on("error", reject);
  });
}
function bearer(req) {
  const m = /^Bearer\s+(.+)$/.exec(req.headers["authorization"] || "");
  return m ? m[1].trim() : "";
}
const body = (req) => readBody(req).catch((e) => ({ __err: e.message }));

// Roh-Body (für Stripe-Webhook-Signaturprüfung – darf nicht vorab JSON-geparst werden).
function rawBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on("data", (c) => { size += c.length; if (size > MAX_BODY) { reject(new Error("too_large")); req.destroy(); return; } chunks.push(c); });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

// Anzahl der Benutzer eines Mandanten (für die Sitzplatz-Anzeige).
async function countTenantUsers(tenantId) {
  let used = 0;
  try {
    for (const f of (await fs.readdir(USER_DIR)).filter((x) => x.endsWith(".json"))) {
      const u = await readJson(path.join(USER_DIR, f));
      if (u && u.tenantId === tenantId) used++;
    }
  } catch {}
  return used;
}

// --- Routing -----------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    const parts = url.pathname.split("/").filter(Boolean);
    if (req.method === "OPTIONS") return send(res, 204);

    if (req.method === "GET" && url.pathname === "/health") {
      let tenants = 0, users = 0;
      try { tenants = (await fs.readdir(TENANT_DIR)).filter((f) => f.endsWith(".json")).length; } catch {}
      try { users = (await fs.readdir(USER_DIR)).filter((f) => f.endsWith(".json")).length; } catch {}
      return send(res, 200, { ok: true, service: "sepa2-sync-hub", tenants, users });
    }

    // ===== AUTH ================================================================
    if (req.method === "POST" && url.pathname === "/api/auth/register") {
      const b = await body(req); if (b.__err) return send(res, 400, { error: b.__err });
      if (!validUser(b.username)) return send(res, 400, { error: "bad_username" });
      if (!b.salt || !b.authHash || !b.wrappedDek) return send(res, 400, { error: "missing_fields" });
      if (await readUser(b.username)) return send(res, 409, { error: "username_taken" });
      const tenantId = newId();
      const accessKey = newKey();
      await writeTenant({
        tenantId, accessKey, company: String(b.company || "").slice(0, 200),
        founderUsername: b.username, // Gründer = Owner dieses Mandanten
        rev: 0, payload: null, createdAt: new Date().toISOString(), updatedAt: null,
        // 7 Tage kostenloser Test ab Registrierung.
        trialEndsAt: new Date(Date.now() + TRIAL_DAYS * 86400000).toISOString(),
        license: { plan: null, status: "trialing", seats: 5 },
      });
      await writeUser({
        username: b.username, salt: b.salt, authVerifier: sha256(b.authHash),
        wrappedDek: b.wrappedDek, role: "admin", owner: true, tenantId, createdAt: new Date().toISOString(),
      });
      return send(res, 201, { tenantId, accessKey, role: "admin", owner: true });
    }

    if (req.method === "POST" && url.pathname === "/api/auth/prelogin") {
      const b = await body(req); if (b.__err) return send(res, 400, { error: b.__err });
      const u = await readUser(b.username);
      if (!u) return send(res, 404, { error: "unknown_user" });
      return send(res, 200, { salt: u.salt });
    }

    if (req.method === "POST" && url.pathname === "/api/auth/login") {
      const b = await body(req); if (b.__err) return send(res, 400, { error: b.__err });
      const u = await readUser(b.username);
      if (!u || !eq(sha256(b.authHash || ""), u.authVerifier)) return send(res, 401, { error: "bad_credentials" });
      const t = await readTenant(u.tenantId);
      if (!t) return send(res, 404, { error: "tenant_missing" });
      // Migration: bestehender Gründer (erster Admin) wird einmalig zum Owner.
      if (!u.owner) {
        const isFounder = t.founderUsername
          ? t.founderUsername.toLowerCase() === u.username.toLowerCase()
          : u.role === "admin"; // Alt-Mandant ohne founderUsername: der Admin ist der Gründer
        if (isFounder) {
          u.owner = true;
          await writeUser(u);
          if (!t.founderUsername) { t.founderUsername = u.username; await writeTenant(t); }
        }
      }
      return send(res, 200, { tenantId: u.tenantId, accessKey: t.accessKey, wrappedDek: u.wrappedDek, role: u.role, owner: !!u.owner });
    }

    // Admin legt Mitarbeiter an (Bearer = accessKey des Mandanten + Admin-Nachweis).
    if (req.method === "POST" && url.pathname === "/api/auth/adduser") {
      const b = await body(req); if (b.__err) return send(res, 400, { error: b.__err });
      const admin = await readUser(b.adminUsername);
      if (!admin || admin.role !== "admin" || !eq(sha256(b.adminAuthHash || ""), admin.authVerifier))
        return send(res, 401, { error: "not_admin" });
      const t = await readTenant(admin.tenantId);
      if (!t || !tenantKeyOk(bearer(req), t)) return send(res, 401, { error: "unauthorized" });
      const nu = b.newUser || {};
      if (!validUser(nu.username)) return send(res, 400, { error: "bad_username" });
      if (!nu.salt || !nu.authHash || !nu.wrappedDek) return send(res, 400, { error: "missing_fields" });
      if (await readUser(nu.username)) return send(res, 409, { error: "username_taken" });
      // Sitzplatz-Grenze: jede Lizenz enthält 5 Mitarbeiter, weitere als 5er-Pakete.
      if (billingEnforced() && !t.billingExempt) {
        const seats = licenseView(t).seatsAllowed;
        let used = 0;
        try {
          for (const f of (await fs.readdir(USER_DIR)).filter((x) => x.endsWith(".json"))) {
            const u = await readJson(path.join(USER_DIR, f));
            if (u && u.tenantId === admin.tenantId) used++;
          }
        } catch {}
        if (used >= seats) return send(res, 402, { error: "seat_limit", seats, used });
      }
      await writeUser({
        username: nu.username, salt: nu.salt, authVerifier: sha256(nu.authHash),
        wrappedDek: nu.wrappedDek, role: nu.role === "admin" ? "admin" : "user",
        tenantId: admin.tenantId, createdAt: new Date().toISOString(),
      });
      return send(res, 201, { ok: true, username: nu.username });
    }

    // Benutzerliste des Mandanten (Admin).
    if (req.method === "POST" && url.pathname === "/api/auth/users/list") {
      const b = await body(req); if (b.__err) return send(res, 400, { error: b.__err });
      const admin = await readUser(b.adminUsername);
      if (!admin || admin.role !== "admin" || !eq(sha256(b.adminAuthHash || ""), admin.authVerifier))
        return send(res, 401, { error: "not_admin" });
      const t = await readTenant(admin.tenantId);
      if (!t || !tenantKeyOk(bearer(req), t)) return send(res, 401, { error: "unauthorized" });
      let files = [];
      try { files = (await fs.readdir(USER_DIR)).filter((f) => f.endsWith(".json")); } catch {}
      const users = [];
      for (const f of files) {
        const u = await readJson(path.join(USER_DIR, f));
        if (u && u.tenantId === admin.tenantId) users.push({ username: u.username, role: u.role });
      }
      return send(res, 200, { users });
    }

    // Benutzer entfernen (Admin; nicht sich selbst, nicht den letzten Admin).
    if (req.method === "POST" && url.pathname === "/api/auth/users/delete") {
      const b = await body(req); if (b.__err) return send(res, 400, { error: b.__err });
      const admin = await readUser(b.adminUsername);
      if (!admin || admin.role !== "admin" || !eq(sha256(b.adminAuthHash || ""), admin.authVerifier))
        return send(res, 401, { error: "not_admin" });
      const t = await readTenant(admin.tenantId);
      if (!t || !tenantKeyOk(bearer(req), t)) return send(res, 401, { error: "unauthorized" });
      const target = await readUser(b.username);
      if (!target || target.tenantId !== admin.tenantId) return send(res, 404, { error: "not_found" });
      if (target.username.toLowerCase() === admin.username.toLowerCase())
        return send(res, 400, { error: "cannot_remove_self" });
      await fs.rm(userFile(b.username), { force: true });
      return send(res, 200, { ok: true });
    }

    // Bestehenden Mandanten auf das Login-System heben (vom Alt-Geraet ausgeloest).
    if (req.method === "POST" && url.pathname === "/api/auth/migrate") {
      const b = await body(req); if (b.__err) return send(res, 400, { error: b.__err });
      if (!validId(b.tenantId) || !validUser(b.username)) return send(res, 400, { error: "bad_request" });
      if (!b.salt || !b.authHash || !b.wrappedDek) return send(res, 400, { error: "missing_fields" });
      const t = await readTenant(b.tenantId);
      if (!t || !tenantKeyOk(b.accessKey, t)) return send(res, 401, { error: "unauthorized" });
      const existing = await readUser(b.username);
      if (existing && existing.tenantId !== b.tenantId) return send(res, 409, { error: "username_taken" });
      await writeUser({
        username: b.username, salt: b.salt, authVerifier: sha256(b.authHash),
        wrappedDek: b.wrappedDek, role: b.role === "user" ? "user" : "admin",
        tenantId: b.tenantId, createdAt: new Date().toISOString(),
      });
      // Alt-Mandant (nur Hash) auf Klartext-accessKey heben, damit Login ihn liefern kann.
      if (!t.accessKey) { t.accessKey = b.accessKey; delete t.accessKeyHash; await writeTenant(t); }
      return send(res, 200, { ok: true, tenantId: b.tenantId, accessKey: t.accessKey, role: b.role === "user" ? "user" : "admin" });
    }

    // ===== SHOPIFY-INTEGRATION (serverseitig, für Nacht-Cron) =================
    if (parts[0] === "api" && parts[1] === "tenants" && parts[3] === "integration") {
      const id = parts[2];
      if (!validId(id)) return send(res, 404, { error: "not_found" });
      const t = await readTenant(id);
      if (!t) return send(res, 404, { error: "not_found" });
      if (!tenantKeyOk(bearer(req), t)) return send(res, 401, { error: "unauthorized" });

      if (req.method === "GET") {
        const intg = t.integration || {};
        return send(res, 200, {
          shopifyDomain: intg.shopify?.domain || "",
          hasToken: !!intg.shopify?.token,
          tags: intg.tags || {},
          lastSyncAt: intg.lastSyncAt || null,
        });
      }
      if (req.method === "PUT") {
        const b = await body(req); if (b.__err) return send(res, 400, { error: b.__err });
        t.integration = t.integration || {};
        if (b.shopify) {
          t.integration.shopify = {
            domain: String(b.shopify.domain || "").trim(),
            // Token verschlüsselt ablegen; nur überschreiben, wenn neuer mitgeschickt
            token: b.shopify.token ? encToken(String(b.shopify.token)) : (t.integration.shopify?.token || ""),
          };
        }
        if (b.tags) t.integration.tags = b.tags;
        await writeTenant(t);
        return send(res, 200, { ok: true });
      }
      return send(res, 405, { error: "method_not_allowed" });
    }

    // ===== SHOPIFY OAUTH ("Mit Shopify verbinden") ===========================
    // POST /api/tenants/:id/shopify/oauth-start { shop } -> { url } (authentifiziert)
    if (parts[0] === "api" && parts[1] === "tenants" && parts[3] === "shopify" && parts[4] === "oauth-start" && req.method === "POST") {
      const id = parts[2];
      if (!validId(id)) return send(res, 404, { error: "not_found" });
      const t = await readTenant(id);
      if (!t) return send(res, 404, { error: "not_found" });
      if (!tenantKeyOk(bearer(req), t)) return send(res, 401, { error: "unauthorized" });
      if (!oauthConfigured()) return send(res, 503, { error: "oauth_not_configured" });
      const b = await body(req); if (b.__err) return send(res, 400, { error: b.__err });
      const shop = normalizeShop(b.shop);
      if (!shop) return send(res, 400, { error: "bad_shop" });
      return send(res, 200, { url: buildAuthUrl({ shop, tenantId: id }) });
    }

    // GET /api/shopify/oauth/callback – Shopify-Redirect (öffentlich, liefert HTML)
    if (parts[0] === "api" && parts[1] === "shopify" && parts[2] === "oauth" && parts[3] === "callback" && req.method === "GET") {
      const q = Object.fromEntries(url.searchParams.entries());
      const page = (title, msg, ok = true) =>
        `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>${title}</title>
        <style>body{font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;background:#0f1115;color:#e7e9ee;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0}
        .card{background:#171a21;border:1px solid #262b36;border-radius:14px;padding:32px 36px;max-width:420px;text-align:center}
        h1{font-size:18px;margin:0 0 8px}p{color:#9aa3b2;margin:0 0 6px;font-size:14px}.ok{color:#3ddc97}.bad{color:#ff6b6b}</style></head>
        <body><div class="card"><h1 class="${ok ? "ok" : "bad"}">${title}</h1><p>${msg}</p>
        <p style="margin-top:14px">Du kannst dieses Fenster schließen und zur iou.fm-App zurückkehren.</p></div></body></html>`;
      const html = (code, body) => { res.writeHead(code, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" }); res.end(body); };
      try {
        const st = verifyState(q.state);
        if (!st) return html(400, page("Verbindung fehlgeschlagen", "Ungültiger oder abgelaufener Vorgang. Bitte erneut starten.", false));
        const shop = normalizeShop(q.shop);
        if (!shop || shop !== st.shop) return html(400, page("Verbindung fehlgeschlagen", "Shop stimmt nicht überein.", false));
        if (!verifyShopifyHmac(q)) return html(400, page("Verbindung fehlgeschlagen", "Signaturprüfung fehlgeschlagen.", false));
        const t = await readTenant(st.t);
        if (!t) return html(404, page("Verbindung fehlgeschlagen", "Mandant nicht gefunden.", false));
        const token = await exchangeToken({ shop, code: q.code });
        t.integration = t.integration || {};
        t.integration.shopify = { domain: shop, token: encToken(token), connectedAt: new Date().toISOString() };
        await writeTenant(t);
        return html(200, page("Shopify verbunden ✓", `Dein Shop „${shop}" ist jetzt mit iou.fm verbunden.`, true));
      } catch (e) {
        return html(502, page("Verbindung fehlgeschlagen", "Token konnte nicht abgerufen werden. Bitte erneut versuchen.", false));
      }
    }

    // POST /api/tenants/:id/claim-owner { ownerId } – Owner-Status per Secret freischalten.
    if (parts[0] === "api" && parts[1] === "tenants" && parts[3] === "claim-owner" && req.method === "POST") {
      const id = parts[2];
      if (!validId(id)) return send(res, 404, { error: "not_found" });
      const t = await readTenant(id);
      if (!t) return send(res, 404, { error: "not_found" });
      if (!tenantKeyOk(bearer(req), t)) return send(res, 401, { error: "unauthorized" });
      const ownerId = process.env.OWNER_ID || "";
      if (!ownerId) return send(res, 503, { error: "owner_id_not_set" });
      const b = await body(req); if (b.__err) return send(res, 400, { error: b.__err });
      if (!eq(String(b.ownerId || ""), ownerId)) return send(res, 403, { error: "bad_owner_id" });
      t.billingExempt = true;
      t.isOwnerTenant = true;
      await writeTenant(t);
      return send(res, 200, { ok: true });
    }

    // ===== BILLING / LIZENZ (Stripe SEPA-Abo) ================================
    // GET /api/tenants/:id/license – Lizenz-/Trial-Status + Sitzplätze.
    if (parts[0] === "api" && parts[1] === "tenants" && parts[3] === "license" && req.method === "GET") {
      const id = parts[2];
      if (!validId(id)) return send(res, 404, { error: "not_found" });
      const t = await readTenant(id);
      if (!t) return send(res, 404, { error: "not_found" });
      if (!tenantKeyOk(bearer(req), t)) return send(res, 401, { error: "unauthorized" });
      const view = licenseView(t);
      view.seatsUsed = await countTenantUsers(id);
      view.billingAvailable = stripeConfigured();
      return send(res, 200, view);
    }

    // POST /api/tenants/:id/billing/checkout { plan } – Stripe-Checkout-URL (Abo).
    if (parts[0] === "api" && parts[1] === "tenants" && parts[3] === "billing" && parts[4] === "checkout" && req.method === "POST") {
      const id = parts[2];
      if (!validId(id)) return send(res, 404, { error: "not_found" });
      const t = await readTenant(id);
      if (!t) return send(res, 404, { error: "not_found" });
      if (!tenantKeyOk(bearer(req), t)) return send(res, 401, { error: "unauthorized" });
      if (!stripeConfigured()) return send(res, 503, { error: "billing_not_configured" });
      const b = await body(req); if (b.__err) return send(res, 400, { error: b.__err });
      const plan = String(b.plan || "");
      if (!planExists(plan)) return send(res, 400, { error: "bad_plan" });
      const priceId = priceIdForPlan(plan);
      if (!priceId) return send(res, 503, { error: "price_missing", detail: `ENV ${PLANS[plan].priceEnv} fehlt` });
      try {
        const s = await createCheckoutSession({
          tenantId: id, plan, priceId, email: b.email || undefined,
          successUrl: `${PUBLIC_URL}/api/stripe/return?status=success`,
          cancelUrl: `${PUBLIC_URL}/api/stripe/return?status=cancel`,
        });
        return send(res, 200, { url: s.url });
      } catch (e) { return send(res, 502, { error: "stripe_failed", detail: e.message }); }
    }

    // POST /api/tenants/:id/billing/portal – Kundenportal (verwalten/kündigen).
    if (parts[0] === "api" && parts[1] === "tenants" && parts[3] === "billing" && parts[4] === "portal" && req.method === "POST") {
      const id = parts[2];
      if (!validId(id)) return send(res, 404, { error: "not_found" });
      const t = await readTenant(id);
      if (!t) return send(res, 404, { error: "not_found" });
      if (!tenantKeyOk(bearer(req), t)) return send(res, 401, { error: "unauthorized" });
      if (!stripeConfigured()) return send(res, 503, { error: "billing_not_configured" });
      if (!t.stripeCustomerId) return send(res, 409, { error: "no_subscription" });
      try {
        const s = await createPortalSession({ customerId: t.stripeCustomerId, returnUrl: `${PUBLIC_URL}/api/stripe/return?status=portal` });
        return send(res, 200, { url: s.url });
      } catch (e) { return send(res, 502, { error: "stripe_failed", detail: e.message }); }
    }

    // POST /api/tenants/:id/billing/seats { packs } – Sitzplatz-Pakete (je 5) setzen.
    if (parts[0] === "api" && parts[1] === "tenants" && parts[3] === "billing" && parts[4] === "seats" && req.method === "POST") {
      const id = parts[2];
      if (!validId(id)) return send(res, 404, { error: "not_found" });
      const t = await readTenant(id);
      if (!t) return send(res, 404, { error: "not_found" });
      if (!tenantKeyOk(bearer(req), t)) return send(res, 401, { error: "unauthorized" });
      if (!stripeConfigured() || !seatPriceId()) return send(res, 503, { error: "seats_not_configured" });
      if (!t.stripeSubscriptionId) return send(res, 409, { error: "no_subscription" });
      const b = await body(req); if (b.__err) return send(res, 400, { error: b.__err });
      const packs = Math.max(0, Math.min(20, parseInt(b.packs, 10) || 0));
      try {
        await setSeatPacks({ subId: t.stripeSubscriptionId, seatPriceId: seatPriceId(), packs });
        return send(res, 200, { ok: true, packs }); // Sitzplätze werden per Webhook aktualisiert
      } catch (e) { return send(res, 502, { error: "stripe_failed", detail: e.message }); }
    }

    // POST /api/stripe/webhook – Stripe-Events (roh + signiert), aktualisiert die Lizenz.
    if (parts[0] === "api" && parts[1] === "stripe" && parts[2] === "webhook" && req.method === "POST") {
      const raw = await rawBody(req);
      const event = verifyWebhook(raw, req.headers["stripe-signature"]);
      if (!event) return send(res, 400, { error: "bad_signature" });
      const tenantId = event.data?.object?.metadata?.tenantId
        || event.data?.object?.client_reference_id
        || event.data?.object?.subscription_details?.metadata?.tenantId;
      if (tenantId && validId(tenantId)) {
        const t = await readTenant(tenantId);
        if (t && applyStripeEvent(t, event)) await writeTenant(t);
      }
      return send(res, 200, { received: true });
    }

    // GET /api/stripe/return – Rückkehrseite nach Checkout/Portal (HTML).
    if (parts[0] === "api" && parts[1] === "stripe" && parts[2] === "return" && req.method === "GET") {
      const status = url.searchParams.get("status") || "success";
      const ok = status !== "cancel";
      const title = status === "cancel" ? "Vorgang abgebrochen" : status === "portal" ? "Abo aktualisiert" : "Abo aktiv ✓";
      const msg = status === "cancel"
        ? "Es wurde kein Abo abgeschlossen."
        : "Vielen Dank! Du kannst dieses Fenster schließen und zur iou.fm-App zurückkehren.";
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      return res.end(`<!doctype html><html lang="de"><head><meta charset="utf-8"><title>${title}</title>
        <style>body{font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;background:#0f1115;color:#e7e9ee;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0}
        .card{background:#171a21;border:1px solid #262b36;border-radius:14px;padding:32px 36px;max-width:420px;text-align:center}
        h1{font-size:18px;margin:0 0 8px}p{color:#9aa3b2;margin:0;font-size:14px}.ok{color:#C9A24B}.bad{color:#ff6b6b}</style></head>
        <body><div class="card"><h1 class="${ok ? "ok" : "bad"}">${title}</h1><p>${msg}</p></div></body></html>`);
    }

    // GET /api/tenants/:id/feed  – vom Cron gesammelte Shopify-Daten
    if (parts[0] === "api" && parts[1] === "tenants" && parts[3] === "feed" && req.method === "GET") {
      const id = parts[2];
      if (!validId(id)) return send(res, 404, { error: "not_found" });
      const t = await readTenant(id);
      if (!t) return send(res, 404, { error: "not_found" });
      if (!tenantKeyOk(bearer(req), t)) return send(res, 401, { error: "unauthorized" });
      const fd = t.shopifyFeed || { cancellations: [], refunds: [], requests: [], syncedAt: null };
      return send(res, 200, { ...fd, appRefunds: t.appRefunds || [] });
    }

    // POST /api/tenants/:id/sync  – Abgleich jetzt auslösen (Test/manuell)
    if (parts[0] === "api" && parts[1] === "tenants" && parts[3] === "sync" && req.method === "POST") {
      const id = parts[2];
      if (!validId(id)) return send(res, 404, { error: "not_found" });
      const t = await readTenant(id);
      if (!t) return send(res, 404, { error: "not_found" });
      if (!tenantKeyOk(bearer(req), t)) return send(res, 401, { error: "unauthorized" });
      try { return send(res, 200, await syncTenant(t)); }
      catch (e) { return send(res, 502, { error: "shopify_failed", detail: e.message }); }
    }

    // ===== SYNC-TRANSPORT (Dokument) ==========================================
    if (parts[0] === "api" && parts[1] === "tenants" && parts.length === 3 && req.method === "DELETE") {
      const id = parts[2];
      if (!validId(id)) return send(res, 404, { error: "not_found" });
      const t = await readTenant(id);
      if (!t) return send(res, 404, { error: "not_found" });
      if (!tenantKeyOk(bearer(req), t)) return send(res, 401, { error: "unauthorized" });
      await fs.rm(tenantFile(id), { force: true });
      return send(res, 200, { ok: true, deleted: id });
    }

    if (parts[0] === "api" && parts[1] === "tenants" && parts[3] === "doc") {
      const id = parts[2];
      if (!validId(id)) return send(res, 404, { error: "not_found" });
      const t = await readTenant(id);
      if (!t) return send(res, 404, { error: "not_found" });
      if (!tenantKeyOk(bearer(req), t)) return send(res, 401, { error: "unauthorized" });

      if (req.method === "GET") {
        return send(res, 200, { rev: t.rev, payload: t.payload, company: t.company, updatedAt: t.updatedAt });
      }
      if (req.method === "PUT") {
        const b = await body(req);
        if (b.__err) return send(res, b.__err === "too_large" ? 413 : 400, { error: b.__err });
        return await withLock(id, async () => {
          const cur = await readTenant(id);
          if (!cur) return send(res, 404, { error: "not_found" });
          if (typeof b.baseRev !== "number" || b.baseRev !== cur.rev)
            return send(res, 409, { error: "conflict", rev: cur.rev, payload: cur.payload, updatedAt: cur.updatedAt });
          cur.payload = b.payload ?? cur.payload;
          if (typeof b.company === "string") cur.company = b.company.slice(0, 200);
          cur.rev += 1;
          cur.updatedAt = new Date().toISOString();
          await writeTenant(cur);
          return send(res, 200, { rev: cur.rev, updatedAt: cur.updatedAt });
        });
      }
      return send(res, 405, { error: "method_not_allowed" });
    }

    // ===== SUPPORT-ZUGANG =====================================================
    // Vendor-Seite (Bearer = SUPPORT_KEY)
    if (parts[0] === "api" && parts[1] === "support" && parts[2] === "pubkey") {
      if (req.method === "GET") { // öffentlich: Kunden brauchen den Public-Key zum Verschlüsseln
        const s = await readJson(SUPPORT_FILE);
        return send(res, 200, { pubKeyJwk: s?.pubKeyJwk || null });
      }
      if (req.method === "PUT") {
        if (!supportAuth(req)) return send(res, 401, { error: "unauthorized" });
        const b = await body(req); if (b.__err) return send(res, 400, { error: b.__err });
        if (!b.pubKeyJwk) return send(res, 400, { error: "missing_pubkey" });
        await writeJson(SUPPORT_FILE, { pubKeyJwk: b.pubKeyJwk, updatedAt: new Date().toISOString() });
        return send(res, 200, { ok: true });
      }
      return send(res, 405, { error: "method_not_allowed" });
    }

    // Vendor stellt Zugriffsanfrage an einen Mandanten
    if (parts[0] === "api" && parts[1] === "support" && parts[2] === "request" && req.method === "POST") {
      if (!supportAuth(req)) return send(res, 401, { error: "unauthorized" });
      const b = await body(req); if (b.__err) return send(res, 400, { error: b.__err });
      if (!validId(b.tenantId)) return send(res, 400, { error: "bad_tenant" });
      const t = await readTenant(b.tenantId);
      if (!t) return send(res, 404, { error: "tenant_not_found" });
      const reqId = newId();
      t.supportRequests = (t.supportRequests || []).filter((r) => r.status === "pending" ? notExpired(r) : false);
      t.supportRequests.push({
        id: reqId, scope: b.scope === "read" ? "read" : "full",
        note: String(b.note || "").slice(0, 200),
        expiresAt: b.expiresAt || null, createdAt: new Date().toISOString(), status: "pending",
      });
      await writeTenant(t);
      return send(res, 201, { requestId: reqId });
    }

    // Vendor listet aktive Grants (über alle Mandanten)
    if (parts[0] === "api" && parts[1] === "support" && parts[2] === "grants" && req.method === "GET") {
      if (!supportAuth(req)) return send(res, 401, { error: "unauthorized" });
      let files = [];
      try { files = (await fs.readdir(TENANT_DIR)).filter((f) => f.endsWith(".json")); } catch {}
      const grants = [];
      for (const f of files) {
        const t = await readJson(path.join(TENANT_DIR, f));
        for (const g of (t?.supportGrants || [])) {
          if (g.status === "granted" && notExpired(g)) {
            grants.push({ tenantId: t.tenantId, company: t.company || "", accessKey: t.accessKey,
              grantId: g.id, scope: g.scope, wrappedDek: g.wrappedDek, expiresAt: g.expiresAt });
          }
        }
      }
      return send(res, 200, { grants });
    }

    // Kunden-Seite (Bearer = Mandanten-accessKey): Anfragen sehen / freigeben / widerrufen
    if (parts[0] === "api" && parts[1] === "tenants" && parts[3] === "support-requests" && req.method === "GET") {
      const t = await readTenant(parts[2]);
      if (!t) return send(res, 404, { error: "not_found" });
      if (!tenantKeyOk(bearer(req), t)) return send(res, 401, { error: "unauthorized" });
      const pending = (t.supportRequests || []).filter((r) => r.status === "pending" && notExpired(r));
      const active = (t.supportGrants || []).filter((g) => g.status === "granted" && notExpired(g))
        .map((g) => ({ grantId: g.id, scope: g.scope, expiresAt: g.expiresAt, grantedAt: g.grantedAt }));
      return send(res, 200, { requests: pending, grants: active });
    }
    if (parts[0] === "api" && parts[1] === "tenants" && parts[3] === "support-grant" && req.method === "POST") {
      const t = await readTenant(parts[2]);
      if (!t) return send(res, 404, { error: "not_found" });
      if (!tenantKeyOk(bearer(req), t)) return send(res, 401, { error: "unauthorized" });
      const b = await body(req); if (b.__err) return send(res, 400, { error: b.__err });
      const reqRec = (t.supportRequests || []).find((r) => r.id === b.requestId && r.status === "pending");
      if (!reqRec) return send(res, 404, { error: "request_not_found" });
      if (!b.wrappedDek) return send(res, 400, { error: "missing_wrapped" });
      reqRec.status = "granted";
      t.supportGrants = (t.supportGrants || []);
      t.supportGrants.push({
        id: newId(), requestId: reqRec.id, scope: reqRec.scope, wrappedDek: b.wrappedDek,
        expiresAt: b.expiresAt || reqRec.expiresAt || null, grantedAt: new Date().toISOString(), status: "granted",
      });
      await writeTenant(t);
      return send(res, 200, { ok: true });
    }
    if (parts[0] === "api" && parts[1] === "tenants" && parts[3] === "support-revoke" && req.method === "POST") {
      const t = await readTenant(parts[2]);
      if (!t) return send(res, 404, { error: "not_found" });
      if (!tenantKeyOk(bearer(req), t)) return send(res, 401, { error: "unauthorized" });
      const b = await body(req); if (b.__err) return send(res, 400, { error: b.__err });
      t.supportGrants = (t.supportGrants || []).map((g) =>
        (!b.grantId || g.id === b.grantId) ? { ...g, status: "revoked" } : g);
      await writeTenant(t);
      return send(res, 200, { ok: true });
    }

    // ===== APP-ERSTATTUNGEN (SEPA) für den Buchhalter-Export ===================
    // Nicht-sensible Zusammenfassung (KEINE IBAN) der in iou.fm getätigten
    // Erstattungen – für USt-Korrektur. Wird beim Speichern eines Erstattungs-Batches gepusht.
    if (parts[0] === "api" && parts[1] === "tenants" && parts[3] === "app-refunds") {
      const t = await readTenant(parts[2]);
      if (!t) return send(res, 404, { error: "not_found" });
      if (!tenantKeyOk(bearer(req), t)) return send(res, 401, { error: "unauthorized" });
      if (req.method === "POST") {
        const b = await body(req); if (b.__err) return send(res, 400, { error: b.__err });
        const incoming = Array.isArray(b.refunds) ? b.refunds : [];
        const clean = incoming.map((r) => ({
          orderNumber: String(r.orderNumber || "").slice(0, 40),
          customer: String(r.customer || "").slice(0, 120),
          event: String(r.event || "").slice(0, 160),
          category: String(r.category || "").slice(0, 40),
          amountCents: Math.round(Number(r.amountCents) || 0),
          paidCents: Math.round(Number(r.paidCents) || 0),
          purpose: String(r.purpose || "").slice(0, 200),
          date: String(r.date || "").slice(0, 30),
          currency: String(r.currency || "EUR").slice(0, 8),
        })).filter((r) => r.amountCents > 0);
        const key = (r) => `${r.orderNumber}|${r.date}|${r.amountCents}`;
        const seen = new Set((t.appRefunds || []).map(key));
        t.appRefunds = [...(t.appRefunds || [])];
        for (const r of clean) { if (!seen.has(key(r))) { seen.add(key(r)); t.appRefunds.push(r); } }
        await writeTenant(t);
        return send(res, 200, { ok: true, total: t.appRefunds.length });
      }
      if (req.method === "GET") return send(res, 200, { refunds: t.appRefunds || [] });
      return send(res, 405, { error: "method_not_allowed" });
    }

    // ===== BUCHHALTER-VERSAND (monatlich) =====================================
    if (parts[0] === "api" && parts[1] === "tenants" && parts[3] === "accountant") {
      const t = await readTenant(parts[2]);
      if (!t) return send(res, 404, { error: "not_found" });
      if (!tenantKeyOk(bearer(req), t)) return send(res, 401, { error: "unauthorized" });

      // POST /api/tenants/:id/accountant/send-now – jetzt testweise senden
      if (parts[4] === "send-now" && req.method === "POST") {
        const b = await body(req); const ym = (b && b.month) || thisMonthKey();
        if (!RESEND_API_KEY) return send(res, 400, { error: "no_resend_key" });
        try { return send(res, 200, await sendAccountantFor(t, ym)); }
        catch (e) { return send(res, 502, { error: "send_failed", detail: e.message }); }
      }
      if (req.method === "GET") {
        const a = t.accountant || {};
        return send(res, 200, { email: a.email || "", cc: a.cc || "", enabled: !!a.enabled,
          lastSentMonth: a.lastSentMonth || null, lastSentAt: a.lastSentAt || null, mailReady: !!RESEND_API_KEY });
      }
      if (req.method === "PUT") {
        const b = await body(req); if (b.__err) return send(res, 400, { error: b.__err });
        t.accountant = {
          ...(t.accountant || {}),
          email: String(b.email || "").trim().slice(0, 200),
          cc: String(b.cc || "").trim().slice(0, 200),
          enabled: !!b.enabled,
        };
        await writeTenant(t);
        return send(res, 200, { ok: true });
      }
      return send(res, 405, { error: "method_not_allowed" });
    }

    return send(res, 404, { error: "not_found" });
  } catch (e) {
    return send(res, 500, { error: "server_error" });
  }
});

await fs.mkdir(TENANT_DIR, { recursive: true });
await fs.mkdir(USER_DIR, { recursive: true });
server.listen(PORT, () => {
  console.log(`iou.fm sync-hub on :${PORT}  (data: ${DATA_DIR}, TZ: ${process.env.TZ || "system"})`);
  scheduleNightly();
  scheduleMonthlyMail();
});

export { server };
