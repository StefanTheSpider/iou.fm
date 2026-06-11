# iou.fm — Bedienungsanleitung

**IBAN · Order · Überweisung** — sichere, Ende-zu-Ende-verschlüsselte SEPA-Zahlungs-App für Löhne, Erstattungen und Rechnungen.
Entwickelt von fork and merge UG. Stand: v0.2.9.

---

## 1. Was iou.fm macht (und was nicht)

iou.fm erstellt **SEPA-Dateien (pain.001)** für Überweisungen und verwaltet die zugehörigen Vorgänge:

- **Löhne** aus DATEV-PDF einlesen und als Sammelüberweisung auszahlen
- **Erstattungen** (z. B. Ticket-Rückzahlungen) – auch mit Shop-Import und Stornogebühr
- **Rechnungen** per PDF einlesen und an Lieferanten zahlen
- **Rückbuchungen** (Chargebacks) aus Shopify im Blick behalten
- **Buchhaltung**: Stornos/Erstattungen kategorisiert exportieren und monatlich an den Steuerberater mailen

**Wichtig:** iou.fm verbindet sich **nicht** direkt mit deiner Bank. Es erzeugt eine Datei, die du im Online-Banking deiner Bank importierst. Dadurch ist es **mit allen SEPA-fähigen Banken** nutzbar.

**Sicherheit:** Alle Daten sind **Ende-zu-Ende verschlüsselt** – selbst der Server (und der Anbieter) kann sie nicht lesen. **Löhne** verlassen das Gerät nie und werden nicht synchronisiert.

---

## 2. Die Rollen im Überblick

| Funktion | Mitarbeiter | Admin | Owner |
|---|:---:|:---:|:---:|
| Anmelden, Daten pflegen | ✓ | ✓ | ✓ |
| Erstattungen / Rechnungen **erfassen** | ✓ | ✓ | ✓ |
| Archiv ansehen | ✓ | ✓ | ✓ |
| **SEPA-Datei erstellen** (auszahlen) | – | ✓ | ✓ |
| **Löhne** sehen & verarbeiten | – | ✓ | ✓ |
| Stammdaten (Konten, Benutzer, Module, Shopify, Buchhalter, Branding) | – | ✓ | ✓ |
| Rückbuchungen / Stornos-Export | – | ✓ | ✓ |
| **Owner-Modus** (Live-Vorschau aller Modi) | – | – | ✓ |
| **Support-Zugang** zu Kundenkonten | – | – | ✓ |

- **Mitarbeiter (user):** bereitet Vorgänge vor und pflegt Daten – kann aber **keine Zahlungen auslösen** (Vier-Augen-Prinzip) und sieht **keine Löhne**.
- **Admin:** der normale Firmen-Vollzugriff.
- **Owner:** der Firmengründer/Anbieter – zusätzlich Owner-Modus und Support-Zugang.

---

## 3. Erste Schritte

### 3.1 Installation
- **Download:** stets aktuelle Version auf der Download-Seite bzw. github.com/StefanTheSpider/iou.fm/releases/latest
- **macOS:** `.dmg` öffnen → iou.fm in „Programme" ziehen. Beim ersten Start: Rechtsklick auf iou.fm → **„Öffnen"** → im Dialog erneut „Öffnen". (Falls blockiert: Systemeinstellungen → Datenschutz & Sicherheit → „Dennoch öffnen".)
- **Windows:** Setup-`.exe` ausführen → bei „Windows hat Ihren PC geschützt": „Weitere Informationen" → „Trotzdem ausführen".
- **Updates** kommen danach automatisch in der App.

### 3.2 Anmelden
- Mit **Benutzername + Passwort** anmelden. Das Passwort entschlüsselt deinen Datentresor – **bei Verlust sind die Daten nicht wiederherstellbar**, also sicher aufbewahren.

### 3.3 Ersteinrichtung (nur Admin/Owner)
Unter **Stammdaten**:
1. **Auftraggeberkonten** anlegen (Firmen-IBAN, von der überwiesen wird). BIC wird automatisch geprüft/ergänzt.
2. **Module** wählen: zweites Modul „Erstattungen" oder „Sammelüberweisung"; optional „Rechnungen (Zahlungen)" aktivieren.
3. **Benutzer** anlegen (Mitarbeiter/Admins).
4. Optional: **Shopify**-Zugang, **Buchhalter-Monatsversand**, **Darstellung** (White-Label).

---

## 4. Module – Schritt für Schritt

### 4.1 Löhne (Admin/Owner)
1. **DATEV-Abstimmliste (PDF)** per Klick laden – Empfänger, IBAN, Betrag werden erkannt.
2. Zeilen prüfen, ggf. abwählen.
3. **Auftraggeberkonto** + Ausführungsdatum wählen → **SEPA-Datei erstellen**.
4. Datei wird heruntergeladen und liegt im **Archiv**.
> Löhne sind streng vertraulich: nur Admins/Owner, nie synchronisiert, nie im Archiv für Mitarbeiter.

### 4.2 Erstattungen / Sammelüberweisung (alle erfassen, Admin/Owner zahlen)
1. **Bestellnummer** eingeben → „Aus Shopify laden" (Kunde, Betrag, Zahlart automatisch) **oder** „+ Leere Zeile" manuell.
2. Erstattungsart wählen: Voll, mit Stornogebühr %, oder fester Betrag.
3. **Interner Kommentar** (Grund der Erstattung) eintragen – für die Buchhaltung.
4. Auswählen → **SEPA-Datei erstellen** (nur Admin/Owner).
> **Doppelzahlungs-Schutz:** Wird eine bereits erstattete oder stornierte Bestellung geladen, erscheint eine rote Warnung. Nur mit „Trotzdem hinzufügen" landet sie im Eintrag.

### 4.3 Rechnungen (alle erfassen, Admin/Owner zahlen)
1. **Rechnungs-PDFs laden** (mehrere gleichzeitig). E-Rechnungen (ZUGFeRD/XRechnung) werden exakt gelesen, sonst per Mustererkennung (IBAN, Betrag, Rechnungsnr., Fälligkeit, Lieferant).
2. **Lieferanten-Gedächtnis:** bekannte IBAN füllt Name/BIC automatisch.
3. Felder prüfen/korrigieren, Auswählen → **SEPA-Datei erstellen**.
> **Doppelzahlungs-Schutz** über die Rechnungsnummer. Optional in den Einstellungen: Fälligkeitsdatum steuert das Ausführungsdatum, Skonto-Abzug, Vier-Augen-Prinzip.

### 4.4 Rückbuchungen (Admin/Owner)
- Zeigt **offene Zahlungsreklamationen/Chargebacks aus Shopify** (Anfrage der Bank bzw. echte Rückbuchung) mit Status – damit ihr fristgerecht **widersprechen** könnt.
- KPI-Leiste: offen, gewonnen, verloren, **Gewinnquote** – getrennt nach Anfragen und echten Rückbuchungen, plus **Historie pro Jahr**.
- Aktualisiert sich nächtlich; gelöste Fälle verschwinden automatisch.

### 4.5 Stornos & Erstattungen (Admin/Owner)
- Aus Shopify abgeglichene **Stornierungen und Rückerstattungen**, kategorisiert (Sport DE / Konzerte DE / Österreich / Reisen).
- Eine Bestellung, die storniert **und** erstattet wurde, erscheint als **eine** Zeile („Storniert & erstattet") – keine Doppelzählung.
- **„Excel für Buchhaltung"** exportiert alles nach Kategorie, inkl. Verwendungszweck und ursprünglich gezahltem Betrag.

### 4.6 Archiv (alle ansehen, Export Admin/Owner)
- Historie aller erzeugten SEPA-Dateien (Erstattungen, Sammelüberweisung, Rechnungen – Löhne nur für Admin/Owner).
- Filter nach Typ, Datum, Konto, Suche.
- Export als **DATEV-Buchungsstapel** oder **einfache CSV** (mit Umlaut-sicherem UTF-8).

### 4.7 Stammdaten (Admin/Owner)
- **Auftraggeberkonten**, **Lieferanten**, **Benutzerverwaltung**.
- **Module** an/aus, zweites Modul wählen.
- **Shopify-Anbindung:** Read-only-Token + Tags (für Nacht-Abgleich von Stornos/Refunds/Rückbuchungen).
- **Buchhalter / Steuerberater – Monatsversand:** E-Mail + CC eintragen, aktivieren; am Monatsende (letzter Tag, 23:59) geht die CSV automatisch raus. „Testmail jetzt senden" zum Prüfen.
- **Darstellung (White-Label):** Name, Logo, Farben.

### 4.8 Owner-Modus (nur Owner)
- ⚙︎-Knopf unten rechts: live umschalten zwischen **Ansicht (Admin/Mitarbeiter)**, **Auszahlungsmodus**, **Modulen** und **Live/Demo-Daten** – reine Vorschau, ändert nichts an echten Daten.

### 4.9 Support-Zugang zu Kundenkonten (nur Owner, White-Label-Vertrieb)
1. Im Tab **Support**: SUPPORT_KEY hinterlegen, Schlüsselpaar erzeugen.
2. **Zugang anfragen** (Mandanten-ID des Kunden, Umfang, Gültigkeit).
3. Der **Kunde bestätigt** in seiner App (E2E-Schlüssel wird befristet für den Support freigegeben).
4. **„Konto öffnen"** → befristete Support-Sitzung (rote Leiste), „Sitzung beenden" führt zurück. Löhne bleiben dabei immer ausgeschlossen.

---

## 5. SEPA-Datei in die Bank importieren

iou.fm erzeugt eine **.xml-Datei (pain.001)** und legt sie in „Downloads" ab. So zahlst du sie aus:

1. Online-Banking deiner Bank öffnen (oder Banking-Software wie SFirm/StarMoney/Profi cash).
2. Funktion **„Sammelüberweisung" / „SEPA-Datei importieren" / „Datei-Upload"** suchen.
3. Die erzeugte `.xml` auswählen und hochladen.
4. Die Sammelüberweisung wie gewohnt **prüfen und mit TAN freigeben**.

> Funktioniert mit allen SEPA-fähigen Banken. Lehnt eine Bank die Datei wegen der Format-Version ab, kann der Anbieter die pain-Version (z. B. .03 statt .09) umstellen.

---

## 6. Schutz- und Sicherheitsfunktionen

- **Ende-zu-Ende-Verschlüsselung:** Daten nur mit deinem Passwort lesbar; Server/Anbieter sehen nichts.
- **Löhne strikt lokal:** nie synchronisiert, nie für Mitarbeiter sichtbar, nie im Archiv anderer.
- **Doppelzahlungs-Warnung:** bei bereits erstatteten/stornierten Bestellungen und bereits bezahlten Rechnungen.
- **Vier-Augen-Prinzip:** Mitarbeiter erfassen, nur Admins zahlen aus.
- **IBAN-Prüfung** (Prüfsumme) + automatische BIC-Ableitung.

---

## 7. Häufige Fragen

**Die App lässt sich auf dem Mac nicht öffnen.** Beim ersten Mal Rechtsklick → „Öffnen", dann „Dennoch öffnen" in Datenschutz & Sicherheit. (Sobald die App notariell signiert ist, entfällt das.)

**Muss ich Updates herunterladen?** Nein – die App aktualisiert sich automatisch.

**Sieht der Steuerberater alle Daten?** Nein, nur die monatliche Stornos/Erstattungen-CSV bzw. den manuellen Export.

**Können mehrere Personen gleichzeitig arbeiten?** Ja – Daten synchronisieren automatisch (außer Löhne, die bleiben lokal beim Admin).

**Brauche ich eine bestimmte Bank?** Nein – jede SEPA-fähige Bank, die Datei-Import unterstützt.

---

*Bei Fragen oder Problemen: Daumen-runter-Feedback in der App oder Kontakt zum Anbieter (fork and merge UG).*
