// Offline-Verifikation der INI/HIA-Einreichung (ebicsUnsecuredRequest).
// Prüft: Request-Aufbau, Auftragsarten, und dass die eingebetteten (komprimierten)
// öffentlichen Schlüssel exakt den erzeugten Schlüsseln entsprechen (deflate -> inflate).
import { generateEbicsKeys } from "../src/lib/ebics/keys.js";
import { buildIniRequest, buildHiaRequest, parseEbicsReturnCodes } from "../src/lib/ebics/protocol.js";
import { inflateB64ToString } from "../src/lib/ebics/crypto.js";

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log(`${c ? "✓" : "✗"} ${m}`); };

const b64url2b64 = (s) => { let t = String(s).replace(/-/g, "+").replace(/_/g, "/"); while (t.length % 4) t += "="; return t; };
const baseCfg = { hostId: "CBKEBIX1", partnerId: "Q6890042", userId: "ZIELINMA", ebicsUrl: "https://ebicsveu.commerzbank.com/ebicsweb/ebicsweb" };
const keys = await generateEbicsKeys();

// --- INI/HIA: H004 (klassisch, OrderType+OrderAttribute) ---
const cfg4 = { ...baseCfg, version: "H004" };
const ini4 = await buildIniRequest({ cfg: cfg4, keys });
ok(ini4.xml.includes('<ebicsUnsecuredRequest xmlns="urn:org:ebics:H004" Version="H004"'), "H004 INI: ebicsUnsecuredRequest H004");
ok(ini4.xml.includes("<OrderType>INI</OrderType>") && ini4.xml.includes("<OrderAttribute>DZNNN</OrderAttribute>"), "H004 INI: OrderType + OrderAttribute");

// --- INI/HIA: H005 (EBICS 3.0, AdminOrderType, ohne OrderAttribute) ---
const cfg5 = { ...baseCfg, version: "H005" };
const ini = await buildIniRequest({ cfg: cfg5, keys });
ok(ini.xml.includes('<ebicsUnsecuredRequest xmlns="urn:org:ebics:H005" Version="H005"'), "H005 INI: ebicsUnsecuredRequest H005");
ok(ini.xml.includes("<AdminOrderType>INI</AdminOrderType>"), "H005 INI: AdminOrderType INI");
ok(!ini.xml.includes("<OrderAttribute>"), "H005 INI: kein OrderAttribute");
ok(ini.xml.includes(`<HostID>${baseCfg.hostId}</HostID>`) && ini.xml.includes(`<UserID>${baseCfg.userId}</UserID>`), "H005 INI: Host-/User-ID gesetzt");
ok(!ini.xml.includes("AuthSignature"), "H005 INI: keine Signatur (unsecured)");

const iniOrder = await inflateB64ToString(ini.orderDataB64);
ok(iniOrder.includes("<SignatureVersion>A006</SignatureVersion>"), "H005 INI: SignatureVersion A006 in Order-Data");
ok(iniOrder.includes(`<ds:Modulus>${b64url2b64(keys.signature.pub.n)}</ds:Modulus>`), "H005 INI: A006-Modulus entspricht erzeugtem Schlüssel");
ok(iniOrder.includes(`<ds:Exponent>${b64url2b64(keys.signature.pub.e)}</ds:Exponent>`), "H005 INI: A006-Exponent korrekt");
ok(/<TimeStamp>\d{4}-\d{2}-\d{2}T/.test(iniOrder), "H005 INI: TimeStamp vorhanden");

const hia = await buildHiaRequest({ cfg: cfg5, keys });
ok(hia.xml.includes('<ebicsUnsecuredRequest xmlns="urn:org:ebics:H005"'), "H005 HIA: H005-Namespace");
ok(hia.xml.includes("<AdminOrderType>HIA</AdminOrderType>"), "H005 HIA: AdminOrderType HIA");
const hiaOrder = await inflateB64ToString(hia.orderDataB64);
ok(hiaOrder.includes('<HIARequestOrderData xmlns="urn:org:ebics:H005"'), "H005 HIA: Order-Data im H005-Namespace");
ok(hiaOrder.includes("<AuthenticationVersion>X002</AuthenticationVersion>"), "H005 HIA: AuthenticationVersion X002");
ok(hiaOrder.includes("<EncryptionVersion>E002</EncryptionVersion>"), "H005 HIA: EncryptionVersion E002");
ok(hiaOrder.includes(`<ds:Modulus>${b64url2b64(keys.authentication.pub.n)}</ds:Modulus>`), "H005 HIA: X002-Modulus korrekt");
ok(hiaOrder.includes(`<ds:Modulus>${b64url2b64(keys.encryption.pub.n)}</ds:Modulus>`), "H005 HIA: E002-Modulus korrekt");

// --- Returncode-Parser für die (Unsecured-)Antwort ---
const okResp = '<ebicsKeyManagementResponse xmlns="urn:org:ebics:H004"><header authenticate="true"><mutable><ReturnCode>000000</ReturnCode><ReportText>[EBICS_OK]</ReportText></mutable></header><body><ReturnCode>000000</ReturnCode></body></ebicsKeyManagementResponse>';
ok(parseEbicsReturnCodes(okResp).technical === "000000", "Antwort: Returncode 000000 (OK) gelesen");
const dupResp = '<ebicsKeyManagementResponse xmlns="urn:org:ebics:H004"><header authenticate="true"><mutable><ReturnCode>091002</ReturnCode><ReportText>[EBICS_INVALID_USER_OR_USER_STATE]</ReportText></mutable></header><body><ReturnCode>091002</ReturnCode></body></ebicsKeyManagementResponse>';
ok(parseEbicsReturnCodes(dupResp).reportText.includes("USER_OR_USER_STATE"), "Antwort: Fehlertext erkannt (z. B. schon initialisiert)");

console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen`);
process.exit(fail ? 1 : 0);
