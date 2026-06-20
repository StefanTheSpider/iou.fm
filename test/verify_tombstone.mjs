// Verifikation der Lösch-Merker (Tombstones): Was gelöscht wurde, darf NICHT über die
// additive Sync-Zusammenführung wieder reinkommen – für ALLE Datentypen (Rechnungen,
// Erstattungen, Konten, Lieferanten, Batches).
//
// HINWEIS: Diese Datei spiegelt die reine Merge-Logik aus src/lib/vault.js (mergeShared).
// vault.js selbst importiert Tauri-/Browser-Module und ist in Node nicht direkt ladbar,
// deshalb wird die Logik hier 1:1 nachgebildet. Bei Änderungen an mergeShared mitziehen.

const indexById = (arr = []) => { const m = new Map(); for (const x of arr) if (x && x.id != null) m.set(x.id, x); return m; };
function unionById(a = [], b = []) { const m = indexById(a); for (const x of b || []) if (x && x.id != null) m.set(x.id, x); return Array.from(m.values()); }
function mergeShared(localData, shared) {
  const lohn = (localData.batches || []).filter((b) => b.kind === "lohn");
  const localNonLohn = (localData.batches || []).filter((b) => b.kind !== "lohn");
  const deletedIds = Array.from(new Set([...(localData.deletedIds || []), ...(shared.deletedIds || [])])).slice(-10000);
  const tomb = new Set(deletedIds);
  const alive = (arr) => arr.filter((x) => !(x && x.id != null && tomb.has(x.id)));
  return {
    ...localData,
    accounts: alive(unionById(localData.accounts, shared.accounts)),
    suppliers: alive(unionById(localData.suppliers, shared.suppliers)),
    refunds: alive(unionById(localData.refunds, shared.refunds)),
    invoices: alive(unionById(localData.invoices, shared.invoices)),
    batches: [...alive(unionById(localNonLohn, shared.batches)), ...lohn],
    deletedIds,
  };
}

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log(`${c ? "✓" : "✗"} ${m}`); };
const has = (arr, id) => arr.some((x) => x.id === id);

// Lokal gelöscht (Tombstone gesetzt), Hub/anderes Gerät hat die Einträge noch.
const local = {
  invoices: [{ id: "inv-keep", creditorName: "woopla GmbH" }],
  refunds: [{ id: "ref-keep", customerName: "Erika" }],
  accounts: [{ id: "acc-keep" }],
  suppliers: [{ id: "sup-keep" }],
  batches: [],
  deletedIds: ["inv-test", "ref-daniel", "acc-test", "sup-test"],
};
const hub = {
  invoices: [{ id: "inv-keep", creditorName: "woopla GmbH" }, { id: "inv-test", creditorName: "Testrechnung" }],
  refunds: [{ id: "ref-keep" }, { id: "ref-daniel", customerName: "Daniel Ramos Fortes" }],
  accounts: [{ id: "acc-keep" }, { id: "acc-test" }],
  suppliers: [{ id: "sup-keep" }, { id: "sup-test" }],
  batches: [],
  deletedIds: [],
};

const m = mergeShared(local, hub);
ok(!has(m.invoices, "inv-test"), "Gelöschte Testrechnung kommt NICHT zurück");
ok(has(m.invoices, "inv-keep"), "Echte Rechnung bleibt erhalten");
ok(!has(m.refunds, "ref-daniel"), "Daniel Ramos Fortes kommt NICHT zurück");
ok(has(m.refunds, "ref-keep"), "Echte Erstattung bleibt erhalten");
ok(!has(m.accounts, "acc-test"), "Gelöschtes Testkonto kommt nicht zurück");
ok(!has(m.suppliers, "sup-test"), "Gelöschter Test-Lieferant kommt nicht zurück");

// Mehrfaches Mergen (mehrere Deploys/Pulls) bleibt stabil.
let m2 = mergeShared(m, hub);
m2 = mergeShared(m2, hub);
ok(!has(m2.invoices, "inv-test") && !has(m2.refunds, "ref-daniel"), "Auch nach mehreren Deploys/Pulls keine Resurrection");

// Bezahlte/erledigte Einträge, die NIE gelöscht wurden, bleiben immer erhalten.
const localPaid = { invoices: [{ id: "inv-paid", status: "erledigt" }], deletedIds: [], batches: [] };
const hubPaid = { invoices: [{ id: "inv-paid", status: "erledigt" }], deletedIds: [], batches: [] };
ok(has(mergeShared(localPaid, hubPaid).invoices, "inv-paid"), "Bezahlte Rechnung bleibt (nie getombstonet)");

// Neu-Erfassung mit neuer ID wird vom Tombstone NICHT blockiert.
const reimport = mergeShared({ invoices: [{ id: "inv-NEU" }], deletedIds: ["inv-test"], batches: [] }, hub);
ok(has(reimport.invoices, "inv-NEU"), "Neu erfasste Rechnung (neue ID) bleibt sichtbar");

console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen`);
process.exit(fail ? 1 : 0);
