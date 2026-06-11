// EBICS-Protokoll-Schicht – gekapselte Schnittstelle.
//
// Diese Schicht trennt die App sauber vom EBICS-Transport. Die App ruft nur die
// vier Methoden unten auf; die konkrete EBICS-3.0/H005-Umsetzung (Envelope bauen,
// signieren, verschlüsseln, an die Bank senden) wird beim Ersteinrichten gegen den
// Commerzbank-Testzugang verifiziert und dann hier scharfgeschaltet.
//
// Status-Maschine (config.ebics.status):
//   uninitialized → keys_generated → ini_sent → active
//
// WICHTIG: Solange der Zugang nicht "active" ist (Bank hat den INI-Brief verarbeitet
// und photoTAN-Freigabe ist eingerichtet), wird KEIN echter Versand ausgeführt.

export const EBICS_STATUS = {
  UNINITIALIZED: "uninitialized",
  KEYS_GENERATED: "keys_generated",
  INI_SENT: "ini_sent",
  ACTIVE: "active",
};

export function ebicsConfigValid(cfg) {
  if (!cfg) return false;
  return Boolean(cfg.hostId && cfg.partnerId && cfg.userId && cfg.ebicsUrl);
}

export function ebicsReadyToSend(cfg, keys) {
  return ebicsConfigValid(cfg) && cfg.status === EBICS_STATUS.ACTIVE && Boolean(keys?.signature?.priv);
}

// Menschlich lesbarer Status für die Oberfläche.
export function ebicsStatusLabel(cfg) {
  switch (cfg?.status) {
    case EBICS_STATUS.ACTIVE: return "Aktiv – bereit zum Senden";
    case EBICS_STATUS.INI_SENT: return "INI-Brief gesendet – Freischaltung durch Bank ausstehend";
    case EBICS_STATUS.KEYS_GENERATED: return "Schlüssel erzeugt – INI-Brief drucken & senden";
    default: return "Noch nicht eingerichtet";
  }
}

// Erstellt einen EBICS-Client für die übergebene Konfiguration + Schlüssel.
// `httpPost` ist eine injizierte Funktion (Tauri-HTTP), damit kein CORS-Problem entsteht
// und die Schicht testbar bleibt.
export function createEbicsClient({ cfg, keys, httpPost }) {
  function ensureConfig() {
    if (!ebicsConfigValid(cfg)) {
      throw new Error("EBICS ist nicht vollständig konfiguriert (Host-ID, Kunden-ID, Teilnehmer-ID, URL fehlen).");
    }
  }

  return {
    // INI/HIA: öffentliche Schlüssel bei der Bank einreichen (digitaler Teil der Initialisierung).
    async sendInitialization() {
      ensureConfig();
      if (!keys?.signature?.priv) throw new Error("Es wurden noch keine EBICS-Schlüssel erzeugt.");
      // TODO(scharfschalten): EBICS INI- + HIA-Auftrag aufbauen und via httpPost an cfg.ebicsUrl senden.
      // Wird beim Test gegen den Bankzugang verifiziert (H005-Envelope, A006/X002/E002).
      throw new Error("Digitale Initialisierung wird nach Erhalt der Bankparameter scharfgeschaltet. Bitte zunächst den INI-Brief drucken und an die Bank senden.");
    },

    // Bank-öffentliche Schlüssel abholen (HPB) und Fingerabdruck vergleichen.
    async fetchBankKeys() {
      ensureConfig();
      throw new Error("Bankschlüssel-Abruf (HPB) wird nach Erhalt der Bankparameter scharfgeschaltet.");
    },

    // pain.001 hochladen (BTU). Gibt eine Auftrags-/Transaktions-ID zurück.
    async uploadPayment(painXml, meta = {}) {
      ensureConfig();
      if (!ebicsReadyToSend(cfg, keys)) {
        throw new Error("EBICS-Zugang ist noch nicht aktiv. Der Auftrag kann erst nach Freischaltung durch die Bank gesendet werden.");
      }
      // TODO(scharfschalten): pain.001 mit A006 signieren, mit Bank-E002 verschlüsseln,
      // BTU-Upload via httpPost an cfg.ebicsUrl. Danach Freigabe per photoTAN-App.
      void painXml; void meta; void httpPost;
      throw new Error("Live-Versand wird nach dem Testlauf gegen den Bankzugang aktiviert.");
    },

    // Statusmeldung (pain.002) zu einem Auftrag abrufen.
    async fetchStatus(orderId) {
      ensureConfig();
      void orderId;
      throw new Error("Statusabruf (pain.002) wird nach dem Testlauf gegen den Bankzugang aktiviert.");
    },
  };
}
