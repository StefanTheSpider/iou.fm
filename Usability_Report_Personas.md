# iou.fm — Usability-Durchlauf mit simulierten Personas

*Methode: 10 fiktive Nutzer aus verschiedenen Branchen, Wissens- und „Intelligenz"-Stufen arbeiten nacheinander mit der App. Jede Reaktion ist am **tatsächlichen Code-Verhalten** geprüft (nicht erfunden). Fokus: Logik vs. Unlogik, jeder denkbare Nutzerfehler und die Reaktion der App — mit besonderem Blick auf „gibt die App bei jedem Fehler Feedback?".*

---

## Die Personas

1. **Stefan** – Gründer/Admin, Power-User, E-Commerce/Reise. Referenz.
2. **Marek** – Kollege, mittlere Kenntnisse, zieht Rechnungen rein.
3. **Heike** – Steuerberaterin, buchhaltungsstark, app-schwach.
4. **Giuseppe** – Restaurantbesitzer, gering digital, Deutsch als Zweitsprache.
5. **Meister Brandt** – Tischlerei, 58, sehr skeptisch, sehr gering digital.
6. **Aylin** – Shopify-Shop, mittlere Kenntnisse, Erstattungen/Rückbuchungen.
7. **Dr. Wagner** – Kanzlei-Admin, extrem präzise, „Edge-Case-Brecher".
8. **Tobias** – Mitarbeiter **ohne** Admin-Rechte.
9. **Renate** – 62, Büro, gering digital, Login/Passwort.
10. **„Der Neugierige"** – testet absichtlich Unsinn (falsche Formate, Riesendateien, Mehrfach-Weiterleitung).

---

## Durchlauf je Persona (Was sie taten → wie die App reagierte)

### 1. Stefan (Admin, Power-User)
Richtet Firma ein, Konten, Mitarbeiter, EBICS, Shopify. Alles flüssig. SEPA-Erstellung, EBICS-Versand, Archiv-Export – sauber. **Findet nichts Blockierendes.** Bemerkt: beim Reinziehen einer **.jpg-Fotorechnung** passiert *nichts* (kein Hinweis). → **Fehlt Feedback.**

### 2. Marek (mittel)
Zieht eine echte Lieferanten-PDF rein → Zeile entsteht, Felder gefüllt. Zieht eine **PayPal-Rechnung ohne IBAN** rein → Warn-Modal „keine IBAN / evtl. bereits bezahlt". **Gut.** Leitet eine Rechnung per Mail weiter → „Eingegangene Rechnungen laden" → Entwurf erscheint. **Gut.** Lädt dieselbe Rechnung zweimal → „1 Dublette übersprungen". **Gut.** Zieht versehentlich ein **Word-Dokument** rein → **keine Reaktion, keine Meldung.** → **Fehlt Feedback.**

### 3. Heike (Steuerberaterin)
Bekommt Belege per Mail von der App. Öffnet eine `.eml` im Vorschau-Fenster → sieht „kein Inhalt" → **war früher verwirrend, jetzt** erklärt die App „PDF = lesbar, .eml = nur Nachweis". **Gut.** Prüft die SEPA-Datei mit ihrem Format-Prüfer → valide. Sucht nach einer **reinen XRechnung-`.xml`** (kommt bei größeren Lieferanten) → **die App liest einzelne `.xml`-E-Rechnungen noch nicht ein** (nur ZUGFeRD-PDF). → **Logik-Lücke (bekannt, geplant).**

### 4. Giuseppe (Restaurant, gering digital, Sprachbarriere)
Will 3 Löhne + Getränkelieferanten zahlen. Lädt eine **normale Foto-Rechnung (Scan)** → OCR liest, Felder teils gefüllt, „bitte prüfen". **Gut.** Tippt IBAN mit Leerzeichen und klein → wird automatisch normalisiert. **Gut.** Gibt eine **falsche IBAN** ein → Klartext-Grund „Prüfziffer stimmt nicht". **Gut, verständlich.** Versteht „Verwendungszweck" nicht → kein Tooltip/Hilfe an dem Feld. → **Kleine Verständnislücke.**

### 5. Meister Brandt (Handwerk, 58, skeptisch)
Hat Angst, „was kaputt zu machen". Meldet sich an, vergisst fast das Passwort → die App warnt klar: **Passwort = einziger Schlüssel, bei Verlust nicht wiederherstellbar.** Brandt findet das **beängstigend**, es gibt **keinen Wiederherstellungsweg** (technisch durch E2E gewollt). → **Echtes UX-Risiko für gering-digitale Nutzer.** Leitet Rechnungen an die belege-Adresse weiter → klappt. Zieht eine **leere/kaputte PDF** rein → dank „Supersafe" entsteht trotzdem eine Zeile mit Hinweis „konnte nicht ausgelesen werden – bitte manuell ausfüllen". **Sehr gut** (genau der Marek-Fix).

### 6. Aylin (Shopify, Erstattungen)
Verbindet Shopify per Klick. Importiert eine Bestellung → Felder gefüllt. Will eine **bereits erstattete Bestellung** nochmal erstatten → Doppelzahlungs-Modal blockt. **Sehr gut.** Nutzt die **neue Suche** in Stornos/Erstattungen nach Bestellnummer → findet sofort. **Gut.** Filtert Rückbuchungen → Kennzahlen sauber. Versucht eine Erstattung mit **Betrag 0** → Zeile nicht „zahlbar", SEPA-Button bleibt aus. **Logisch.**

### 7. Dr. Wagner (Edge-Case-Brecher)
Tippt **Sonderzeichen** in Felder → SEPA-Sanitizer wandelt Umlaute/ungültige Zeichen sauber um. **Gut.** Lädt **50 PDFs auf einmal** → werden verarbeitet (etwas langsam, aber mit Fortschrittsanzeige bei Scans). Setzt ein **Ausführungsdatum in der Vergangenheit** → wird auf heute korrigiert. **Gut.** Löscht den **letzten Admin** → **jetzt blockiert** mit „Der letzte Admin kann nicht entfernt werden". **Sehr gut** (Audit-Fix). Schickt absichtlich kaputte Eingaben an den Hub → saubere Fehlercodes statt Absturz. **Gut.**

### 8. Tobias (Mitarbeiter ohne Admin)
Sieht den Reiter **Stammdaten** nicht (admin-only). Im Rechnungen-Tab kann er PDFs laden/vorbereiten, aber **„SEPA-Datei erstellen" ist gesperrt** mit Hinweis „Nur Admins (Vier-Augen-Prinzip)". **Logisch und klar.** Sieht das **Rechnungs-Archiv nicht** (admin-only). **Konsistent.** Mögliche Verwirrung: Er bereitet Rechnungen vor und denkt evtl., er habe „gezahlt" → ein dezenter Hinweis „wartet auf Admin-Freigabe" wäre schöner. → **Kleine Erwartungslücke.**

### 9. Renate (62, gering digital)
Erst-Login klappt mit Anleitung. Aktiviert **Touch ID** → danach nur noch Finger. **Sehr gut für sie.** Klickt „Kopieren" bei der belege-Adresse → „kopiert" bestätigt (und bei Fehler jetzt „bitte manuell markieren"). **Gut.** Schließt die App mit ungespeicherten Änderungen → wird beim Abmelden automatisch gespeichert (kein Datenverlust). **Sehr gut.** Stolpert nur über Fachbegriffe (SEPA, EBICS, IBAN) – die Anleitung hilft, aber In-App-Tooltips fehlen teils.

### 10. Der Neugierige (Stress-Test)
Zieht **gemischt** PDF + .png + .xml rein → nur die PDFs werden Zeilen; **.png/.xml verschwinden kommentarlos.** → **Fehlt Feedback** (er denkt, alles sei geladen). Leitet **dieselbe** Rechnung 6× per Mail weiter → Beleg-Archiv zeigt 6 Einträge (revisionssicher gewollt), aber beim Import nur **1 Rechnung**, Rest „Dublette übersprungen". **Import-Logik gut**, Archiv-Mehrfacheinträge könnten Laien verwirren. Gibt eine **Adresse ohne @** als Steuerberater-Mail ein → rote Warnung „keine vollständige E-Mail". **Gut.**

---

## Befunde — Logik, Unlogik, Feedback-Lücken (priorisiert)

### 🔴 Sollte gefixt werden (Feedback-Prinzip verletzt)
1. **Nicht-PDF beim „Rechnungs-PDFs laden" wird still übersprungen.** Zieht jemand `.jpg/.png/.xml/.docx` rein, passiert **gar nichts** – keine Meldung. Bei einer App mit dem Anspruch „immer Feedback" ist das die deutlichste Lücke. *Fix: pro übersprungener Datei zählen und melden („3 Dateien ignoriert – nur PDF wird unterstützt").*
2. **Wenn ausschließlich Nicht-PDFs gewählt werden → komplette Stille.** Gleiche Ursache, besonders verwirrend.

### 🟠 Logik-Lücken / Erwartung
3. **Reine `.xml`-E-Rechnungen (XRechnung) werden noch nicht eingelesen** – nur ZUGFeRD (XML im PDF). Ab 2025/2027 zunehmend relevant. *Geplant (E-Rechnungs-Härtung CII+UBL+.xml).*
4. **„Bereits bezahlt"-Wording bei No-IBAN:** Ein **Angebot/Proforma ohne IBAN** wird als „evtl. bereits bezahlt (PayPal/Karte)" markiert – irreführend, korrekt wäre „keine Bankverbindung – nicht per SEPA zahlbar". *Fix: Wording differenzieren.*
5. **Nicht-Admin bereitet Rechnungen vor** ohne Hinweis, dass noch eine Admin-Freigabe nötig ist → könnte „gezahlt"-Eindruck erzeugen. *Fix: dezenter Status „wartet auf Admin".*

### 🟡 UX-Risiken für gering-digitale Nutzer
6. **Passwortverlust = Totalverlust** (E2E-bedingt). Für Brandt/Renate angsteinflößend, kein Recovery. *Empfehlung: optionaler, vom Nutzer selbst verwalteter Wiederherstellungs-Schlüssel/Export beim Setup (bewusst, verschlüsselt) – sonst bleibt das ein Support-Risiko.*
7. **Fehlende In-App-Tooltips** für Fachbegriffe (Verwendungszweck, EBICS, Vier-Augen). Anleitung hilft, aber nicht am Feld.
8. **EBICS nur im Bank-Tarif** – an der Stelle, wo ein Pro-Nutzer EBICS erwartet, fehlt der Hinweis „im Bank-Tarif verfügbar".

### 🟢 Was sehr gut funktioniert (zur Einordnung)
- **Doppelzahlungs-Schutz** (Modals bei bereits erstattet/bezahlt) – durchgängig, branchenübergreifend gelobt.
- **IBAN-Validierung mit Klartext-Grund** – auch für Laien verständlich.
- **„Supersafe" Laden** – jede reingezogene Rechnung erzeugt eine Zeile, nie „verschwindet" etwas (löst das Marek-Problem).
- **Dubletten-Schutz** (Nr + IBAN + Betrag) – Mehrfach-Weiterleitung erzeugt keine Doppelzahlung.
- **Sichtbares Feedback** nach dem Audit bei Speicher-, Lade-, Kopier- und IBAN-Fehlern.
- **Rollen-Trennung** (Admin/Mitarbeiter, Vier-Augen, Archiv admin-only) – logisch und konsistent.
- **Auto-Speichern beim Abmelden**, **Touch ID**, **Suche** in Stornos/Erstattungen.
- **Robuste Eingabe-Bereinigung** (Umlaute/Sonderzeichen, IBAN-Normalisierung, Datum nicht in Vergangenheit).

---

## Gesamteindruck

Über alle Personas hinweg fühlt sich die App **stabil, sicher und durchdacht** an – besonders die zahlungskritischen Kern-Flows (SEPA-Erstellung, Doppelzahlungs-Schutz, Rollen). Nach dem Stabilitäts-Audit gibt es bei fast jedem Fehler eine sichtbare Rückmeldung.

Die **eine echte Verletzung des „immer Feedback"-Prinzips** ist das **stille Überspringen von Nicht-PDF-Dateien** beim Reinziehen – das sollte zuerst geschlossen werden. Die übrigen Punkte sind Logik-/Erwartungs-Feinschliff (XRechnung-`.xml`, Wording, Nicht-Admin-Status) und ein strukturelles Thema für gering-digitale Nutzer (Passwort-Recovery).

**Reihenfolge der Empfehlung:** (1) Nicht-PDF-Feedback, (2) Wording „No-IBAN", (3) XRechnung-`.xml`-Import, (4) Tooltips/In-App-Hilfe, (5) Konzept für Passwort-Wiederherstellung.
