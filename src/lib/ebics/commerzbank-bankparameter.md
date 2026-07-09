# Commerzbank EBICS – Bankparameter (Brief vom 18. Juni 2026)

Quelle: Commerzbank-Schreiben „Bankparameter für die Nutzung EBICS" an
**Tix + Travel GmbH, z. H. Herr Marek Zielinski, Gertigstr. 4, 22303 Hamburg**.
Diese Werte sind die offizielle Grundlage für die **HPB-Verifikation** (Fingerabdruck der
Bank-Schlüssel) und die Zugangs-Konfiguration.

## Zugangsdaten
| Feld | Wert |
|---|---|
| Kunden-ID (PartnerID) | `Q6890042` |
| Teilnehmer-ID (UserID) | `ZIELINMA` (Marek Zielinski) |
| EBICS-Hostname (HostID) | `CBKEBIX1` |
| URL | `https://ebicsveu.commerzbank.com/ebicsweb/ebicsweb` |
| Port | `443` |

## Öffentliche Bank-Schlüssel (SHA-256-Fingerabdrücke)
Für die HPB-Prüfung wird der Hash des von der Bank gelieferten Schlüssels mit dem
hier gedruckten Wert verglichen. Die App-Schlüsselaufträge (INI/HIA/HPB) laufen über
**H004** → maßgeblich ist der H003/H004-Block.

### H003 und H004  (maßgeblich für die aktuelle HPB-Implementierung)
- Authentifikation **X002**: `70F0 2F59 9196 371D 59BA 3A38 BC13 7335 8A46 6EE9 3B1E DDC9 2805 CFD5 1F74 9AEA`
- Verschlüsselung **E002**: `70F0 2F59 9196 371D 59BA 3A38 BC13 7335 8A46 6EE9 3B1E DDC9 2805 CFD5 1F74 9AEA`

### H005 mit Schlüsseln
- Authentifikation **X002**: `453D 823E F4FA F4B2 010C 28EA D809 E685 B82A ACD8 CCFE 18CA 0228 3A3B F9BC A237`
- Verschlüsselung **E002**: `453D 823E F4FA F4B2 010C 28EA D809 E685 B82A ACD8 CCFE 18CA 0228 3A3B F9BC A237`

### H005 mit Zertifikaten
- Zertifikat Authentifikation **X002**: `4C4D EFBA 76AA 67D1 D1B2 893F 48DF 09E8 0B3F 42DF 835F A57B A9D3 71DA F562 64D6`
- Zertifikat Verschlüsselung **E002**: `4C4D EFBA 76AA 67D1 D1B2 893F 48DF 09E8 0B3F 42DF 835F A57B A9D3 71DA F562 64D6`

## Verfahrensschritte / Fristen (aus dem Brief)
1. Zugangsdaten in die Software aufnehmen, Benutzer anlegen, Schlüssel erzeugen.
2. INI/HIA elektronisch einreichen (öffentliche Schlüssel an die Bank).
3. **Initialisierungsprotokoll (INI-Brief) drucken, unterschreiben** und innerhalb von
   **10 Kalendertagen nach Initialisierung** an die Bank senden:
   - Fax: **+49 (0)69 405652785**
   - E-Mail: **ceriini@commerzbank.com**
   - Post: ComTS Mitte GmbH, DARWIN Scanning, Auftragstyp 22170, 99077 Erfurt
4. Erst **nach Eingang des unterschriebenen Protokolls** schaltet die Bank den Teilnehmer frei.

**Weitere Fristen:** Ohne Erst-Initialisierung binnen **60 Tagen** wird der Zugang gesperrt;
bei **180 Tagen** ohne Nutzung wird er deaktiviert.

> Hinweis: Der Brief ist vom 18.06.2026. Prüfen, ob das unterschriebene
> Initialisierungsprotokoll bereits raus ist – die 10-Tage-Frist ab Initialisierung ist eng.
