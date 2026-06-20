// Verifikation der revisionssicheren Belege-Engine: Hash, Dedup, Versiegelung, Tamper-Erkennung.
import { sha256Hex, dedupeByHash, buildSealedManifest, verifyManifest, manifestToCsv, belegHashFromFiles } from "../src/lib/belegeArchive.js";

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log(`${c ? "✓" : "✗"} ${m}`); };

// Inhalts-Hash ist deterministisch und inhaltsabhängig.
const h1 = await sha256Hex(new TextEncoder().encode("Bestellbestätigung Metallica M72"));
const h1b = await sha256Hex(new TextEncoder().encode("Bestellbestätigung Metallica M72"));
const h2 = await sha256Hex(new TextEncoder().encode("Andere Mail"));
ok(h1 === h1b, "Gleicher Inhalt → gleicher Hash");
ok(h1 !== h2, "Anderer Inhalt → anderer Hash");
ok(/^[0-9a-f]{64}$/.test(h1), "SHA-256 als 64 Hex-Zeichen");

// Dedup: dieselbe Mail doppelt weitergeleitet (zwei Beleg-IDs, gleicher Hash) → EIN Eintrag.
const entries = [
  { belegId: "b1", hash: h1, from: "ticket@shop.de", subject: "Bestellbestätigung", date: "2026-06-18", files: [{ name: "a.pdf", sha256: h1 }], archivedAt: "2026-06-18T10:00:00Z" },
  { belegId: "b2", hash: h1, from: "ticket@shop.de", subject: "WG: Bestellbestätigung", date: "2026-06-19", files: [{ name: "a.pdf", sha256: h1 }], archivedAt: "2026-06-19T09:00:00Z" },
  { belegId: "b3", hash: h2, from: "info@hotel.de", subject: "Buchung", date: "2026-06-20", files: [{ name: "b.pdf", sha256: h2 }], archivedAt: "2026-06-20T08:00:00Z" },
];
const { unique, duplicates } = dedupeByHash(entries);
ok(unique.length === 2, `2 eindeutige Belege (statt 3) – ${unique.length}`);
ok(duplicates.length === 1 && duplicates[0].duplicateOf === "b1", "Doppelte Weiterleitung als Duplikat von b1 erkannt");

// Versiegeltes Manifest + Prüfung.
const manifest = await buildSealedManifest(unique);
ok(manifest.count === 2 && /^[0-9a-f]{64}$/.test(manifest.sealHash), "Manifest versiegelt (Siegelhash vorhanden)");
const v = await verifyManifest(manifest);
ok(v.ok, "Unverändertes Manifest verifiziert sauber");

// Tamper: Betrag/Betreff eines Eintrags ändern → Verifikation MUSS fehlschlagen.
const tampered = JSON.parse(JSON.stringify(manifest));
tampered.items[0].subject = "GEFÄLSCHT";
const vt = await verifyManifest(tampered);
ok(!vt.ok, `Manipulierter Eintrag erkannt (${vt.reason})`);

// Tamper: einen Beleg aus der Mitte entfernen → Kette bricht.
const removed = JSON.parse(JSON.stringify(manifest));
removed.items.splice(0, 1);
const vr = await verifyManifest(removed);
ok(!vr.ok, "Entfernter Beleg bricht die Kette");

// CSV-Export enthält Kopf + Zeilen.
const csv = manifestToCsv(manifest);
ok(csv.startsWith("Lfd;Datum;Absender") && csv.split("\r\n").length === manifest.count + 1, "CSV-Export mit Kopf + je Beleg eine Zeile");

// Beleg-Hash aus Dateihashes ist reihenfolge-unabhängig.
const c1 = await belegHashFromFiles([h1, h2]);
const c2 = await belegHashFromFiles([h2, h1]);
ok(c1 === c2, "Beleg-Hash unabhängig von Datei-Reihenfolge");

console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen`);
process.exit(fail ? 1 : 0);
