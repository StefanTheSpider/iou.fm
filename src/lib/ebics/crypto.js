// EBICS-Krypto für Auftragsdaten (Order Data) – das, was Web Crypto NICHT kann.
//
// EBICS verschlüsselt die Nutzdaten so:
//   1) Klartext (z. B. camt.053-XML) wird zlib-komprimiert (RFC 1950, "deflate").
//   2) symmetrisch mit AES-128 im CBC-Modus, Initialisierungsvektor = 16 Null-Bytes.
//   3) der zufällige AES-Transaktionsschlüssel wird mit dem E002-RSA-Schlüssel des
//      Empfängers via RSAES-PKCS1-v1_5 verschlüsselt.
//
// Beim DOWNLOAD (Kontostand/Kontoauszug, HPB) ist es genau umgekehrt: Wir entschlüsseln
// den Transaktionsschlüssel mit UNSEREM privaten E002-Schlüssel und damit die Auftragsdaten.
// Web Crypto bietet RSAES-PKCS1-v1_5 bewusst nicht an – deshalb node-forge.
//
// Hinweis (bankspezifisch, beim ersten Lauf zu bestätigen): EBICS gibt für die symmetrische
// Verschlüsselung Zero-IV vor; das Padding (PKCS#7 vs. ANSI X9.23) variiert in der Praxis.
// node-forge nutzt PKCS#7. Sollte die Bank X9.23 erwarten, ist das die einzige Stelle, die
// angepasst werden muss – die restliche Kette bleibt identisch.

import forge from "node-forge";

const pem = (b64, label) =>
  `-----BEGIN ${label}-----\n${String(b64).replace(/(.{64})/g, "$1\n").replace(/\n$/, "")}\n-----END ${label}-----\n`;

export function privateKeyFromPkcs8B64(b64) {
  // node-forge versteht PKCS#8 ("PRIVATE KEY") direkt.
  return forge.pki.privateKeyFromPem(pem(b64, "PRIVATE KEY"));
}
export function publicKeyFromSpkiB64(b64) {
  return forge.pki.publicKeyFromPem(pem(b64, "PUBLIC KEY"));
}

const ZERO_IV = String.fromCharCode(...new Array(16).fill(0));
const toBinary = (u8) => forge.util.binary.raw.encode(u8);
const toU8 = (bin) => forge.util.binary.raw.decode(bin);

// zlib (RFC 1950) – im Tauri-WebView und in Node als Web-Streams vorhanden.
async function zlibDeflate(u8) {
  const cs = new CompressionStream("deflate");
  const w = cs.writable.getWriter(); w.write(u8); w.close();
  return new Uint8Array(await new Response(cs.readable).arrayBuffer());
}
async function zlibInflate(u8) {
  const ds = new DecompressionStream("deflate");
  const w = ds.writable.getWriter(); w.write(u8); w.close();
  return new Uint8Array(await new Response(ds.readable).arrayBuffer());
}

// zlib-Komprimieren/Entpacken als base64 (für INI/HIA-Order-Data, die unverschlüsselt,
// aber komprimiert übertragen werden).
export async function deflateStringToB64(str) {
  const def = await zlibDeflate(new TextEncoder().encode(str));
  return forge.util.encode64(toBinary(def));
}
export async function inflateB64ToString(b64) {
  const out = await zlibInflate(toU8(forge.util.decode64(b64)));
  return new TextDecoder().decode(out);
}

// --- DOWNLOAD: Auftragsdaten der Bank entschlüsseln -------------------------------------
// Eingaben sind base64 (wie im EBICS-XML): die verschlüsselten Auftragsdaten und der mit
// unserem E002-Public-Key verschlüsselte Transaktionsschlüssel. Rückgabe: Klartext-String.
export async function decryptOrderData({ encryptedOrderDataB64, transactionKeyB64, e002PrivPkcs8B64, compressed = true }) {
  const priv = privateKeyFromPkcs8B64(e002PrivPkcs8B64);
  // 1) AES-Schlüssel zurückgewinnen (RSAES-PKCS1-v1_5).
  const encKey = forge.util.decode64(transactionKeyB64);
  const aesKey = priv.decrypt(encKey, "RSAES-PKCS1-V1_5");
  if (aesKey.length !== 16 && aesKey.length !== 24 && aesKey.length !== 32) {
    throw new Error(`Unerwartete AES-Schlüssellänge (${aesKey.length} Byte) – evtl. falsches Padding/Schlüssel.`);
  }
  // 2) Auftragsdaten symmetrisch entschlüsseln (AES-CBC, Zero-IV).
  const decipher = forge.cipher.createDecipher("AES-CBC", aesKey);
  decipher.start({ iv: ZERO_IV });
  decipher.update(forge.util.createBuffer(forge.util.decode64(encryptedOrderDataB64)));
  if (!decipher.finish()) throw new Error("AES-Entschlüsselung fehlgeschlagen (Padding/Schlüssel).");
  const compressedU8 = toU8(decipher.output.getBytes());
  // 3) Entpacken (zlib). HPB-Antworten sind teils unkomprimiert -> optional.
  if (!compressed) return forge.util.decodeUtf8(forge.util.binary.raw.encode(compressedU8));
  const plainU8 = await zlibInflate(compressedU8);
  return new TextDecoder().decode(plainU8);
}

// --- UPLOAD / Test-Gegenstelle: Auftragsdaten verschlüsseln ----------------------------
// Wird für die echte Überweisung (Schritt 4) gebraucht und dient hier dem Offline-Test als
// „Bankseite": Klartext -> zlib -> AES-CBC -> Transaktionsschlüssel mit Empfänger-E002 (RSA).
export async function encryptOrderData({ plaintext, recipientE002SpkiB64, compressed = true }) {
  const pub = publicKeyFromSpkiB64(recipientE002SpkiB64);
  const aesKeyBin = forge.random.getBytesSync(16);
  const inputU8 = new TextEncoder().encode(plaintext);
  const payloadU8 = compressed ? await zlibDeflate(inputU8) : inputU8;

  const cipher = forge.cipher.createCipher("AES-CBC", aesKeyBin);
  cipher.start({ iv: ZERO_IV });
  cipher.update(forge.util.createBuffer(toBinary(payloadU8)));
  if (!cipher.finish()) throw new Error("AES-Verschlüsselung fehlgeschlagen.");
  const encryptedOrderDataB64 = forge.util.encode64(cipher.output.getBytes());
  const transactionKeyB64 = forge.util.encode64(pub.encrypt(aesKeyBin, "RSAES-PKCS1-V1_5"));
  return { encryptedOrderDataB64, transactionKeyB64 };
}
