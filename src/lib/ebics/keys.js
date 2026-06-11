// EBICS-Schlüsselverwaltung – läuft komplett LOKAL im Browser/Tauri (Web Crypto).
// Es werden drei RSA-Schlüsselpaare erzeugt (wie es der EBICS-Standard verlangt):
//   • A006  – Bank-technische Signatur (Unterschrift unter Aufträge)
//   • X002  – Identifikation & Authentifizierung (Transport)
//   • E002  – Verschlüsselung
// Die PRIVATEN Schlüssel werden nur verschlüsselt im lokalen Tresor abgelegt
// (Feld `ebicsKeys`, nicht in SHARED_KEYS) und verlassen das Gerät nie.
//
// Hinweis: Die exakte Byte-Repräsentation des INI-Brief-Hashes wird beim Ersteinrichten
// einmal gegen das Prüf-Tool der Bank verifiziert (Commerzbank-Testzugang). Der hier
// implementierte Hash folgt der gängigen EBICS-Regel (SHA-256 über "exponent modulus"
// in Kleinbuchstaben-Hex ohne führende Nullen).

const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const b64urlToBytes = (s) => {
  const pad = s.length % 4 ? "=".repeat(4 - (s.length % 4)) : "";
  const norm = s.replace(/-/g, "+").replace(/_/g, "/") + pad;
  return Uint8Array.from(atob(norm), (c) => c.charCodeAt(0));
};
const toHexLowerNoLeadingZero = (bytes) => {
  let h = [...bytes].map((x) => x.toString(16).padStart(2, "0")).join("");
  h = h.replace(/^0+/, "");
  return h.length ? h : "0";
};

// Ein RSA-Schlüsselpaar erzeugen und als exportierbares Material zurückgeben.
async function genPair(usage) {
  const algo =
    usage === "enc"
      ? { name: "RSA-OAEP", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }
      : { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" };
  const keyUsages = usage === "enc" ? ["encrypt", "decrypt"] : ["sign", "verify"];
  const kp = await crypto.subtle.generateKey(algo, true, keyUsages);
  const pkcs8 = await crypto.subtle.exportKey("pkcs8", kp.privateKey);
  const jwk = await crypto.subtle.exportKey("jwk", kp.publicKey); // n, e (base64url)
  const spki = await crypto.subtle.exportKey("spki", kp.publicKey);
  return { priv: b64(pkcs8), pub: { n: jwk.n, e: jwk.e }, spki: b64(spki) };
}

// EBICS-Hash eines öffentlichen Schlüssels (für den INI-Brief).
export async function publicKeyHash(pub) {
  const modulus = b64urlToBytes(pub.n);
  const exponent = b64urlToBytes(pub.e);
  const input = `${toHexLowerNoLeadingZero(exponent)} ${toHexLowerNoLeadingZero(modulus)}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0").toUpperCase()).join("");
}

// In 2er-Blöcken gruppiert für die lesbare Darstellung auf dem INI-Brief.
export function formatHashBlocks(hashHex) {
  return (hashHex.match(/.{1,2}/g) || []).join(" ");
}

// Erzeugt einen kompletten EBICS-Schlüsselsatz (Signatur, Auth, Verschlüsselung)
// inklusive der drei öffentlichen Hashes für den INI-Brief.
export async function generateEbicsKeys() {
  const [sig, auth, enc] = await Promise.all([genPair("sig"), genPair("auth"), genPair("enc")]);
  const [sigHash, authHash, encHash] = await Promise.all([
    publicKeyHash(sig.pub),
    publicKeyHash(auth.pub),
    publicKeyHash(enc.pub),
  ]);
  return {
    createdAt: new Date().toISOString(),
    versions: { signature: "A006", authentication: "X002", encryption: "E002" },
    signature: sig,
    authentication: auth,
    encryption: enc,
    hashes: { signature: sigHash, authentication: authHash, encryption: encHash },
  };
}
