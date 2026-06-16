// INI-Brief-Generator für EBICS.
// Erzeugt ein druckfertiges Dokument (HTML → über den Druckdialog als PDF speichern).
// Der INI-Brief enthält die öffentlichen Schlüssel-Hashes und wird unterschrieben
// per Post/Fax an die Bank geschickt, damit sie den Zugang freischaltet.
import { formatHashBlocks } from "./keys.js";
import { toast } from "../toast.js";

function row(label, value) {
  return `<tr><td class="lbl">${label}</td><td class="val">${value || "—"}</td></tr>`;
}

export function buildIniLetterHtml(cfg, keys) {
  const now = new Date();
  const dateStr = now.toLocaleDateString("de-DE", { year: "numeric", month: "long", day: "numeric" });
  const h = keys?.hashes || {};
  const v = keys?.versions || { signature: "A006", authentication: "X002", encryption: "E002" };
  return `<!doctype html><html lang="de"><head><meta charset="utf-8">
<title>EBICS INI-Brief</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; color: #111; margin: 40px; font-size: 12px; }
  h1 { font-size: 20px; margin: 0 0 2px; }
  .sub { color: #555; margin: 0 0 24px; }
  table { width: 100%; border-collapse: collapse; margin: 12px 0 24px; }
  td { padding: 6px 8px; border: 1px solid #ccc; vertical-align: top; }
  td.lbl { width: 230px; background: #f5f5f5; font-weight: 600; }
  td.val { font-family: ui-monospace, Menlo, Consolas, monospace; }
  .hash { font-family: ui-monospace, Menlo, Consolas, monospace; word-break: break-all; line-height: 1.7; }
  .key { margin: 18px 0; }
  .key h3 { margin: 0 0 6px; font-size: 13px; }
  .sign { margin-top: 48px; display: flex; gap: 60px; }
  .sign div { flex: 1; border-top: 1px solid #111; padding-top: 6px; color: #555; }
  .hint { margin-top: 28px; padding: 12px 14px; background: #fff8e1; border: 1px solid #f0d98a; border-radius: 6px; color: #5b4a00; }
  @media print { body { margin: 18mm; } .noprint { display: none; } }
</style></head><body onload="setTimeout(function(){try{window.print()}catch(e){}},400)">
<h1>EBICS INI-Brief</h1>
<p class="sub">Initialisierung der elektronischen Unterschrift · erstellt am ${dateStr}</p>

<table>
  ${row("Bank", cfg.bankName || "Commerzbank")}
  ${row("EBICS-Host-ID", cfg.hostId)}
  ${row("Kunden-ID (Partner-ID)", cfg.partnerId)}
  ${row("Teilnehmer-ID (User-ID)", cfg.userId)}
  ${row("EBICS-Version", cfg.version || "H005 (EBICS 3.0)")}
</table>

<div class="key">
  <h3>Öffentlicher Bank-technischer Signaturschlüssel (${v.signature})</h3>
  <div class="hash">SHA-256: ${formatHashBlocks(h.signature || "")}</div>
</div>
<div class="key">
  <h3>Öffentlicher Authentifikationsschlüssel (${v.authentication})</h3>
  <div class="hash">SHA-256: ${formatHashBlocks(h.authentication || "")}</div>
</div>
<div class="key">
  <h3>Öffentlicher Verschlüsselungsschlüssel (${v.encryption})</h3>
  <div class="hash">SHA-256: ${formatHashBlocks(h.encryption || "")}</div>
</div>

<div class="sign">
  <div>Ort, Datum</div>
  <div>Unterschrift Teilnehmer</div>
</div>

<div class="hint">
  Bitte diesen Brief ausdrucken, unterschreiben und an Ihre Bank senden. Erst nach
  Eingang aktiviert die Bank Ihren EBICS-Zugang. Bewahren Sie eine Kopie auf.
</div>

<div class="noprint" style="margin-top:28px">
  <button onclick="window.print()" style="padding:10px 18px;font-size:14px;cursor:pointer">Drucken / als PDF speichern</button>
</div>
</body></html>`;
}

// Öffnet bzw. lädt den INI-Brief herunter.
// Das Tauri-App-Fenster blockiert window.open (auch für Blob-URLs), deshalb laden
// wir den Brief zuverlässig als HTML-Datei in „Downloads" – dort im Browser öffnen,
// drucken oder als PDF speichern (gleiches Muster wie SEPA-/Beleg-Download).
export function openIniLetter(cfg, keys) {
  const html = buildIniLetterHtml(cfg, keys);
  const partner = (cfg.partnerId || "EBICS").replace(/[^A-Za-z0-9_-]/g, "");
  const filename = `INI-Brief_${partner}.html`;
  // Als Datei in „Downloads" ablegen (window.open ist im App-Fenster blockiert, s. REGEL 4).
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.rel = "noopener";
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  toast(`„${filename}" in „Downloads" – dort öffnen und drucken.`);
}
