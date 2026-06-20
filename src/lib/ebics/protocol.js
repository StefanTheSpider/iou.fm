// EBICS-Protokoll: HPB (Bank-öffentliche Schlüssel abholen).
//
// HPB ist der erste ECHTE Schritt nach INI/HIA und bewegt KEIN Geld – die App lädt nur
// die öffentlichen Schlüssel der Bank (Authentifizierung X002 + Verschlüsselung E002) und
// vergleicht deren Fingerabdrücke. Damit ist die komplette Kette (Transport, X002-Signatur,
// XML-Kanonisierung) bewiesen, BEVOR jemals eine Zahlung gesendet wird.
//
// Wichtige EBICS-Eigenheiten, die hier bewusst umgesetzt sind:
//   • Die Schlüssel-Management-Aufträge (INI/HIA/HPB) nutzen das H004-Schema –
//     auch bei einem EBICS-3.0-Vertrag (dort ist nur der Zahlungs-Upload H005/BTU).
//   • Die AuthSignature ist eine XML-DSig über ALLE Elemente mit authenticate="true"
//     (hier: <header>). Kanonisierung: inclusive C14N (REC-xml-c14n-20010315),
//     SignatureMethod RSA-SHA256, DigestMethod SHA-256.
//   • Inclusive C14N rendert ALLE im Geltungsbereich liegenden Namespaces auf das
//     jeweilige Wurzelelement des kanonisierten Teilbaums (Default-NS zuerst, dann nach
//     Präfix sortiert) und expandiert leere Elemente zu Start-/Endtag. Genau diese
//     kanonische Form wird signiert/gehasht – sonst lehnt die Bank die Signatur ab.
//
// Diese Datei erzeugt und (offline) verifiziert den Request. Das Entschlüsseln der
// HPB-Antwort (Transaktionsschlüssel via E002/RSA-PKCS1-v1_5) ist der nächste Schritt
// und erfordert eine PKCS1-v1.5-fähige Krypto-Bibliothek (Web Crypto kann das nicht).

import { deflateStringToB64 } from "./crypto.js";

const EBICS_NS = "urn:org:ebics:H004";
const S001_NS = "http://www.ebics.org/S001";
const DS_NS = "http://www.w3.org/2000/09/xmldsig#";
const C14N_ALGO = "http://www.w3.org/TR/2001/REC-xml-c14n-20010315";
const SIG_ALGO = "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256";
const DIGEST_ALGO = "http://www.w3.org/2001/04/xmlenc#sha256";

const enc = new TextEncoder();
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const hex = (n) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, "0")).join("");

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// base64url (JWK n/e) -> Standard-base64 (EBICS-Modulus/Exponent).
function b64urlToB64(s) {
  let t = String(s).replace(/-/g, "+").replace(/_/g, "/");
  while (t.length % 4) t += "=";
  return t;
}

export function ebicsNonce() { return hex(16).toUpperCase(); }      // 32 Hex-Zeichen
export function ebicsTimestamp(d = new Date()) { return d.toISOString().replace(/\.\d+Z$/, "Z"); }

async function sha256b64(str) {
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(str));
  return b64(digest);
}

async function importAuthPrivateKey(pkcs8b64) {
  return crypto.subtle.importKey(
    "pkcs8", unb64(pkcs8b64),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]
  );
}
// Nur für den Offline-Selbsttest (Verifikation der eigenen Signatur).
export async function importAuthPublicKey(spkiB64) {
  return crypto.subtle.importKey(
    "spki", unb64(spkiB64),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]
  );
}

// Inhalt des <static>-Blocks (ohne umschließendes <header>), deterministisch & ohne Whitespace.
function buildStaticInner(cfg, { nonce, timestamp }) {
  return (
    "<static>" +
      `<HostID>${esc(cfg.hostId)}</HostID>` +
      `<Nonce>${nonce}</Nonce>` +
      `<Timestamp>${timestamp}</Timestamp>` +
      `<PartnerID>${esc(cfg.partnerId)}</PartnerID>` +
      `<UserID>${esc(cfg.userId)}</UserID>` +
      `<Product Language="de" InstituteID="iou.fm">iou.fm</Product>` +
      "<OrderDetails>" +
        "<OrderType>HPB</OrderType>" +
        "<OrderAttribute>DZHNN</OrderAttribute>" +
      "</OrderDetails>" +
      "<SecurityMedium>0000</SecurityMedium>" +
    "</static>"
  );
}

// Kanonische Form (inclusive C14N) des signierten <header>-Teilbaums: Apex erhält die
// im Geltungsbereich liegenden Namespaces (Default-NS, dann ds), danach Attribute.
function c14nHeader(headerInner) {
  return `<header xmlns="${EBICS_NS}" xmlns:ds="${DS_NS}" authenticate="true">${headerInner}</header>`;
}

// <ds:SignedInfo>-Inhalt; leere Elemente sind als Start-/Endtag expandiert (C14N-konform).
function buildSignedInfoInner(digestValue) {
  return (
    `<ds:CanonicalizationMethod Algorithm="${C14N_ALGO}"></ds:CanonicalizationMethod>` +
    `<ds:SignatureMethod Algorithm="${SIG_ALGO}"></ds:SignatureMethod>` +
    `<ds:Reference URI="#xpointer(//*[@authenticate='true'])">` +
      `<ds:Transforms><ds:Transform Algorithm="${C14N_ALGO}"></ds:Transform></ds:Transforms>` +
      `<ds:DigestMethod Algorithm="${DIGEST_ALGO}"></ds:DigestMethod>` +
      `<ds:DigestValue>${digestValue}</ds:DigestValue>` +
    "</ds:Reference>"
  );
}
// Kanonische Form von SignedInfo: Apex erhält ebenfalls die in-scope Namespaces.
function c14nSignedInfo(signedInfoInner) {
  return `<ds:SignedInfo xmlns="${EBICS_NS}" xmlns:ds="${DS_NS}">${signedInfoInner}</ds:SignedInfo>`;
}

// Baut den vollständigen, signierten HPB-Request (ebicsNoPubKeyDigestsRequest, H004).
// Rückgabe: { xml, nonce, timestamp, digestValue, signatureValue } – die Zusatzfelder
// dienen Tests/Debug. Es wird NICHTS gesendet (reine Erzeugung).
export async function buildHpbRequest({ cfg, keys }) {
  if (!cfg?.hostId || !cfg?.partnerId || !cfg?.userId) {
    throw new Error("EBICS-Konfiguration unvollständig (Host-ID, Kunden-ID, Teilnehmer-ID).");
  }
  if (!keys?.authentication?.priv) throw new Error("Kein X002-Authentifizierungsschlüssel vorhanden.");

  const nonce = ebicsNonce();
  const timestamp = ebicsTimestamp();
  const headerInner = buildStaticInner(cfg, { nonce, timestamp }) + "<mutable></mutable>";

  // 1) Digest über die kanonische Form des signierten Teilbaums (<header>).
  const digestValue = await sha256b64(c14nHeader(headerInner));

  // 2) Signatur über die kanonische Form von <ds:SignedInfo>.
  const signedInfoInner = buildSignedInfoInner(digestValue);
  const privKey = await importAuthPrivateKey(keys.authentication.priv);
  const sigBuf = await crypto.subtle.sign(
    { name: "RSASSA-PKCS1-v1_5" }, privKey, enc.encode(c14nSignedInfo(signedInfoInner))
  );
  const signatureValue = b64(sigBuf);

  // 3) Übertragenes Dokument: Namespaces werden auf der Wurzel deklariert und von
  //    <header>/<ds:SignedInfo> geerbt – die Bank kanonisiert beim Verifizieren erneut.
  const xml =
    '<?xml version="1.0" encoding="UTF-8"?>' +
    `<ebicsNoPubKeyDigestsRequest xmlns="${EBICS_NS}" xmlns:ds="${DS_NS}" Version="H004" Revision="1">` +
      `<header authenticate="true">${headerInner}</header>` +
      "<AuthSignature>" +
        `<ds:SignedInfo>${signedInfoInner}</ds:SignedInfo>` +
        `<ds:SignatureValue>${signatureValue}</ds:SignatureValue>` +
      "</AuthSignature>" +
      "<body></body>" +
    "</ebicsNoPubKeyDigestsRequest>";

  return { xml, nonce, timestamp, digestValue, signatureValue, signedC14n: c14nSignedInfo(signedInfoInner) };
}

// Verifiziert die eigene Signatur (Offline-Selbsttest der internen Konsistenz).
export async function verifyOwnHpbRequest(req, keys) {
  const pub = await importAuthPublicKey(keys.authentication.spki);
  return crypto.subtle.verify(
    { name: "RSASSA-PKCS1-v1_5" }, pub, unb64(req.signatureValue), enc.encode(req.signedC14n)
  );
}

// --- INI / HIA: Schlüssel elektronisch bei der Bank einreichen --------------------------
// Beide sind ebicsUnsecuredRequest (OHNE AuthSignature) – sie tragen nur die öffentlichen
// Schlüssel komprimiert als Order-Data. INI = bank-technischer Signaturschlüssel (A006),
// HIA = Authentifizierung (X002) + Verschlüsselung (E002). Erst nach INI+HIA UND dem
// unterschriebenen INI-Brief schaltet die Bank den Zugang frei.

const ebicsNs = (version) => (version === "H005" ? "urn:org:ebics:H005" : EBICS_NS);
const normVersion = (v) => (v === "H005" ? "H005" : "H004");

function unsecuredRequest(cfg, orderType, orderDataB64, version = "H004") {
  // H004: <OrderType> + <OrderAttribute>. H005 (EBICS 3.0): <AdminOrderType> für
  // administrative Aufträge (INI/HIA), ohne OrderAttribute.
  const orderDetails = version === "H005"
    ? `<OrderDetails><AdminOrderType>${orderType}</AdminOrderType></OrderDetails>`
    : `<OrderDetails><OrderType>${orderType}</OrderType><OrderAttribute>DZNNN</OrderAttribute></OrderDetails>`;
  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    `<ebicsUnsecuredRequest xmlns="${ebicsNs(version)}" Version="${version}" Revision="1">` +
      '<header authenticate="true">' +
        "<static>" +
          `<HostID>${esc(cfg.hostId)}</HostID>` +
          `<PartnerID>${esc(cfg.partnerId)}</PartnerID>` +
          `<UserID>${esc(cfg.userId)}</UserID>` +
          '<Product Language="de" InstituteID="iou.fm">iou.fm</Product>' +
          orderDetails +
          "<SecurityMedium>0000</SecurityMedium>" +
        "</static>" +
        "<mutable></mutable>" +
      "</header>" +
      `<body><DataTransfer><OrderData>${orderDataB64}</OrderData></DataTransfer></body>` +
    "</ebicsUnsecuredRequest>"
  );
}

function rsaKeyValue(pub) {
  return `<ds:RSAKeyValue><ds:Modulus>${b64urlToB64(pub.n)}</ds:Modulus><ds:Exponent>${b64urlToB64(pub.e)}</ds:Exponent></ds:RSAKeyValue>`;
}

// INI-Order-Data: bank-technischer Signaturschlüssel (A006).
export function signaturePubKeyOrderData(cfg, keys, timestamp = ebicsTimestamp()) {
  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    `<SignaturePubKeyOrderData xmlns="${S001_NS}" xmlns:ds="${DS_NS}">` +
      "<SignaturePubKeyInfo>" +
        `<PubKeyValue>${rsaKeyValue(keys.signature.pub)}<TimeStamp>${timestamp}</TimeStamp></PubKeyValue>` +
        "<SignatureVersion>A006</SignatureVersion>" +
      "</SignaturePubKeyInfo>" +
      `<PartnerID>${esc(cfg.partnerId)}</PartnerID>` +
      `<UserID>${esc(cfg.userId)}</UserID>` +
    "</SignaturePubKeyOrderData>"
  );
}

// HIA-Order-Data: Authentifizierungs- (X002) + Verschlüsselungsschlüssel (E002).
export function hiaRequestOrderData(cfg, keys, version = "H004") {
  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    `<HIARequestOrderData xmlns="${ebicsNs(version)}" xmlns:ds="${DS_NS}">` +
      "<AuthenticationPubKeyInfo>" +
        `<PubKeyValue>${rsaKeyValue(keys.authentication.pub)}</PubKeyValue>` +
        "<AuthenticationVersion>X002</AuthenticationVersion>" +
      "</AuthenticationPubKeyInfo>" +
      "<EncryptionPubKeyInfo>" +
        `<PubKeyValue>${rsaKeyValue(keys.encryption.pub)}</PubKeyValue>` +
        "<EncryptionVersion>E002</EncryptionVersion>" +
      "</EncryptionPubKeyInfo>" +
      `<PartnerID>${esc(cfg.partnerId)}</PartnerID>` +
      `<UserID>${esc(cfg.userId)}</UserID>` +
    "</HIARequestOrderData>"
  );
}

function ensureInitConfig(cfg, keys) {
  if (!cfg?.hostId || !cfg?.partnerId || !cfg?.userId) {
    throw new Error("EBICS-Konfiguration unvollständig (Host-ID, Kunden-ID, Teilnehmer-ID).");
  }
  if (!keys?.signature?.pub || !keys?.authentication?.pub || !keys?.encryption?.pub) {
    throw new Error("EBICS-Schlüssel fehlen – bitte zuerst die Schlüssel erzeugen.");
  }
}

export async function buildIniRequest({ cfg, keys }) {
  ensureInitConfig(cfg, keys);
  const version = normVersion(cfg.version);
  const orderXml = signaturePubKeyOrderData(cfg, keys);
  const orderDataB64 = await deflateStringToB64(orderXml);
  return { xml: unsecuredRequest(cfg, "INI", orderDataB64, version), orderXml, orderDataB64, version };
}

export async function buildHiaRequest({ cfg, keys }) {
  ensureInitConfig(cfg, keys);
  const version = normVersion(cfg.version);
  const orderXml = hiaRequestOrderData(cfg, keys, version);
  const orderDataB64 = await deflateStringToB64(orderXml);
  return { xml: unsecuredRequest(cfg, "HIA", orderDataB64, version), orderXml, orderDataB64, version };
}

// --- HPB-Antwort: Hülle/Returncode lesen (Entschlüsselung folgt mit PKCS1-v1.5-Lib) ----
// Liest den technischen + fachlichen EBICS-Returncode aus der Antwort, ohne die
// verschlüsselten Bankschlüssel schon zu entpacken. So lässt sich der Sende-/Auth-Teil
// gegen die (Test-)Bank validieren, bevor die Antwort-Entschlüsselung scharfgeschaltet wird.
export function parseEbicsReturnCodes(xml) {
  const s = String(xml || "");
  const pick = (re) => { const m = s.match(re); if (!m) return null; return m.slice(1).find((g) => g != null) ?? null; };
  return {
    // Erster ReturnCode (im Header/mutable) = technischer Code; der Code im <body> ist der fachliche.
    technical: pick(/<(?:\w+:)?ReturnCode[^>]*>([^<]+)</),
    bodyReturnCode: pick(/<body[^>]*>[\s\S]*?<(?:\w+:)?ReturnCode[^>]*>([^<]+)</),
    reportText: pick(/<(?:\w+:)?ReportText[^>]*>([^<]+)</),
    orderDataPresent: /<(?:\w+:)?OrderData[^>]*>/.test(s),
  };
}
