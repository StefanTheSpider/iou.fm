// Eingehende Belege per E-Mail: reine Helfer (Adresse/Token, Parsing).
// Der Empfang läuft über einen Inbound-Mail-Dienst (z. B. Cloudflare Email Worker),
// der die Mail als JSON an /api/inbound-email an den Hub schickt.
import crypto from "node:crypto";

// Inbox-Domain (MX zeigt auf den Inbound-Dienst). Per ENV setzbar.
export function inboxDomain() { return process.env.INBOUND_DOMAIN || "belege.iou.fm"; }

// Neuen Inbox-Token erzeugen (nicht erratbar).
export function newInboxToken() { return crypto.randomBytes(8).toString("hex"); }

// Vollständige Weiterleitungs-Adresse für einen Token.
export function inboxAddress(token) { return `belege-${token}@${inboxDomain()}`; }

// Token aus einer Empfänger-Adresse extrahieren ("Name <belege-abc@dom>" oder "belege-abc@dom").
export function tokenFromAddress(to) {
  const m = /belege-([a-z0-9]+)@/i.exec(String(to || ""));
  return m ? m[1].toLowerCase() : null;
}

// SHA-256 über die Roh-Mail (für die revisionssichere Ablage).
export function sha256Hex(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

// Dateinamen säubern (keine Pfad-Tricks).
export function safeName(name) {
  return String(name || "datei").replace(/[^\w.\-]+/g, "_").slice(0, 120) || "datei";
}
