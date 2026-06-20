// Revisionssichere E-Mail-/Beleg-Aufbewahrung.
//
// Ziel: Bestellbestätigungen & sonstige eingehende Belege unveränderbar, vollständig und
// nachvollziehbar archivieren – mit zwei harten Eigenschaften:
//   1) Manipulations-Evidenz: jeder Beleg bekommt einen SHA-256-Inhalts-Hash; die Belege
//      werden zu einer Hash-KETTE versiegelt (jeder Eintrag bindet den vorherigen ein).
//      Ändert/entfernt jemand auch nur einen Beleg, bricht die Kette und das Siegel stimmt
//      nicht mehr – das ist beim Export sofort prüfbar.
//   2) Keine Duplikate: Dedup über den Inhalts-Hash. Dieselbe E-Mail/Bestellbestätigung,
//      auch doppelt weitergeleitet, ergibt denselben Hash und damit GENAU EINEN Eintrag.
//
// Hinweis zur Ehrlichkeit: Echte GoBD-Revisionssicherheit erfordert zusätzlich
// unveränderbaren Speicher + Verfahrensdokumentation. Dieses Modul liefert die starke
// kryptografische Manipulations-Evidenz und einen prüfbaren, versiegelten Export.

const ZERO = "0".repeat(64);
const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

export async function sha256Hex(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return hex(await crypto.subtle.digest("SHA-256", u8));
}
export async function sha256HexOfString(str) { return sha256Hex(enc.encode(String(str))); }

// Beleg-Hash aus den Hashes seiner Dateien (deterministisch, sortiert).
export async function belegHashFromFiles(fileHashes) {
  return sha256HexOfString((fileHashes || []).slice().sort().join("|"));
}

// Dedup über den Inhalts-Hash. Erste Vorkommen bleiben „primär", weitere sind Duplikate.
// entries: [{ belegId, hash, ... }]
export function dedupeByHash(entries = []) {
  const seen = new Map();           // hash -> primärer Eintrag
  const unique = []; const duplicates = [];
  for (const e of entries) {
    if (!e || !e.hash) continue;
    if (seen.has(e.hash)) {
      duplicates.push({ ...e, duplicateOf: seen.get(e.hash).belegId });
    } else {
      seen.set(e.hash, e);
      unique.push(e);
    }
  }
  return { unique, duplicates };
}

// Kanonische Felder eines Eintrags (für den Eintrags-Hash – nur inhaltsrelevante Daten).
const entryCore = (e) => JSON.stringify({
  hash: e.hash, from: e.from || "", subject: e.subject || "", date: e.date || "",
  files: (e.files || []).map((f) => ({ name: f.name, sha256: f.sha256 })), archivedAt: e.archivedAt || "",
});

// Versiegeltes Manifest aus (bereits deduplizierten) Einträgen. Reihenfolge = Archivierung
// (append-only). Jeder Eintrag: entryHash + Kettenhash (bindet den vorherigen ein).
export async function buildSealedManifest(entries = []) {
  const sorted = entries.slice().sort((a, b) =>
    (a.archivedAt || "").localeCompare(b.archivedAt || "") || (a.hash || "").localeCompare(b.hash || ""));
  let prev = ZERO;
  const items = [];
  for (const e of sorted) {
    const entryHash = await sha256HexOfString(entryCore(e));
    const chainHash = await sha256HexOfString(prev + entryHash);
    items.push({ seq: items.length + 1, belegId: e.belegId, from: e.from || "", subject: e.subject || "",
      date: e.date || "", files: e.files || [], hash: e.hash, archivedAt: e.archivedAt || "",
      entryHash, prevChainHash: prev, chainHash });
    prev = chainHash;
  }
  return { app: "iou.fm", kind: "belege-revisionssicher-manifest", v: 1,
    createdAt: new Date().toISOString(), count: items.length, sealHash: prev, items };
}

// Prüft Manifest auf Unversehrtheit: jeder Eintrags-Hash + die ganze Kette + Siegel.
export async function verifyManifest(manifest) {
  if (!manifest || manifest.kind !== "belege-revisionssicher-manifest" || !Array.isArray(manifest.items)) {
    return { ok: false, reason: "Kein gültiges Belege-Manifest." };
  }
  let prev = ZERO;
  for (const it of manifest.items) {
    const entryHash = await sha256HexOfString(entryCore(it));
    if (entryHash !== it.entryHash) return { ok: false, brokenSeq: it.seq, reason: `Beleg #${it.seq} wurde verändert.` };
    const chainHash = await sha256HexOfString(prev + entryHash);
    if (chainHash !== it.chainHash) return { ok: false, brokenSeq: it.seq, reason: `Kette bei #${it.seq} unterbrochen (Beleg entfernt/umsortiert?).` };
    prev = chainHash;
  }
  if (prev !== manifest.sealHash) return { ok: false, reason: "Siegel stimmt nicht – Archiv wurde verändert." };
  return { ok: true, count: manifest.items.length, sealHash: manifest.sealHash };
}

// Manifest als menschenlesbare CSV (für den Steuerberater zusätzlich zur JSON-Datei).
export function manifestToCsv(manifest) {
  const head = "Lfd;Datum;Absender;Betreff;Dateien;SHA256-Beleg;Archiviert am;Kettenhash";
  const esc = (s) => `"${String(s ?? "").replace(/"/g, '""')}"`;
  const rows = (manifest.items || []).map((it) =>
    [it.seq, it.date, it.from, it.subject, (it.files || []).map((f) => f.name).join(" | "), it.hash, it.archivedAt, it.chainHash]
      .map(esc).join(";"));
  return [head, ...rows].join("\r\n");
}
