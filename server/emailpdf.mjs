// Abhängigkeitsfreier PDF-1.4-Generator für Text-Belege.
// Zweck: Eine per E-Mail empfangene Bestellbestätigung, deren Beleg-Inhalt NICHT im Anhang,
// sondern im E-Mail-TEXT steht (Artikelliste etc.), als ordentliches, ablegbares PDF erzeugen –
// damit DATEV/Steuerberater einen echten Beleg bekommt (GoBD-konform). Standardfont Helvetica
// (Base-14, kein Embedding); WinAnsi-Encoding für Umlaute/€. Keine externen Pakete.

// Häufige Sonderzeichen oberhalb Latin-1, die WinAnsi auf 0x80–0x9F legt.
const WINANSI_HIGH = {
  "€": 0x80, "‚": 0x82, "ƒ": 0x83, "„": 0x84, "…": 0x85, "†": 0x86, "‡": 0x87, "ˆ": 0x88,
  "‰": 0x89, "Š": 0x8a, "‹": 0x8b, "Œ": 0x8c, "Ž": 0x8e, "‘": 0x91, "’": 0x92, "“": 0x93,
  "”": 0x94, "•": 0x95, "–": 0x96, "—": 0x97, "˜": 0x98, "™": 0x99, "š": 0x9a, "›": 0x9b,
  "œ": 0x9c, "ž": 0x9e, "Ÿ": 0x9f,
};

// Eine Zeile (ohne Zeilenumbruch) in WinAnsi-Bytes umsetzen und für PDF-Strings escapen.
function lineToPdfText(line) {
  let s = "";
  for (const ch of String(line)) {
    const cp = ch.codePointAt(0);
    let b;
    if (cp >= 0x20 && cp <= 0x7e) b = cp;                 // ASCII
    else if (cp >= 0xa0 && cp <= 0xff) b = cp;            // Latin-1 = WinAnsi
    else if (WINANSI_HIGH[ch] !== undefined) b = WINANSI_HIGH[ch];
    else b = 0x3f;                                         // '?'
    if (b === 0x28 || b === 0x29 || b === 0x5c) s += "\\";  // ( ) \ escapen
    s += String.fromCharCode(b);
  }
  return s;
}

// Lange Zeilen hart umbrechen (Näherung; Helvetica ist proportional, ~95 Zeichen passen auf A4).
function wrapLines(text, maxChars = 95) {
  const out = [];
  for (const raw of String(text || "").replace(/\r/g, "").split("\n")) {
    let line = raw.replace(/\t/g, "    ");
    if (line.length <= maxChars) { out.push(line); continue; }
    while (line.length > maxChars) {
      let cut = line.lastIndexOf(" ", maxChars);
      if (cut < maxChars * 0.5) cut = maxChars; // kein sinnvoller Wortumbruch → hart
      out.push(line.slice(0, cut));
      line = line.slice(cut).replace(/^\s+/, "");
    }
    if (line) out.push(line);
  }
  return out;
}

// Erzeugt ein PDF (Buffer) aus den E-Mail-Eckdaten + Text.
export function emailToPdf({ subject, from, date, to, text }) {
  const header = [
    "Beleg – per E-Mail empfangen (iou.fm)",
    "",
    "Von:        " + (from || "—"),
    "An:         " + (to || "—"),
    "Betreff:    " + (subject || "—"),
    "Empfangen:  " + (date || new Date().toISOString()),
    "----------------------------------------------------------------------------",
    "",
  ];
  const allLines = header.concat(wrapLines(text || "(kein Textinhalt)"));

  // A4, Schrift 10pt, Zeilenabstand 14pt, Seitenränder.
  const PAGE_W = 595, PAGE_H = 842, LEFT = 56, TOP = 790, LEADING = 14, FONT = 10;
  const linesPerPage = Math.floor((TOP - 56) / LEADING); // untere Marge 56
  const pages = [];
  for (let i = 0; i < allLines.length; i += linesPerPage) pages.push(allLines.slice(i, i + linesPerPage));
  if (!pages.length) pages.push([""]);

  // Objekte: 1=Catalog, 2=Pages, 3=Font, dann je Seite ein Page- + ein Content-Objekt.
  const objs = [];
  const fontObj = 3;
  const firstPageObj = 4;
  const pageObjNums = pages.map((_, i) => firstPageObj + i * 2);
  const contentObjNums = pages.map((_, i) => firstPageObj + i * 2 + 1);

  objs[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objs[2] = `<< /Type /Pages /Kids [${pageObjNums.map((n) => n + " 0 R").join(" ")}] /Count ${pages.length} >>`;
  objs[fontObj] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";

  pages.forEach((lines, i) => {
    const pageNum = pageObjNums[i];
    const contentNum = contentObjNums[i];
    objs[pageNum] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 ${fontObj} 0 R >> >> /Contents ${contentNum} 0 R >>`;
    let stream = `BT /F1 ${FONT} Tf ${LEADING} TL ${LEFT} ${TOP} Td\n`;
    lines.forEach((ln, idx) => {
      if (idx > 0) stream += "T*\n";
      stream += `(${lineToPdfText(ln)}) Tj\n`;
    });
    stream += "ET";
    objs[contentNum] = `<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`;
  });

  // Zusammenbauen + xref-Offsets berechnen (latin1, da WinAnsi-Bytes 1:1).
  let pdf = "%PDF-1.4\n";
  const offsets = [];
  const total = contentObjNums[contentObjNums.length - 1];
  for (let n = 1; n <= total; n++) {
    offsets[n] = Buffer.byteLength(pdf, "latin1");
    pdf += `${n} 0 obj\n${objs[n]}\nendobj\n`;
  }
  const xrefPos = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${total + 1}\n0000000000 65535 f \n`;
  for (let n = 1; n <= total; n++) pdf += String(offsets[n]).padStart(10, "0") + " 00000 n \n";
  pdf += `trailer\n<< /Size ${total + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF`;

  return Buffer.from(pdf, "latin1");
}
