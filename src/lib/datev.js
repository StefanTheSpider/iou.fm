// DATEV-PDF -> Textzeilen (nutzt pdf.js). Die reine Parse-Logik liegt in
// datevParse.js (ohne PDF-Abhängigkeit, dadurch testbar).
import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { linesFromItems } from "./datevParse.js";
export { parseDatev, toIsoDate, tidyName } from "./datevParse.js";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export async function pdfToLines(file) {
  const data = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data, isEvalSupported: false, useSystemFonts: false }).promise;
  let items = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    items = items.concat(
      content.items
        .filter((it) => it.str)
        .map((it) => ({ x: it.transform[4], y: it.transform[5] + p * -10000, str: it.str }))
    );
  }
  // y pro Seite nach unten verschoben, damit Seiten in Reihenfolge bleiben.
  return linesFromItems(items);
}
