# Verfahrensdokumentation – Belegerfassung per E-Mail (Vorlage)

> Vorlage zum Ausfüllen. Die Verfahrensdokumentation ist der organisatorische Teil, der eine
> GoBD-konforme, steuerlich anerkannte Belegablage absichert. Anpassen an dein Unternehmen.

## 1. Unternehmen
- Firma / Anschrift: __________________________
- Verantwortlich (Belegwesen): __________________________
- Eingesetzte Software: **iou.fm** (fork and merge UG)

## 2. Zweck
Eingehende Belege (z. B. Bestellbestätigungen, Einkaufsrechnungen) werden per E-Mail-Weiterleitung
erfasst, unveränderbar archiviert und – sofern aktiviert – an den Steuerberater bzw. DATEV
(Unternehmen online) übergeben.

## 3. Ablauf (Soll-Prozess)
1. Eingangsbeleg per E-Mail wird an die persönliche iou.fm-Adresse `belege-…@…` weitergeleitet.
2. Empfang über den Inbound-Dienst; Übergabe an iou.fm.
3. iou.fm legt die **Original-Mail unverändert** ab und berechnet eine Prüfsumme (SHA-256).
4. Erfassungszeitpunkt (Zeitstempel) wird protokolliert.
5. Optional: automatische Weiterleitung der Belege an Steuerberater/DATEV.

## 4. Unveränderbarkeit & Vollständigkeit (GoBD)
- Ablage **write-once**: einmal gespeicherte Belege werden nicht verändert oder gelöscht.
- Jeder Beleg trägt **SHA-256-Prüfsumme** + **Empfangszeitstempel**.
- Lückenlose Erfassung aller eingehenden Belege (laufende Sammlung im Archiv).

## 5. Aufbewahrung
- Aufbewahrungsfrist: **10 Jahre** (Rechnungen/Buchungsbelege, § 147 AO).
- Speicherort: __________________________ (Hub-Volume / Backup-Konzept beschreiben).

## 6. Zugriff & Berechtigungen
- Zugriff auf das Beleg-Archiv: nur Admin-Rollen in iou.fm.
- Authentifizierung: Benutzer + Passwort (E2E), optional Touch ID / Windows Hello.

## 7. Änderungen an diesem Verfahren
| Datum | Änderung | Verantwortlich |
|------|----------|----------------|
|      |          |                |

*Hinweis: Diese Vorlage ersetzt keine steuerliche Beratung. Final mit dem Steuerberater abstimmen.*
