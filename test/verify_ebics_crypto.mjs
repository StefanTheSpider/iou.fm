// Offline-End-to-End-Probe der EBICS-Auftragsdaten-Krypto + Saldo-Auslesung.
// „Bankseite" (encryptOrderData) verschlüsselt einen camt.053 mit unserem E002-Public-Key;
// „App-Seite" (decryptOrderData) entschlüsselt mit dem privaten E002-Schlüssel. Danach Saldo.
import { generateEbicsKeys } from "../src/lib/ebics/keys.js";
import { encryptOrderData, decryptOrderData } from "../src/lib/ebics/crypto.js";
import { parseCamtBalance, parseCamtBalances, parseCamtAccountIban } from "../src/lib/ebics/camt.js";

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log(`${c ? "✓" : "✗"} ${m}`); };

const camt =
  '<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02"><BkToCstmrStmt><Stmt>' +
  '<Acct><Id><IBAN>DE02120300000000202051</IBAN></Id></Acct>' +
  '<Bal><Tp><CdOrPrtry><Cd>OPBD</Cd></CdOrPrtry></Tp><Amt Ccy="EUR">1000.00</Amt><CdtDbtInd>CRDT</CdtDbtInd></Bal>' +
  '<Bal><Tp><CdOrPrtry><Cd>CLBD</Cd></CdOrPrtry></Tp><Amt Ccy="EUR">2345.67</Amt><CdtDbtInd>CRDT</CdtDbtInd></Bal>' +
  '</Stmt></BkToCstmrStmt></Document>';

const keys = await generateEbicsKeys();

// 1) Krypto-Roundtrip (komprimiert, wie bei camt-Downloads).
const sealed = await encryptOrderData({ plaintext: camt, recipientE002SpkiB64: keys.encryption.spki, compressed: true });
ok(typeof sealed.encryptedOrderDataB64 === "string" && sealed.encryptedOrderDataB64.length > 0, "Bankseite: Auftragsdaten verschlüsselt (base64)");
ok(typeof sealed.transactionKeyB64 === "string" && sealed.transactionKeyB64.length > 0, "Bankseite: Transaktionsschlüssel (RSA) erzeugt");

const recovered = await decryptOrderData({
  encryptedOrderDataB64: sealed.encryptedOrderDataB64,
  transactionKeyB64: sealed.transactionKeyB64,
  e002PrivPkcs8B64: keys.encryption.priv,
  compressed: true,
});
ok(recovered === camt, "App-Seite: Klartext exakt wiederhergestellt (RSA-PKCS1v1.5 + AES-CBC + zlib)");

// 2) Falscher Schlüssel darf NICHT entschlüsseln.
const other = await generateEbicsKeys();
let blocked = false;
try {
  await decryptOrderData({
    encryptedOrderDataB64: sealed.encryptedOrderDataB64,
    transactionKeyB64: sealed.transactionKeyB64,
    e002PrivPkcs8B64: other.encryption.priv,
    compressed: true,
  });
} catch { blocked = true; }
ok(blocked, "Fremder E002-Schlüssel kann die Auftragsdaten nicht entschlüsseln");

// 3) Saldo aus dem (entschlüsselten) camt lesen.
const bal = parseCamtBalance(recovered);
ok(bal && bal.code === "CLBD", "Schlusssaldo (CLBD) gewählt");
ok(bal && Math.abs(bal.signed - 2345.67) < 1e-9, `Saldo 2345,67 (${bal && bal.signed})`);
ok(bal && bal.currency === "EUR", "Währung EUR");
ok(parseCamtBalances(recovered).length === 2, "beide Saldenarten erkannt (OPBD + CLBD)");
ok(parseCamtAccountIban(recovered) === "DE02120300000000202051", "Konto-IBAN gelesen");

// 4) Soll-Saldo wird negativ dargestellt.
const debitCamt = camt.replace("<Cd>CLBD</Cd></CdOrPrtry></Tp><Amt Ccy=\"EUR\">2345.67</Amt><CdtDbtInd>CRDT</CdtDbtInd>",
                               "<Cd>CLBD</Cd></CdOrPrtry></Tp><Amt Ccy=\"EUR\">500.00</Amt><CdtDbtInd>DBIT</CdtDbtInd>");
const dbal = parseCamtBalance(debitCamt);
ok(dbal && Math.abs(dbal.signed + 500) < 1e-9, `Soll-Saldo negativ (-500): ${dbal && dbal.signed}`);

console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen`);
process.exit(fail ? 1 : 0);
