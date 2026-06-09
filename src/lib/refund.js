// Erstattungsbetrag berechnen.
// Drei Modi – passend zum bisherigen Storno-Sheet:
//   "full"  -> 100 % erstatten (keine Gebühr)
//   "fee"   -> mit Stornogebühr: value = Gebühr in % -> erstattet = bezahlt - Gebühr
//   "fixed" -> fester Erstattungsbetrag in Cent (value = EUR-Cent)

export const REFUND_MODES = [
  { id: "full", label: "Voll (100 %)" },
  { id: "fee", label: "Mit Stornogebühr %" },
  { id: "fixed", label: "Fester Betrag" },
];

export function computeRefund({ paidCents, mode, value }) {
  const paid = Math.max(0, Math.round(paidCents || 0));
  if (mode === "full") {
    return { refundCents: paid, keptCents: 0, valid: paid > 0 };
  }
  if (mode === "fee") {
    const fee = Number(value);
    if (!isFinite(fee) || fee < 0 || fee > 100)
      return { refundCents: 0, keptCents: paid, valid: false, error: "Gebühr 0–100 %" };
    const refund = Math.round((paid * (100 - fee)) / 100);
    return { refundCents: refund, keptCents: paid - refund, valid: refund > 0, feePct: fee };
  }
  if (mode === "fixed") {
    const fixed = Math.round(Number(value));
    if (!isFinite(fixed) || fixed <= 0)
      return { refundCents: 0, keptCents: paid, valid: false, error: "Betrag > 0 nötig" };
    return {
      refundCents: fixed,
      keptCents: paid - fixed,
      valid: true,
      warning: fixed > paid ? "Erstattung größer als gezahlt" : null,
    };
  }
  return { refundCents: 0, keptCents: paid, valid: false, error: "unbekannter Modus" };
}
