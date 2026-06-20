import { validateIban } from "../src/lib/iban.js";
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log(`${c ? "✓" : "✗"} ${m}`); };

// Der Müll aus der fehl-erkannten Metallica-Bestellbestätigung MUSS abgelehnt werden.
const junk = validateIban("XX627AJVILJ1IBYZGSCXYDSF16QR");
ok(!junk.ok, `Müll-IBAN XX627… abgelehnt (Grund: ${junk.reason})`);
ok(junk.code === "country", "Ablehnungsgrund: unbekanntes Land");

// Weitere Müll-/Fehlerfälle.
ok(!validateIban("XX00 1234 5678").ok, "Anderes unbekanntes Land abgelehnt");
ok(!validateIban("DE00 0000 0000 0000 0000 00").ok, "DE mit falscher Prüfziffer abgelehnt");
ok(!validateIban("DE12 3456").ok, "DE mit falscher Länge abgelehnt");

// Echte, gültige IBANs bleiben gültig.
ok(validateIban("DE89 3704 0044 0532 0130 00").ok, "Gültige DE-IBAN bleibt gültig");
ok(validateIban("DE02120300000000202051").ok, "Gültige DE-IBAN (Demo) bleibt gültig");
ok(validateIban("AT61 1904 3002 3457 3201").ok, "Gültige AT-IBAN bleibt gültig");

console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen`);
process.exit(fail ? 1 : 0);
