# EBICS-Modul (Bankanbindung)

Eigenständiges, opt-in Modul für die direkte Übergabe von SEPA-Aufträgen an die Bank
per EBICS, mit Freigabe über die photoTAN-/Banking-App. Bewusst von Tix-&-Travel-Spezifika
getrennt, damit es sich als verkaufbares Paket abtrennen lässt.

## Sicherheits-Grundsätze

- **Schlüssel bleiben lokal.** Die drei privaten EBICS-Schlüssel (Signatur A006, Auth X002,
  Verschlüsselung E002) werden lokal per Web Crypto erzeugt und liegen ausschließlich im
  Feld `data.ebicsKeys`. Dieses Feld ist **nicht** in `SHARED_KEYS` (vault.js) und wird
  daher nie zum Sync-Hub übertragen – E2E bleibt unangetastet.
- **Verbindungsparameter** (Host-/Kunden-/Teilnehmer-ID, URL) liegen in `config.ebics` und
  dürfen syncen; sie sind keine Geheimnisse.
- **Opt-in.** Ohne aktiven Schalter in den Einstellungen ist das Modul vollständig inert –
  keine Tabs, keine Sende-Buttons.
- **Doppelte Absicherung des Versands.** Auftrag wird lokal signiert (A006), zur Bank
  verschlüsselt (E002), über TLS gesendet – und erst nach Freigabe per photoTAN-App
  ausgeführt. Bank-seitige Auftragslimits decken den Worst Case ab.

## Status-Maschine (`config.ebics.status`)

```
uninitialized → keys_generated → ini_sent → active
```

Erst im Zustand `active` (Bank hat den INI-Brief verarbeitet, photoTAN-Freigabe eingerichtet)
ist ein echter Versand möglich.

## Dateien

| Datei           | Zweck                                                                 |
|-----------------|-----------------------------------------------------------------------|
| `keys.js`       | Lokale RSA-Schlüssel-Erzeugung + INI-Brief-Hashes (SHA-256)           |
| `iniLetter.js`  | Druckfertiger INI-Brief (HTML → PDF über Druckdialog)                 |
| `client.js`     | Gekapselte Protokoll-Schicht (Init, Upload pain.001, Status pain.002) |
| `index.js`      | Barrel-Export                                                          |

## Einrichtung (Endkunde, in den Einstellungen)

1. „Bankanbindung aktivieren" anhaken (Opt-in).
2. Zugangsdaten der Bank eintragen (aus dem EBICS-Vertrag).
3. „Schlüssel erzeugen" – lokal, verschlüsselt gespeichert.
4. „INI-Brief drucken", unterschreiben, an die Bank senden.
5. Nach Freischaltung durch die Bank „aktiv" setzen.

## Noch scharfzuschalten (nach Bank-Testzugang)

Die EBICS-3.0/H005-Envelopes in `client.js` (`sendInitialization`, `uploadPayment`,
`fetchStatus`) werden gegen den Testzugang der Bank verifiziert und dann aktiviert. Bis dahin
liefern sie klare, lokalisierte Hinweise statt eines unverifizierten Versands. Der INI-Brief-
Hash (`keys.js`) wird beim Ersteinrichten einmal gegen das Prüf-Tool der Bank abgeglichen.

## Verkaufs-Verpackung

Das Modul hat keine harte Kopplung an andere Komponenten außer:
- den Web-Crypto-Helfern (eigenständig in `keys.js` enthalten),
- der pain.001-Erzeugung (`src/lib/sepa.js`, `buildSepaXml`),
- dem Tresor-Feld `ebicsKeys` + `config.ebics`.

Für eine Auskopplung genügt es, diesen Ordner samt `EbicsSettings.jsx` und der Sende-
Integration zu übernehmen.
