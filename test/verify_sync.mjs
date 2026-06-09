// Prüft die reine Sync-Logik (ohne Krypto/Netz): Was wird geteilt, was bleibt
// lokal, wie wird zusammengeführt, Invite-Code-Roundtrip.
import { sharedSubset, mergeShared } from "../src/lib/vault.js";
import { buildInviteCode, parseInviteCode } from "../src/lib/sync.js";

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error("  ✗ " + m); } };

const local = {
  accounts: [{ id: "a1", name: "Hauptkonto" }],
  suppliers: [{ id: "s1", name: "Lieferant" }],
  refunds: [{ id: "r1", betrag: 100 }],
  gfIbans: [{ iban: "DE..", hold: true }],            // LOHN-nah -> bleibt lokal
  shopify: { domain: "x.myshopify.com" },
  branding: { name: "Muster" },
  config: { payoutMode: "erstattung", setupComplete: true },
  batches: [
    { id: "b-lohn", kind: "lohn", payments: [{ name: "Marek" }] },   // bleibt lokal
    { id: "b-erst", kind: "erstattung", payments: [{ name: "Kunde" }] }, // wird geteilt
  ],
};

// --- sharedSubset: Löhne raus -----------------------------------------------
const shared = sharedSubset(local);
ok(!("gfIbans" in shared), "sharedSubset: gfIbans wird NICHT geteilt");
ok(shared.batches.length === 1 && shared.batches[0].id === "b-erst", "sharedSubset: nur Nicht-Lohn-Batches");
ok(!shared.batches.some((b) => b.kind === "lohn"), "sharedSubset: kein Lohn-Batch im geteilten Satz");
ok(shared.accounts[0].id === "a1" && shared.refunds[0].id === "r1", "sharedSubset: Stammdaten + Erstattungen dabei");

// --- mergeShared: entfernte geteilte Daten rein, Löhne lokal erhalten --------
const remoteShared = {
  accounts: [{ id: "a1", name: "Hauptkonto NEU" }, { id: "a2", name: "Zweitkonto" }],
  suppliers: [],
  refunds: [{ id: "r2", betrag: 200 }],
  shopify: { domain: "y.myshopify.com" },
  branding: { name: "Muster", primary: "#10b981" },
  config: { payoutMode: "erstattung", setupComplete: true, extra: 1 },
  batches: [{ id: "b-erst", kind: "erstattung", payments: [{ name: "Kunde" }] },
            { id: "b-sammel", kind: "sammel", payments: [{ name: "Firma" }] }],
};
const merged = mergeShared(local, remoteShared);

ok(merged.gfIbans.length === 1, "mergeShared: lokale gfIbans (Lohn) bleiben erhalten");
ok(merged.batches.some((b) => b.id === "b-lohn"), "mergeShared: lokaler Lohn-Batch bleibt erhalten");
ok(merged.batches.some((b) => b.id === "b-sammel"), "mergeShared: entfernter Sammel-Batch kommt dazu");
ok(merged.accounts.find((a) => a.id === "a1").name === "Hauptkonto NEU", "mergeShared: entfernte Version gewinnt (a1)");
ok(merged.accounts.some((a) => a.id === "a2"), "mergeShared: neues Konto a2 übernommen");
ok(merged.refunds.length === 2, "mergeShared: Erstattungen vereinigt (r1 lokal + r2 entfernt)");
ok(merged.branding.primary === "#10b981", "mergeShared: Branding entfernt übernommen");
ok(merged.config.extra === 1 && merged.config.setupComplete === true, "mergeShared: config gemischt");

// Lohn-Batch darf durch keinen Merge in den geteilten Satz wandern
ok(!sharedSubset(merged).batches.some((b) => b.kind === "lohn"), "Invariante: Lohn bleibt auch nach Merge lokal");

// --- Invite-Code Roundtrip ---------------------------------------------------
const inv = { hubUrl: "https://hub.example.com", tenantId: "123e4567-e89b-12d3-a456-426614174000", accessKey: "abc123KEY" };
const code = buildInviteCode(inv);
const back = parseInviteCode(code);
ok(back.hubUrl === inv.hubUrl && back.tenantId === inv.tenantId && back.accessKey === inv.accessKey, "Invite-Code: Roundtrip");
let threw = false; try { parseInviteCode("kein-code"); } catch { threw = true; }
ok(threw, "Invite-Code: kaputter Code wirft Fehler");

console.log(`\nSync-Logik-Tests: ${pass} ok, ${fail} fehlgeschlagen`);
process.exit(fail ? 1 : 0);
