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

    // GET /api/tenants/:id/feed  – vom Cron gesammelte Shopify-Daten
    if (parts[0] === "api" && parts[1] === "tenants" && parts[3] === "feed" && req.method === "GET") {
      const id = parts[2];
      if (!validId(id)) return send(res, 404, { error: "not_found" });
      const t = await readTenant(id);
      if (!t) return send(res, 404, { error: "not_found" });
      if (!tenantKeyOk(bearer(req), t)) return send(res, 401, { error: "unauthorized" });
      return send(res, 200, t.shopifyFeed || { cancellations: [], refunds: [], requests: [], syncedAt: null });
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
});

export { server };
