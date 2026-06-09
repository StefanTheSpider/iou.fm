// Kleiner lokaler Entwicklungs-Proxy für Shopify (umgeht CORS im Browser).
// Hält Domain + Token serverseitig (aus shopify.local.json), niemals im Browser.
//
// Nutzung:
//   1) shopify.local.json anlegen (Vorlage: shopify.local.example.json)
//   2) npm run proxy
//   3) App im Browser nutzen – "Aus Shopify laden" geht dann über diesen Proxy.
//
// Nur für die lokale Entwicklung. In der Tauri-Desktop-App ruft die App Shopify
// direkt auf (ohne CORS), dann wird dieser Proxy nicht gebraucht.

import http from "node:http";
import fs from "node:fs";

const API_VERSION = "2024-10";
const PORT = 8788;

// Reiner Relay-Proxy für die Browser-Entwicklung (umgeht CORS). Zugangsdaten
// kommen aus dem App-Tresor und werden pro Anfrage mitgeschickt – der Proxy
// speichert KEINE Geheimnisse. Optional als Fallback: .env / shopify.local.json.
let cfg = {};
if (process.env.SHOPIFY_DOMAIN || process.env.SHOPIFY_TOKEN) {
  cfg = { domain: process.env.SHOPIFY_DOMAIN, token: process.env.SHOPIFY_TOKEN };
} else {
  try {
    const path = process.env.SHOPIFY_CONFIG || new URL("./shopify.local.json", import.meta.url);
    cfg = JSON.parse(fs.readFileSync(path));
  } catch {}
}

const QUERY = `
query($q: String!) {
  orders(first: 1, query: $q) {
    edges { node {
      name
      customer { displayName }
      billingAddress { name firstName lastName }
      shippingAddress { name }
      totalPriceSet { shopMoney { amount currencyCode } }
      lineItems(first: 3) { edges { node { title quantity } } }
    } }
  }
}`;

http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  if (req.method === "OPTIONS") { res.writeHead(204); return res.end(); }
  if (req.method !== "POST") { res.writeHead(404); return res.end(); }

  let body = "";
  for await (const c of req) body += c;
  let parsed = {};
  try { parsed = JSON.parse(body || "{}"); } catch {}
  const num = String(parsed.orderNumber || "").replace(/^#/, "").trim();
  const domain = parsed.domain || cfg.domain;
  const token = parsed.token || cfg.token;
  if (!domain || !token) {
    res.writeHead(400, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ error: "Shopify-Domain/Token fehlen" }));
  }

  try {
    const r = await fetch(`https://${domain}/admin/api/${API_VERSION}/graphql.json`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
      body: JSON.stringify({ query: QUERY, variables: { q: `name:${num}` } }),
    });
    const text = await r.text();
    res.writeHead(r.status, { "Content-Type": "application/json" });
    res.end(text);
  } catch (e) {
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: String(e) }));
  }
}).listen(PORT, () => {
  console.log(`\n  Shopify-Dev-Proxy läuft auf http://localhost:${PORT}`);
  console.log(`  Zugangsdaten kommen aus dem App-Tresor (Stammdaten → Shopify).\n`);
});
