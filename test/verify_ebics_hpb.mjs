// Offline-Verifikation des EBICS-HPB-Request-Builders (src/lib/ebics/protocol.js).
// Prüft die interne Konsistenz: Aufbau, Nonce/Timestamp, und vor allem die AuthSignature
// (signieren -> mit eigenem X002-Public-Key verifizieren), plus Tamper-/Fremdschlüssel-Proben.
// Die echte Interoperabilität mit der Bank wird zusätzlich beim ersten HPB-Lauf bestätigt.
import { generateEbicsKeys } from "../src/lib/ebics/keys.js";
import { buildHpbRequest, verifyOwnHpbRequest, parseEbicsReturnCodes } from "../src/lib/ebics/protocol.js";

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log(`${c ? "✓" : "✗"} ${m}`); };

const cfg = { hostId: "COBADEFF", partnerId: "K0001234", userId: "T0001234", ebicsUrl: "https://test.bank/ebics", version: "H005" };
const keys = await generateEbicsKeys();
const req = await buildHpbRequest({ cfg, keys });

ok(req.xml.startsWith('<?xml version="1.0" encoding="UTF-8"?><ebicsNoPubKeyDigestsRequest'), "Root-Element ebicsNoPubKeyDigestsRequest");
ok(req.xml.includes("<OrderType>HPB</OrderType>"), "OrderType HPB");
ok(req.xml.includes("<OrderAttribute>DZHNN</OrderAttribute>"), "OrderAttribute DZHNN");
ok(req.xml.includes(`<HostID>${cfg.hostId}</HostID>`), "HostID gesetzt");
ok(/<Nonce>[0-9A-F]{32}<\/Nonce>/.test(req.xml), "Nonce 32 Hex-Zeichen (uppercase)");
ok(/<Timestamp>\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z<\/Timestamp>/.test(req.xml), "Timestamp ISO ohne Millisekunden");
ok(req.xml.includes("<ds:SignatureValue>") && req.signatureValue.length > 300, "SignatureValue vorhanden (RSA-2048)");
ok(req.xml.includes(`<ds:DigestValue>${req.digestValue}</ds:DigestValue>`), "DigestValue im Dokument");
ok(await verifyOwnHpbRequest(req, keys), "AuthSignature verifiziert gegen eigenen X002-Schlüssel");

const tampered = { ...req, signedC14n: req.signedC14n + " " };
ok(!(await verifyOwnHpbRequest(tampered, keys)), "Manipulierte Daten werden abgelehnt");
const otherKeys = await generateEbicsKeys();
ok(!(await verifyOwnHpbRequest(req, otherKeys)), "Fremder Schlüssel verifiziert nicht");

const sample = '<ebicsKeyManagementResponse xmlns="urn:org:ebics:H004"><header authenticate="true"><mutable><ReturnCode>000000</ReturnCode><ReportText>[EBICS_OK]</ReportText></mutable></header><body><ReturnCode>000000</ReturnCode><DataTransfer><OrderData>QUJD</OrderData></DataTransfer></body></ebicsKeyManagementResponse>';
const rc = parseEbicsReturnCodes(sample);
ok(rc.technical === "000000", `technischer Returncode gelesen (${rc.technical})`);
ok(rc.reportText === "[EBICS_OK]", "ReportText gelesen");
ok(rc.orderDataPresent === true, "OrderData in der Antwort erkannt");

console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen`);
process.exit(fail ? 1 : 0);