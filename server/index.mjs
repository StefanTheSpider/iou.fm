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
import { buildAccountantCsv, thisMonthKey, prevMonthKey, isLastDayOfMonth, sendViaResend, sendAttachmentsViaResend } from "./accountant.mjs";
import { oauthConfigured, normalizeShop, buildAuthUrl, verifyState, verifyShopifyHmac, exchangeToken } from "./shopify-oauth.mjs";
import { TRIAL_DAYS, PLANS, planExists, priceIdForPlan, planForPriceId, seatPriceId, licenseView, applyStripeEvent, billingEnforced } from "./billing.mjs";
import { inboxAddress, newInboxToken, tokenFromAddress, sha256Hex, safeName } from "./inbound.mjs";
import { parseEmail } from "./mime.mjs";
import { emailToPdf } from "./emailpdf.mjs";
const INBOUND_SECRET = process.env.INBOUND_SECRET || "";
import { stripeConfigured, createCheckoutSession, createPortalSession, setSeatPacks, verifyWebhook, updateCustomer, listSubscriptionsForOwner } from "./stripe.mjs";

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
// Versand-Domain (muss in Resend verifiziert sein). Aus RESEND_FROM abgeleitet, per ENV überschreibbar.
const RESEND_FROM_EMAIL = (/<([^>]+)>/.exec(RESEND_FROM)?.[1] || RESEND_FROM || "").trim();
const SEND_DOMAIN = process.env.SEND_DOMAIN || (RESEND_FROM_EMAIL.split("@")[1] || "iou.fm");
// Pro-Mandant eindeutige Absenderadresse – verhindert Cross-Tenant-Versand an fremde DATEV-Postfächer.
// (Jeder Mandant gibt nur SEINE Adresse in DATEV frei; fremde Absender werden abgelehnt.)
const tenantSenderAddress = (t) => `belege-${t.senderToken}@${SEND_DOMAIN}`;
const tenantFromHeader = (t) => {
  const name = String(t.company || "iou.fm").replace(/[<>"\r\n]/g, "").slice(0, 60) || "iou.fm";
  return `${name} <${tenantSenderAddress(t)}>`;
};
async function sendAccountantFor(t, ym) {
  const a = t.accountant || {};
  if (!a.enabled || !a.email) return { skipped: true, reason: "not_configured" };
  if (!RESEND_API_KEY) return { skipped: true, reason: "no_resend_key" };
  const csv = buildAccountantCsv(t.shopifyFeed || {}, ym, t.appRefunds || []);
  // WICHTIG: über die verifizierte Versand-Domain senden (SEND_DOMAIN, z. B. iou-tech.com).
  // Nicht RESEND_FROM verwenden – das zeigt evtl. noch auf eine alte, nicht mehr in Resend
  // verifizierte Domain (z. B. fork-and-merge.com) und führt zu „domain is not verified" (403).
  if (!t.senderToken) t.senderToken = newInboxToken();
  await sendViaResend({
    apiKey: RESEND_API_KEY, from: tenantFromHeader(t), to: a.email, cc: a.cc || null,
    subject: `Stornos & Erstattungen ${ym} – ${t.company || "iou.fm"}`,
    text: `Anbei die Stornierungen und Rückerstattungen für ${ym}.\n\nAutomatisch erstellt von iou.fm.`,
    filename: `Stornos_Erstattungen_${ym}.csv`, csv,
  });
  t.accountant.lastSentMonth = ym;
  t.accountant.lastSentAt = new Date().toISOString();
  await writeTenant(t);
  return { ok: true, month: ym, to: a.email };
}
// Versendet für jeden Tenant den zuletzt ABGESCHLOSSENEN Monat (Vormonat), sofern noch
// nicht geschehen. lastSentMonth verhindert Doppelversand. Dadurch wird ein am Monatsende
// verpasster Versand (Server-Neustart/Ausfall) beim nächsten Lauf automatisch NACHGEHOLT.
async function runAccountantCatchup() {
  let files = [];
  try { files = (await fs.readdir(TENANT_DIR)).filter((f) => f.endsWith(".json")); } catch { return; }
  const target = prevMonthKey();
  for (const f of files) {
    const t = await readJson(path.join(TENANT_DIR, f));
    if (t?.accountant?.enabled && t.accountant.lastSentMonth !== target) {
      try { await sendAccountantFor(t, target); } catch (e) { console.warn("Buchhaltungs-Mail fehlgeschlagen", t.tenantId, e.message); }
    }
  }
}
function scheduleMonthlyMail() {
  // Robust statt „nur am letzten Tag um 23:59": beim Start (Nachhol-Prüfung nach Neustart)
  // UND danach täglich. Der Report kommt Anfang des Folgemonats – der Monat ist dann komplett.
  const DAY = 24 * 60 * 60 * 1000;
  const run = () => runAccountantCatchup().catch((e) => console.warn("Buchhaltungs-Mail-Tick:", e.message));
  setTimeout(run, 30 * 1000); // kurz nach dem Start
  setInterval(run, DAY);      // danach täglich
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
// Zentral gegen ungültige/böswillige IDs absichern (Pfad-Sicherheit) – schützt ALLE Routen,
// auch die, die vor readTenant kein eigenes validId() hatten.
const readTenant = (id) => (validId(id) ? readJson(tenantFile(id)) : Promise.resolve(null));
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
// MIME-Typ aus Dateiendung (für die Beleg-Auslieferung).
const belegMime = (n) =>
  /\.pdf$/i.test(n) ? "application/pdf"
  : /\.eml$/i.test(n) ? "message/rfc822"
  : /\.png$/i.test(n) ? "image/png"
  : /\.jpe?g$/i.test(n) ? "image/jpeg"
  : /\.tiff?$/i.test(n) ? "image/tiff"
  : /\.gif$/i.test(n) ? "image/gif"
  : "application/octet-stream";
// Rohe Bytes ausliefern (Beleg-Datei zum Ansehen/Download).
function sendRaw(res, code, buf, contentType, filename) {
  res.writeHead(code, {
    "Content-Type": contentType || "application/octet-stream",
    "Content-Disposition": `inline; filename="${String(filename || "datei").replace(/["\r\n]/g, "")}"`,
    "Content-Length": buf.length,
    "Access-Control-Allow-Origin": ORIGIN,
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Cache-Control": "no-store",
  });
  res.end(buf);
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

// Mandant anhand seines Inbox-Tokens finden (für eingehende Belege-Mails).
// Findet den Mandanten zu einem Belege-Token. `kind` zeigt an, ob die Mail an die
// Empfangs-Adresse (inbox.token) oder an die Absender-Adresse (senderToken) ging –
// Letzteres nutzen wir, um z. B. die DATEV-Absenderbestätigung abzufangen.
async function findTenantByInboxToken(token) {
  if (!token) return null;
  let files = [];
  try { files = (await fs.readdir(TENANT_DIR)).filter((f) => f.endsWith(".json")); } catch { return null; }
  for (const f of files) {
    const t = await readJson(path.join(TENANT_DIR, f));
    if (!t) continue;
    if (t.inbox && t.inbox.token === token) return { t, kind: "inbox" };
    if (t.senderToken && t.senderToken === token) return { t, kind: "sender" };
  }
  return null;
}

// Ersten Bestätigungs-/DATEV-Link aus einer Roh-Mail ziehen (für die Absender-Freigabe in
// DATEV Unternehmen online). Quoted-Printable wird grob aufgelöst, damit lange URLs heil bleiben.
function extractConfirmLink(rawText) {
  if (!rawText) return "";
  const unqp = String(rawText)
    .replace(/=\r?\n/g, "")
    .replace(/=3D/gi, "=")
    .replace(/&amp;/g, "&");
  const urls = unqp.match(/https?:\/\/[^\s"'<>\)]+/gi) || [];
  // bevorzugt DATEV-Domains / Bestätigungs-URLs
  const pick = urls.find((u) => /datev\.de|datev\.com|best[aä]tig|confirm|verify|freigabe|absender/i.test(u))
    || urls.find((u) => /datev/i.test(u));
  return (pick || "").slice(0, 1000);
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
      // Den LETZTEN Admin nicht löschen – sonst bleibt der Mandant ohne Verwaltung.
      if (target.role === "admin") {
        let admins = 0;
        try {
          for (const f of await fs.readdir(USER_DIR)) {
            const u = await readJson(path.join(USER_DIR, f));
            if (u && u.tenantId === admin.tenantId && u.role === "admin") admins++;
          }
        } catch { admins = 2; /* im Fehlerfall lieber nicht blockieren */ }
        if (admins <= 1) return send(res, 400, { error: "last_admin" });
      }
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

    // POST /api/tenants/:id/invoices/send-belege – Rechnungs-PDFs an Steuerberater/DATEV mailen.
    if (parts[0] === "api" && parts[1] === "tenants" && parts[3] === "invoices" && parts[4] === "send-belege" && req.method === "POST") {
      const id = parts[2];
      if (!validId(id)) return send(res, 404, { error: "not_found" });
      const t = await readTenant(id);
      if (!t) return send(res, 404, { error: "not_found" });
      if (!tenantKeyOk(bearer(req), t)) return send(res, 401, { error: "unauthorized" });
      if (!RESEND_API_KEY) return send(res, 503, { error: "mail_not_configured" });
      const b = await body(req); if (b.__err) return send(res, 400, { error: b.__err });
      // Sicherheit: Empfänger NUR aus der serverseitigen Belege-Config (Steuerberater).
      // Kein vom Client gesetztes `to` zulassen (sonst Versand an Fremdadressen über die
      // verifizierte Tenant-Domain möglich). DATEV-Direktversand vorerst deaktiviert.
      const to = [t.inbox?.belegEmail].map((x) => String(x || "").trim()).filter(Boolean);
      const files = (Array.isArray(b.files) ? b.files : [])
        .filter((f) => f && f.filename && f.content)
        .slice(0, 50)
        .map((f) => ({ filename: String(f.filename).slice(0, 120), content: String(f.content) }));
      if (!to.length) return send(res, 400, { error: "no_recipient" });
      if (!files.length) return send(res, 400, { error: "no_files" });
      if (!t.senderToken) { t.senderToken = newInboxToken(); await writeTenant(t); } // eindeutige Absenderadresse
      try {
        await sendAttachmentsViaResend({
          apiKey: RESEND_API_KEY, from: tenantFromHeader(t), to,
          subject: String(b.subject || `Rechnungsbelege – ${t.company || "iou.fm"}`),
          text: String(b.text || `Anbei ${files.length} Rechnungsbeleg(e).\n\nAutomatisch gesendet von iou.fm.`),
          attachments: files,
        });
        return send(res, 200, { ok: true, sent: files.length, to });
      } catch (e) { return send(res, 502, { error: "mail_failed", detail: e.message }); }
    }

    // POST /api/tenants/:id/rechnung-belege/:batchId – Rechnungs-PDFs eines SEPA-Laufs ablegen
    // (dauerhaft, damit man sie später erneut an DATEV senden kann – auch geräteübergreifend).
    if (parts[0] === "api" && parts[1] === "tenants" && parts[3] === "rechnung-belege" && parts[4] && parts.length === 5 && req.method === "POST") {
      const id = parts[2]; const batchId = parts[4];
      if (!validId(id) || !validId(batchId)) return send(res, 404, { error: "not_found" });
      const t = await readTenant(id);
      if (!t) return send(res, 404, { error: "not_found" });
      if (!tenantKeyOk(bearer(req), t)) return send(res, 401, { error: "unauthorized" });
      const b = await body(req); if (b.__err) return send(res, 400, { error: b.__err });
      const files = (Array.isArray(b.files) ? b.files : []).filter((f) => f && f.filename && f.content).slice(0, 50);
      if (!files.length) return send(res, 400, { error: "no_files" });
      const dir = path.join(DATA_DIR, "rechnungsbelege", id, batchId);
      await fs.mkdir(dir, { recursive: true });
      let saved = 0;
      for (const f of files) {
        try { await fs.writeFile(path.join(dir, safeName(f.filename)), Buffer.from(String(f.content), "base64")); saved++; } catch { /* egal */ }
      }
      return send(res, 200, { ok: true, saved });
    }

    // POST /api/tenants/:id/rechnung-belege/:batchId/send – abgelegte Rechnungs-Belege an Steuerberater/DATEV senden.
    if (parts[0] === "api" && parts[1] === "tenants" && parts[3] === "rechnung-belege" && parts[4] && parts[5] === "send" && req.method === "POST") {
      const id = parts[2]; const batchId = parts[4];
      if (!validId(id) || !validId(batchId)) return send(res, 404, { error: "not_found" });
      const t = await readTenant(id);
      if (!t) return send(res, 404, { error: "not_found" });
      if (!tenantKeyOk(bearer(req), t)) return send(res, 401, { error: "unauthorized" });
      if (!RESEND_API_KEY) return send(res, 503, { error: "mail_not_configured" });
      const to = [t.inbox?.belegEmail].map((x) => String(x || "").trim()).filter(Boolean); // DATEV vorerst aus
      if (!to.length) return send(res, 400, { error: "no_recipient" });
      const dir = path.join(DATA_DIR, "rechnungsbelege", id, batchId);
      let names = [];
      try { names = await fs.readdir(dir); } catch { /* keine Ablage */ }
      if (!names.length) return send(res, 400, { error: "no_files" });
      const attachments = [];
      for (const n of names) {
        try { const buf = await fs.readFile(path.join(dir, n)); attachments.push({ filename: n, content: buf.toString("base64") }); } catch { /* egal */ }
      }
      if (!t.senderToken) { t.senderToken = newInboxToken(); await writeTenant(t); }
      try {
        await sendAttachmentsViaResend({
          apiKey: RESEND_API_KEY, from: tenantFromHeader(t), to,
          subject: `Rechnungsbelege – ${t.company || "iou.fm"}`,
          text: `Anbei ${attachments.length} Rechnungsbeleg(e) aus iou.fm.`,
          attachments,
        });
        return send(res, 200, { ok: true, sent: attachments.length, to });
      } catch (e) { return send(res, 502, { error: "mail_failed", detail: e.message }); }
    }

    // ===== BELEGE PER E-MAIL (Inbox + Archiv + Weiterleitung) ================
    // GET /api/tenants/:id/inbox – Weiterleitungs-Adresse + Forward-Konfig (erzeugt Token).
    if (parts[0] === "api" && parts[1] === "tenants" && parts[3] === "inbox" && req.method === "GET") {
      const id = parts[2];
      if (!validId(id)) return send(res, 404, { error: "not_found" });
      const t = await readTenant(id);
      if (!t) return send(res, 404, { error: "not_found" });
      if (!tenantKeyOk(bearer(req), t)) return send(res, 401, { error: "unauthorized" });
      t.inbox = t.inbox || {};
      let chg = false;
      if (!t.inbox.token) { t.inbox.token = newInboxToken(); chg = true; }
      if (!t.senderToken) { t.senderToken = newInboxToken(); chg = true; } // eindeutige Absenderadresse
      if (chg) await writeTenant(t);
      return send(res, 200, {
        address: inboxAddress(t.inbox.token),
        autoForward: !!t.inbox.autoForward,
        datevEmail: t.inbox.datevEmail || "",
        belegEmail: t.inbox.belegEmail || "",
        count: (t.belege || []).length,
        available: !!INBOUND_SECRET,
        // Pro-Mandant eindeutige Absenderadresse – diese (und nur diese) in DATEV als
        // freigegebenen Absender hinterlegen. Verhindert Versand an fremde DATEV-Postfächer.
        senderEmail: tenantSenderAddress(t),
        // Von DATEV an die Absenderadresse geschickte Absender-Bestätigung (Link zum Freigeben).
        datevConfirmLink: t.datevConfirm?.link || "",
        datevConfirmAt: t.datevConfirm?.receivedAt || null,
        // DATEV-Rückmeldungen (Erfolg/Fehler) zu gesendeten Belegen – neueste zuerst.
        datevNotices: (t.datevNotices || []).slice(0, 10),
      });
    }

    // PUT /api/tenants/:id/inbox – Weiterleitungs-Ziele setzen.
    if (parts[0] === "api" && parts[1] === "tenants" && parts[3] === "inbox" && req.method === "PUT") {
      const id = parts[2];
      if (!validId(id)) return send(res, 404, { error: "not_found" });
      const t = await readTenant(id);
      if (!t) return send(res, 404, { error: "not_found" });
      if (!tenantKeyOk(bearer(req), t)) return send(res, 401, { error: "unauthorized" });
      const b = await body(req); if (b.__err) return send(res, 400, { error: b.__err });
      t.inbox = t.inbox || {};
      if (!t.inbox.token) t.inbox.token = newInboxToken();
      // DATEV-Bestätigungshinweis ausblenden (erledigt) – ohne andere Felder zu verändern.
      if (b.clearDatevConfirm) { delete t.datevConfirm; await writeTenant(t); return send(res, 200, { ok: true, cleared: true }); }
      if (b.clearDatevNotices) { delete t.datevNotices; await writeTenant(t); return send(res, 200, { ok: true, cleared: true }); }
      t.inbox.autoForward = !!b.autoForward;
      t.inbox.datevEmail = String(b.datevEmail || "").trim().slice(0, 200);
      t.inbox.belegEmail = String(b.belegEmail || "").trim().slice(0, 200);
      await writeTenant(t);
      return send(res, 200, { ok: true });
    }

    // GET /api/tenants/:id/belege – revisionssicheres Beleg-Archiv (Metadaten).
    if (parts[0] === "api" && parts[1] === "tenants" && parts[3] === "belege" && parts.length === 4 && req.method === "GET") {
      const id = parts[2];
      if (!validId(id)) return send(res, 404, { error: "not_found" });
      const t = await readTenant(id);
      if (!t) return send(res, 404, { error: "not_found" });
      if (!tenantKeyOk(bearer(req), t)) return send(res, 401, { error: "unauthorized" });
      return send(res, 200, { belege: t.belege || [] });
    }

    // GET /api/tenants/:id/belege/:beId/files – abgelegte Dateien eines Belegs (Original-.eml, PDF, Anhänge).
    if (parts[0] === "api" && parts[1] === "tenants" && parts[3] === "belege" && parts[5] === "files" && req.method === "GET") {
      const id = parts[2]; const beId = parts[4];
      if (!validId(id) || !validId(beId)) return send(res, 404, { error: "not_found" });
      const t = await readTenant(id);
      if (!t) return send(res, 404, { error: "not_found" });
      if (!tenantKeyOk(bearer(req), t)) return send(res, 401, { error: "unauthorized" });
      const dir = path.join(DATA_DIR, "belege", id);
      let names = [];
      try { names = (await fs.readdir(dir)).filter((n) => n === beId + ".eml" || n.startsWith(beId + "_")); } catch { /* leer */ }
      const files = [];
      for (const n of names) {
        try { const st = await fs.stat(path.join(dir, n)); files.push({ name: n, size: st.size, type: belegMime(n) }); } catch { /* egal */ }
      }
      // Sortierung: PDF zuerst (am besten ansehbar), dann Original-.eml, dann Rest.
      files.sort((a, b) => (b.type === "application/pdf") - (a.type === "application/pdf") || a.name.localeCompare(b.name));
      return send(res, 200, { files });
    }

    // GET /api/tenants/:id/belege/:beId/file/:name – eine abgelegte Beleg-Datei ausliefern.
    if (parts[0] === "api" && parts[1] === "tenants" && parts[3] === "belege" && parts[5] === "file" && req.method === "GET") {
      const id = parts[2]; const beId = parts[4];
      let name; try { name = decodeURIComponent(parts[6] || ""); } catch { return send(res, 400, { error: "bad_name" }); }
      if (!validId(id) || !validId(beId)) return send(res, 404, { error: "not_found" });
      const t = await readTenant(id);
      if (!t) return send(res, 404, { error: "not_found" });
      if (!tenantKeyOk(bearer(req), t)) return send(res, 401, { error: "unauthorized" });
      // Pfad-Sicherheit: Name muss zum Beleg gehören, keine Traversal-Zeichen.
      if (name.includes("/") || name.includes("\\") || name.includes("..") || !(name === beId + ".eml" || name.startsWith(beId + "_"))) {
        return send(res, 404, { error: "not_found" });
      }
      let buf;
      try { buf = await fs.readFile(path.join(DATA_DIR, "belege", id, name)); } catch { return send(res, 404, { error: "not_found" }); }
      return sendRaw(res, 200, buf, belegMime(name), name);
    }

    // POST /api/inbound-email – eingehende Beleg-Mail (Postmark-Inbound ODER eigenes Format).
    // Auth: Header x-inbound-secret ODER Query ?key=… (Postmark-Webhook-URL).
    if (parts[0] === "api" && parts[1] === "inbound-email" && req.method === "POST") {
      const provided = req.headers["x-inbound-secret"] || url.searchParams.get("key") || "";
      if (!INBOUND_SECRET || provided !== INBOUND_SECRET) return send(res, 401, { error: "unauthorized" });
      const b = await body(req); if (b.__err) return send(res, 400, { error: b.__err });
      // Felder normalisieren (eigenes Format, Postmark-JSON ODER Cloudflare-Worker mit roher Mail).
      const toAddr = b.to || b.OriginalRecipient || b.To || "";
      let fromAddr = b.from || b.From || "";
      let subject = b.subject || b.Subject || "";
      let date = b.date || b.Date || null;
      let rawB64 = b.raw || "";
      if (!rawB64 && b.RawEmail) rawB64 = Buffer.from(String(b.RawEmail), "utf8").toString("base64");
      const rawAtts = Array.isArray(b.attachments) ? b.attachments : (Array.isArray(b.Attachments) ? b.Attachments : []);
      let atts = rawAtts
        .map((a) => ({ filename: a.filename || a.Name, content: a.content || a.Content }))
        .filter((a) => a.filename && a.content).slice(0, 50);

      const token = tokenFromAddress(toAddr);
      const found = await findTenantByInboxToken(token);
      // Unbekannte/Test-Adresse: mit 200 quittieren (kein Retry), aber nichts speichern.
      if (!found) return send(res, 200, { ok: false, ignored: "unknown_inbox" });
      const t = found.t;
      const rawBufEarly = Buffer.from(String(rawB64 || ""), "base64");
      if ((!fromAddr || !subject) && rawBufEarly.length) {
        try { const pe0 = parseEmail(rawBufEarly.toString("utf8")); fromAddr = fromAddr || pe0.from; subject = subject || pe0.subject; date = date || pe0.date; } catch { /* egal */ }
      }
      // Mail an die iou.fm-ABSENDER-Adresse → i. d. R. die DATEV-Absenderbestätigung.
      // Link kapern, dem Mandanten zur Bestätigung anzeigen; nicht ins Beleg-Archiv, keine Weiterleitung.
      if (found.kind === "sender") {
        const rawStr = rawBufEarly.length ? rawBufEarly.toString("utf8") : "";
        const link = rawStr ? extractConfirmLink(rawStr) : "";
        let bodyText = "";
        try { bodyText = parseEmail(rawStr).text || ""; } catch { /* egal */ }
        const subj = String(subject || "").slice(0, 300);
        const hay = (subj + " " + bodyText).toLowerCase();
        const isError = /(fehler|konnte nicht|nicht verarbeit|abgelehnt|ungültig|ungueltig|error|fehlgeschlagen|zurückgewiesen|zurueckgewiesen|nicht hochgeladen|abgewiesen)/.test(hay);
        // Freigabe-Bestätigung (mit Link) → grüner „freigeben"-Hinweis.
        if (link) t.datevConfirm = { link, from: String(fromAddr || "").slice(0, 200), subject: subj, receivedAt: new Date().toISOString() };
        // ALLE DATEV-Rückmeldungen sammeln (Erfolg/Fehler) – für die Anzeige in der App.
        t.datevNotices = t.datevNotices || [];
        t.datevNotices.unshift({
          subject: subj, from: String(fromAddr || "").slice(0, 200),
          receivedAt: new Date().toISOString(),
          text: bodyText.replace(/\s+/g, " ").trim().slice(0, 500),
          isError, hasLink: !!link,
        });
        t.datevNotices = t.datevNotices.slice(0, 30);
        try {
          const ddir = path.join(DATA_DIR, "belege", t.tenantId); await fs.mkdir(ddir, { recursive: true });
          if (rawBufEarly.length) await fs.writeFile(path.join(ddir, "datev_" + newId() + ".eml"), rawBufEarly, { flag: "wx" });
        } catch { /* egal */ }
        await writeTenant(t);
        return send(res, 200, { ok: true, datevConfirm: !!link, notice: true });
      }
      const dir = path.join(DATA_DIR, "belege", t.tenantId);
      await fs.mkdir(dir, { recursive: true });
      const beId = newId();
      const rawBuf = Buffer.from(String(rawB64 || ""), "base64");
      // Roh-Mail parsen: Anhänge + Betreff/Absender + lesbarer Text-Inhalt (für Body-PDF).
      let bodyText = "";
      if (rawBuf.length) {
        try {
          const pe = parseEmail(rawBuf.toString("utf8"));
          if (!atts.length && pe.attachments?.length) atts = pe.attachments.slice(0, 50);
          if (!fromAddr) fromAddr = pe.from;
          if (!subject) subject = pe.subject;
          if (!date) date = pe.date;
          bodyText = pe.text || "";
        } catch { /* Roh-Mail bleibt als Nachweis erhalten */ }
      }
      const sha = sha256Hex(rawBuf.length ? rawBuf : Buffer.from(String(subject || "") + (date || "")));
      // 1) Original-Mail revisionssicher ablegen (write-once) – unveränderbarer GoBD-Nachweis.
      try { if (rawBuf.length) await fs.writeFile(path.join(dir, beId + ".eml"), rawBuf, { flag: "wx" }); } catch { /* write-once */ }

      // 2) Anhänge ablegen; PDFs (= direkt ablegbare Belege) und Bilder separat merken.
      const attNames = [];
      const pdfAttFiles = [];
      const imgAttFiles = [];
      for (const a of atts) {
        const fn = beId + "_" + safeName(a.filename);
        try { await fs.writeFile(path.join(dir, fn), Buffer.from(String(a.content), "base64"), { flag: "wx" }); attNames.push(a.filename); } catch { /* egal */ }
        if (/\.pdf$/i.test(a.filename || "")) pdfAttFiles.push({ filename: safeName(a.filename), content: String(a.content) });
        else if (/\.(png|jpe?g|gif|webp|tiff?)$/i.test(a.filename || "")) imgAttFiles.push({ filename: safeName(a.filename), content: String(a.content) });
      }

      // 3) Kein PDF-Anhang? → E-Mail-INHALT (z. B. Bestellbestätigung im Text mit Artikelliste)
      //    als PDF-Beleg rendern, revisionssicher ablegen und genau dieses PDF weiterleiten.
      let bodyPdfFile = null;
      if (!pdfAttFiles.length) {
        try {
          const pdfBuf = emailToPdf({ subject, from: fromAddr, to: toAddr, date: date || new Date().toISOString(), text: bodyText });
          try { await fs.writeFile(path.join(dir, beId + "_beleg.pdf"), pdfBuf, { flag: "wx" }); } catch { /* write-once */ }
          bodyPdfFile = { filename: "Beleg_" + beId.slice(0, 8) + ".pdf", content: pdfBuf.toString("base64") };
          attNames.push(bodyPdfFile.filename);
        } catch { /* Fallback: .eml bleibt als Nachweis */ }
      }

      t.belege = t.belege || [];
      t.belege.unshift({ id: beId, from: String(fromAddr || "").slice(0, 200), subject: String(subject || "").slice(0, 300), date: date || null, receivedAt: new Date().toISOString(), sha256: sha, attachments: attNames });
      t.belege = t.belege.slice(0, 1000);
      if (!t.senderToken) t.senderToken = newInboxToken(); // eindeutige Absenderadresse
      await writeTenant(t);

      // Auto-Weiterleitung an DATEV/Steuerberater: PDF-Anhänge bevorzugt, sonst das gerenderte
      // Body-PDF (+ etwaige Bild-Anhänge). Nur als letzter Fallback die .eml.
      let forwarded = false;
      if (t.inbox?.autoForward && RESEND_API_KEY) {
        const to = [t.inbox.belegEmail].map((x) => String(x || "").trim()).filter(Boolean); // DATEV vorerst aus
        const files = pdfAttFiles.length
          ? [...pdfAttFiles, ...imgAttFiles]
          : (bodyPdfFile ? [bodyPdfFile, ...imgAttFiles] : (rawBuf.length ? [{ filename: beId + ".eml", content: rawB64 }] : []));
        if (to.length && files.length) {
          try {
            await sendAttachmentsViaResend({ apiKey: RESEND_API_KEY, from: tenantFromHeader(t), to, subject: `Beleg: ${subject || "(ohne Betreff)"}`, text: `Automatisch von iou.fm weitergeleiteter Beleg (Eingang: ${new Date().toISOString()}).`, attachments: files });
            forwarded = true;
          } catch { /* Zustellung später erneut versuchbar */ }
        }
      }
      return send(res, 200, { ok: true, stored: beId, forwarded, bodyPdf: !!bodyPdfFile });
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

    // GET /api/tenants/:id/owner/customers – Kundenliste aus Stripe (NUR Owner-Konto).
    if (parts[0] === "api" && parts[1] === "tenants" && parts[3] === "owner" && parts[4] === "customers" && req.method === "GET") {
      const id = parts[2];
      if (!validId(id)) return send(res, 404, { error: "not_found" });
      const t = await readTenant(id);
      if (!t) return send(res, 404, { error: "not_found" });
      if (!tenantKeyOk(bearer(req), t)) return send(res, 401, { error: "unauthorized" });
      if (!t.isOwnerTenant) return send(res, 403, { error: "owner_only" }); // nur das per OWNER_ID freigeschaltete Konto
      if (!stripeConfigured()) return send(res, 503, { error: "billing_not_configured" });
      try {
        const resp = await listSubscriptionsForOwner();
        const subs = resp.data || [];
        let mrrCents = 0;
        const customers = subs.map((s) => {
          const items = s.items?.data || [];
          let planKey = null, monthlyCents = 0, currency = "eur", periodEnd = null;
          for (const it of items) {
            const p = it.price || {};
            const pk = planForPriceId(p.id); if (pk) planKey = pk;
            monthlyCents += Number(p.unit_amount || 0) * Number(it.quantity || 1);
            if (p.currency) currency = p.currency;
            if (it.current_period_end) periodEnd = it.current_period_end;
          }
          const cust = (s.customer && typeof s.customer === "object") ? s.customer : {};
          if (s.status === "active" || s.status === "trialing") mrrCents += monthlyCents;
          return {
            company: cust.name || "", email: cust.email || "",
            plan: planKey ? (PLANS[planKey]?.label || planKey) : "—",
            status: s.status, monthly: Math.round(monthlyCents) / 100, currency: currency.toUpperCase(),
            since: s.created ? new Date(s.created * 1000).toISOString() : null,
            currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
            cancelAtPeriodEnd: !!s.cancel_at_period_end,
          };
        });
        const rank = { active: 0, trialing: 1, past_due: 2, unpaid: 3, canceled: 4 };
        customers.sort((a, b) => (rank[a.status] ?? 9) - (rank[b.status] ?? 9) || String(b.since || "").localeCompare(String(a.since || "")));
        return send(res, 200, { customers, count: customers.length, mrr: Math.round(mrrCents) / 100, currency: "EUR" });
      } catch (e) { return send(res, 502, { error: "stripe_failed", detail: e.message }); }
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
      const obj = event.data?.object || {};
      const tenantId = obj.metadata?.tenantId
        || obj.client_reference_id
        || obj.subscription_details?.metadata?.tenantId;
      if (tenantId && validId(tenantId)) {
        const t = await readTenant(tenantId);
        if (t) {
          // Idempotenz: jede Stripe-event.id nur einmal verarbeiten (Stripe retried).
          t.stripeEventIds = Array.isArray(t.stripeEventIds) ? t.stripeEventIds : [];
          if (event.id && t.stripeEventIds.includes(event.id)) {
            return send(res, 200, { received: true, duplicate: true });
          }
          let changed = applyStripeEvent(t, event);
          // Firmenname als Rechnungsempfänger auf den Customer schreiben (nicht SEPA-Kontoinhaber).
          if (event.type === "checkout.session.completed" && obj.customer) {
            const company = (obj.custom_fields || []).find((f) => f.key === "company")?.text?.value;
            if (company) {
              t.billingCompany = company;
              try { await updateCustomer(obj.customer, { name: company }); } catch (e) { /* nicht blockierend */ }
              changed = true;
            }
          }
          if (event.id) { t.stripeEventIds.push(event.id); if (t.stripeEventIds.length > 200) t.stripeEventIds = t.stripeEventIds.slice(-200); changed = true; }
          if (changed) await writeTenant(t);
        }
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
      // Unter Lock, damit ein paralleler Schreibvorgang (z. B. PUT /doc) die Datei
      // nicht direkt nach dem Löschen neu anlegt ("Wiederauferstehung").
      await withLock(id, async () => { await fs.rm(tenantFile(id), { force: true }); });
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
    // Unerwarteter Fehler: serverseitig loggen (Diagnose im Betrieb), Client bekommt klaren 500.
    console.error("[hub] unhandled request error:", req.method, req.url, e && e.stack ? e.stack : e);
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
