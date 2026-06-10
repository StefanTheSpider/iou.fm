// Neutraler Demo-Datensatz für den Owner-Modus (Vorführungen/Screenshots).
// Wird NUR im Speicher verwendet, nie gespeichert oder synchronisiert.
export const DEMO_DATA = {
  accounts: [
    { id: "demo-a1", label: "Beispiel Geschäftskonto", iban: "DE02120300000000202051", bic: "BYLADEM1001", holder: "Demo GmbH" },
    { id: "demo-a2", label: "Beispiel Reisekonto", iban: "DE02500105170137075030", bic: "INGDDEFFXXX", holder: "Demo GmbH" },
  ],
  suppliers: [
    { id: "demo-s1", name: "Muster Veranstaltungen GmbH", iban: "DE02100500000054540402", bic: "BELADEBEXXX" },
    { id: "demo-s2", name: "Beispiel Hotel KG", iban: "DE02300209000106531065", bic: "CMCIDEDDXXX" },
  ],
  gfIbans: [],
  refunds: [
    { id: "demo-r1", orderNumber: "10001", name: "Erika Mustermann", iban: "DE02120300000000202051", amountCents: 12900, reason: "Stornierung", zahlart: "Kreditkarte" },
    { id: "demo-r2", orderNumber: "10002", name: "Max Beispiel", iban: "DE02500105170137075030", amountCents: 7400, reason: "Teilerstattung", zahlart: "PayPal" },
  ],
  batches: [
    { id: "demo-b1", kind: "erstattung", filename: "Erstattungen_Demo.xml", accountLabel: "Beispiel Geschäftskonto",
      execDate: "2026-06-01", sumCents: 20300, count: 2, payments: [{ name: "Erika Mustermann" }, { name: "Max Beispiel" }], xml: "<Document/>" },
  ],
  shopify: {},
  branding: {},
  config: { payoutMode: "erstattung", setupComplete: true, modules: { rechnung: false } },
};
