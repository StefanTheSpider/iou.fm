// Lokale Texterkennung (OCR) für gescannte/fotografierte Rechnungs-PDFs OHNE
// Textebene. Läuft komplett IM GERÄT (Tesseract WASM) – die Rechnung verlässt
// NIE den Rechner. Nur die OCR-Modelldateien (kein Nutzerdatum) werden einmalig
// geladen. Tesseract wird dynamisch importiert, damit es den Haupt-Bundle nicht
// belastet und die App auch ohne installierte Lib funktioniert (Fallback: leere
// Felder + Hinweis „manuell ausfüllen").

let _worker = null;
let _progress = null;

async function getWorker() {
  if (_worker) return _worker;
  const { createWorker } = await import("tesseract.js");
  _worker = await createWorker("deu", 1, {
    logger: (m) => { if (m && m.status === "recognizing text" && _progress) _progress(m.progress || 0); },
  });
  return _worker;
}

// PDF-Seite in ein Canvas rendern (2x für bessere Erkennung).
async function pageToCanvas(page, scale = 2) {
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext("2d");
  await page.render({ canvasContext: ctx, viewport }).promise;
  return canvas;
}

// pdf (pdf.js-Dokument) -> erkannte Textzeilen. maxPages begrenzt die Laufzeit.
export async function ocrPdf(pdf, { maxPages = 5, onProgress = null } = {}) {
  _progress = onProgress;
  const worker = await getWorker();
  const lines = [];
  const n = Math.min(pdf.numPages, maxPages);
  for (let p = 1; p <= n; p++) {
    const page = await pdf.getPage(p);
    const canvas = await pageToCanvas(page);
    const { data } = await worker.recognize(canvas);
    for (const l of String(data?.text || "").split(/\r?\n/)) {
      const t = l.replace(/\s+/g, " ").trim();
      if (t) lines.push(t);
    }
  }
  _progress = null;
  return lines;
}
