# iou.fm – Bedienungsanleitung

Alles, was du zum Loslegen brauchst – einfach erklärt, Schritt für Schritt.

**Was ist iou.fm?** Dein Werkzeug, um Überweisungen einmal sauber vorzubereiten und dann gesammelt auszuzahlen – Gehälter, Kundenerstattungen und Lieferantenrechnungen. Die App erstellt daraus eine fertige **SEPA-Datei**, die du in deinem Online-Banking hochlädst (funktioniert mit jeder Bank). Im *Bank*-Tarif kannst du direkt aus der App an die Bank senden. Alle Daten liegen **verschlüsselt** auf deinem Gerät.

> Tipp: Oben rechts in der App gibt es jederzeit den Button **📖 Anleitung**.

---

## 1 · In 5 Minuten startklar

**Installieren**
- Neueste Version auf der Download-Seite holen.
- macOS: .dmg öffnen, iou.fm in „Programme" ziehen. Erststart: Rechtsklick → „Öffnen" → „Öffnen".
- Windows: Setup starten → „Weitere Informationen" → „Trotzdem ausführen".
- Updates kommen automatisch.

**Anmelden**
- Beim ersten Mal über „Neue Firma einrichten" dein Admin-Konto anlegen. Danach Login mit Benutzername + Passwort.
- ⚠️ Das Passwort entschlüsselt deine Daten – bei Verlust **nicht** wiederherstellbar. Sicher aufbewahren.

**Touch ID / Windows Hello:** Nach dem ersten Login kannst du den Fingerabdruck aktivieren – danach genügt beim Start der Finger.

**Hell oder dunkel anzeigen:** Oben rechts schaltest du mit „☀️ Hell" / „🌙 Dunkel" die Anzeige um. Diese Wahl gilt nur für dich auf diesem Gerät – sie ändert nichts bei deinen Kolleginnen und Kollegen.

**Ersteinrichtung (Admin) unter „Stammdaten":**
1. Auftraggeberkonto anlegen (dein Firmenkonto, von dem überwiesen wird).
2. Module wählen (Erstattungen oder Sammelüberweisung; optional Rechnungen).
3. Mitarbeiter anlegen.
4. Optional: Shop verbinden, Steuerberater-Versand, Aussehen.

## 2 · Wer darf was (Rollen)

| Aufgabe | Mitarbeiter | Admin |
|---|:--:|:--:|
| Anmelden, Daten erfassen/pflegen | ✓ | ✓ |
| Erstattungen & Rechnungen vorbereiten | ✓ | ✓ |
| Archiv ansehen | ✓ | ✓ |
| **SEPA-Datei erstellen / auszahlen** | – | ✓ |
| **Gehälter** sehen & verarbeiten | – | ✓ |
| Stammdaten (Konten, Benutzer, Shop, Abo …) | – | ✓ |

So entsteht ein **Vier-Augen-Prinzip**: Mitarbeiter bereiten vor, nur ein Admin zahlt aus.

## 3 · Gehälter auszahlen (nur Admin)

1. Tab **Löhne** öffnen.
2. DATEV-Abrechnungs-PDF hineinziehen – Namen, IBANs, Beträge werden erkannt.
3. Zeilen prüfen (Geschäftsführer per „GF" markierbar/zurückhaltbar).
4. Konto + Ausführungsdatum → **SEPA-Lohndatei herunterladen**.

> Gehaltsdaten bleiben streng lokal – nie synchronisiert, für Mitarbeiter nicht sichtbar.

## 4 · Kunden Geld zurückzahlen (Erstattungen)

1. Tab **Erstattungen** öffnen.
2. Bestellnummer → „Aus … laden" (wenn ein Shop verbunden ist) oder „+ Leere Zeile".
3. IBAN des Kunden ergänzen.
4. Erstattungsart wählen: voll / Stornogebühr % / fester Betrag.
5. Grund im Kommentar festhalten.
6. Auswählen → als Admin SEPA-Datei erstellen.

Tipp: Über das **Suchfeld** (Bestellnummer oder Name) findest du einen Eintrag schnell. Auch im Tab **Stornos** gibt es diese Suche.

> Schutz vor Doppelzahlung: bereits erstattete/stornierte oder doppelte Bestellungen lösen eine Warnung aus.

## 5 · Lieferantenrechnungen zahlen

1. Tab **Rechnungen** öffnen, PDFs laden (E-Rechnung exakt, sonst Mustererkennung; gescannte PDFs werden per Texterkennung gelesen).
   - **Per E-Mail eingegangene Rechnungen (automatisch):** Leite eine Rechnung (PDF) an deine `belege-…@iou-tech.com` weiter. iou.fm liest sie **automatisch im Hintergrund** ein – sie ist also schon da, wenn du den Rechnungen-Tab öffnest. Ein Banner oben zeigt, wie viele Rechnungen noch **geprüft** werden müssen. Mit **„E-Mail-Eingang prüfen"** kannst du sofort nachsehen. (Belege ohne IBAN, z. B. Tickets, werden übersprungen.)
   - **Prüfen & freigeben:** Jede Rechnung hat das Feld **„Geprüft & freigegeben?"** (Standard **Nein**). Erst auf **Ja** fließt sie in die SEPA-Datei bzw. den EBICS-Versand; es wird automatisch festgehalten, **wer geprüft hat**. So wird nie etwas Ungeprüftes ausgezahlt.
   - **Wer darf prüfen/weiterleiten:** Admins immer; Mitarbeiter nur, wenn der Admin sie unter **Stammdaten → Benutzer** freischaltet. Mitarbeiter sehen außerdem **keine vom Admin geladenen Rechnungen** (auch nicht im Archiv) – nur per E-Mail eingegangene bzw. selbst geladene.
2. Lieferanten-Gedächtnis füllt bekannte IBANs automatisch.
3. Prüfen → als Admin SEPA-Datei erstellen. Im **Bank-Tarif** kannst du danach direkt **„Per EBICS an Bank senden"** – die Belege gehen dann automatisch an den Steuerberater.
4. **Schon bezahlt?** Erscheint die Warnung, kannst du die Rechnung mit **„Nur an Steuerberater weiterleiten (nicht zahlen)"** trotzdem in die Buchhaltung geben, ohne sie erneut zu überweisen.
5. **Später erneut senden:** Im **Archiv** (nur Admin) hat jeder Rechnungs-Lauf den Button **„An Steuerberater senden"** – auch Tage später und geräteübergreifend.

**Belege automatisch an den Steuerberater:** In den Stammdaten beim Modul „Rechnungen" die Option „Belege automatisch versenden" aktivieren und deine Steuerberater-E-Mail eintragen. Sobald du die SEPA-Datei erstellst, gehen die geprüften Rechnungs-PDFs automatisch per Mail an den Steuerberater. Du musst nur die E-Mail eintragen.

> Die **Rechnungsnummer steht immer im Verwendungszweck** (B2B-Zuordnung). Lädst du eine bereits bezahlte Rechnung erneut hoch, kommt sofort die Warnung „bereits bezahlt".
> Optional: Fälligkeit als Ausführungsdatum, Skonto, Vier-Augen-Prinzip.

## 6 · Online-Shop verbinden (Shopify, WooCommerce, Shopware)

- **Shopify (ein Klick):** Stammdaten → Shop-Domain eingeben → „Mit Shopify verbinden" → im Browser bestätigen. Kein Token nötig.
- **WooCommerce / Shopware:** Stammdaten → „Shop-System für den Bestell-Import" → Plattform wählen, Shop-URL + Lese-Zugangsdaten eintragen.

Nur Lese-Rechte nötig; Zugangsdaten bleiben verschlüsselt auf dem Gerät.

## 7 · Rückbuchungen & Stornos im Blick

Tab **Rückbuchungen**: offene Chargebacks mit Status/Frist + Kennzahlen (offen/gewonnen/verloren/Gewinnquote) und Jahres-Verlauf. Tab **Stornos**: abgeglichener Überblick. Nächtlich automatisch, „Jetzt abgleichen" sofort.

## 7b · Belege per E-Mail (Bestellbestätigungen & Einkäufe)

Du bekommst eine persönliche Weiterleitungs-Adresse (Stammdaten → „Belege per E-Mail"). Leitest du eine Bestellbestätigung oder Einkaufs-Mail dorthin weiter, wird sie **revisionssicher** archiviert (Original unverändert, Zeitstempel, Prüfsumme) und – wenn aktiviert – automatisch an deinen Steuerberater weitergeleitet. Du trägst nur die Ziel-E-Mail ein.

**Beleg ansehen:** Unter „Belege & Buchhaltung" auf **„Archiv anzeigen"** klicken und bei einem Eintrag auf **„Ansehen"**. Wichtig:

- **📄 PDF = der lesbare Beleg** – das öffnest du zum Anschauen/Buchen (entweder der mitgeschickte Anhang oder der von iou.fm aus dem Mail-Text erzeugte „PDF-Beleg").
- **✉️ .eml = nur das technische Original** (Roh-Nachweis für die Revisionssicherheit). In der Schnell-Vorschau erscheinen oft nur Absender/Betreff und „kein Inhalt" – das ist normal; mit „Öffnen mit Mail" wird sie normal angezeigt.

Die SHA-256-Prüfsumme wird mit angezeigt.

**Eigener Reiter „Belege · revisionssicher":** Oben in der Navigation findest du den Reiter **Belege**. Dort sind alle eingegangenen Belege unveränderbar archiviert – jeder mit Inhalts-Prüfsumme (SHA-256) und Zeitstempel. Was du hier tun kannst:

- **Doppelte E-Mails werden automatisch zusammengefasst:** Leitest du dieselbe Bestellbestätigung zweimal weiter, erscheint sie über die Prüfsumme trotzdem nur **einmal**.
- **„Versiegeltes Manifest exportieren"** erzeugt zwei Dateien (JSON + CSV) für den Steuerberater: eine lückenlose Liste aller Belege mit Prüfsummen und einer **Hash-Kette**. Wird später auch nur ein Beleg verändert oder entfernt, stimmt das Siegel nicht mehr – Manipulation ist sofort sichtbar.
- **„Integrität prüfen"** liest alle Belege neu ein und vergleicht die Prüfsummen – so siehst du jederzeit, dass nichts verändert wurde.

> Hinweis: Per Mail empfangene Belege liegen serverseitig (anders als der E2E-Tresor) – das ist bei „Mail an eine Adresse" unvermeidbar. Für die steuerliche Anerkennung gehört eine Verfahrensdokumentation dazu (Vorlage liegt bei).

## 8 · Export für den Steuerberater

Im **Archiv** liegt die Historie aller SEPA-Dateien (filterbar) – Export als DATEV-Buchungsstapel oder CSV (Umlaut-sicher). Optional: automatischer Monatsversand der Stornos-/Erstattungs-CSV per E-Mail (Stammdaten). Diese CSV enthält zu jedem Vorgang auch die **Zahlungsmethode**, mit der der Kunde ursprünglich bezahlt hat (z. B. PayPal, Kreditkarte, Klarna).

Der automatische Versand läuft **immer am Monatsende um 23:59** – unabhängig davon, ob die App gerade offen ist. Lag im Monat mindestens eine ausgeführte Bestellung vor, hängt die Mail zusätzlich das **Versand-Archiv** des Monats als zweite CSV an. Einen einzelnen Monat kannst du in den Stammdaten (Belege & Buchhaltung → Monat wählen → „Monat jetzt senden") auch manuell nachschicken.

**Eigener Reiter „Versand-Archiv":** Oben in der Navigation findest du den Reiter **Versand-Archiv**. Dort stehen alle in Shopify **ausgeführten (versendeten)** Bestellungen – je mit **Kunde, Bestellnummer, Betrag, Zahlungsmethode, Veranstaltung, Veranstaltungsdatum und Ausführungsdatum** (wann die Bestellung versendet/ausgeführt wurde). Er füllt sich automatisch beim Abgleich. Du kannst nach **Zeitraum (Monat), Zahlungsmethode und Kategorie** filtern, nach **Ausführungsdatum, Veranstaltungsdatum oder Betrag** sortieren und im Suchfeld nach Bestellnummer, Kunde oder Veranstaltung suchen – unten siehst du jeweils **Anzahl und Summe** der gefilterten Bestellungen. Über **„Als CSV exportieren"** lädst du genau die gefilterte Liste (Umlaut-sicher) in „Downloads".

## 9 · Direkt an die Bank senden (EBICS, Bank-Tarif)

1. Stammdaten → **Bankanbindung (EBICS)** aktivieren.
2. Zugangsdaten der Bank eintragen (aus dem EBICS-Vertrag).
3. **Schlüssel erzeugen** (lokal).
4. **INI-Brief drucken**, unterschreiben, an die Bank senden – danach schaltet die Bank dich frei.
5. „aktiv" setzen → Button **„Per EBICS an Bank senden"**; Freigabe über die TAN-/Banking-App deiner Bank (z. B. photoTAN, pushTAN, SecureGo).

## 10 · SEPA-Datei ins Online-Banking laden

1. Online-Banking/Banking-Software öffnen (SFirm, StarMoney, Profi cash …).
2. „Sammelüberweisung" / „SEPA-Datei importieren" wählen.
3. Die `.xml` aus „Downloads" hochladen.
4. Prüfen und mit TAN freigeben.

## 11 · Mitarbeiter & Abo

- **Mitarbeiter:** Stammdaten → „Benutzer & Zugänge". Inklusiv-Mitarbeiter je Tarif: **Basis 2 · Pro 3 · Bank 5**.
- **Tarif:** 7 Tage kostenlos testen, danach Tarif wählen (Basis/Pro/Bank), Zahlung per SEPA-Lastschrift. Mehr Plätze als **3er-Pakete** dazubuchbar. Verwalten/kündigen über „Abo verwalten".

## 12 · Sicherheit

- Ende-zu-Ende verschlüsselt – nur mit deinem Passwort lesbar.
- Gehälter bleiben lokal – nie synchronisiert.
- Doppelzahlungs-Warnung, Vier-Augen-Prinzip, IBAN-Prüfung mit BIC-Ableitung.

## 13 · Häufige Fragen

- **Bestimmte Bank nötig?** Nein – jede SEPA-fähige Bank. Direktversand braucht EBICS (Bank-Tarif).
- **App startet am Mac nicht?** Erststart per Rechtsklick → „Öffnen".
- **Updates?** Automatisch: Ist beim Anmelden eine neue Version da, installiert sie sich selbst (kurzer Lade-Hinweis), danach Neustart – einfach wieder per Touch ID anmelden. Schon eingeloggt? Dann erscheint oben der Button „Jetzt aktualisieren".
- **Sieht der Steuerberater alles?** Nein, nur die gesendete CSV.
- **Mehrere Personen gleichzeitig?** Ja – außer Gehälter (bleiben lokal).
- **Passwort vergessen?** Nicht wiederherstellbar – sicher aufbewahren.

---

*Bereitgestellt mit iou.fm · entwickelt von fork and merge UG*
