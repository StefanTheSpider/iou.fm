// Minimaler MIME-Parser (ohne externe Abhängigkeiten) – zieht aus einer Roh-E-Mail
// Betreff/Absender und die (base64-kodierten) Anhänge heraus. Bewusst schlank: deckt
// den Normalfall „multipart mit base64-PDF/Bild-Anhängen" ab (Bestellbestätigungen,
// Rechnungen). Schlägt das Parsen fehl, bleibt wenigstens die Roh-Mail (.eml) erhalten.

function splitHeadersBody(text) {
  const i = text.search(/\r?\n\r?\n/);
  if (i === -1) return { headerText: text, body: "" };
  const sep = text.slice(i).startsWith("\r\n\r\n") ? 4 : 2;
  return { headerText: text.slice(0, i), body: text.slice(i + sep) };
}

function parseHeaders(headerText) {
  const out = {};
  // Gefaltete Zeilen (Fortsetzung mit Leerzeichen/Tab) zusammenführen.
  const lines = headerText.replace(/\r?\n[ \t]+/g, " ").split(/\r?\n/);
  for (const line of lines) {
    const m = /^([^:]+):\s?(.*)$/.exec(line);
    if (m) { const k = m[1].toLowerCase(); if (!(k in out)) out[k] = m[2]; }
  }
  return out;
}

function param(headerValue, name) {
  const m = new RegExp(name + '\\s*=\\s*"?([^";]+)"?', "i").exec(headerValue || "");
  return m ? m[1].trim() : "";
}

// RFC2047 (=?utf-8?B?...?=) grob dekodieren – für lesbare Betreffs/Dateinamen.
function decodeHeader(v) {
  if (!v) return "";
  return v.replace(/=\?[^?]+\?([bBqQ])\?([^?]*)\?=/g, (_, enc, data) => {
    try {
      if (enc.toLowerCase() === "b") return Buffer.from(data, "base64").toString("utf8");
      return Buffer.from(data.replace(/_/g, " ").replace(/=([0-9A-Fa-f]{2})/g, (_m, h) => String.fromCharCode(parseInt(h, 16))), "binary").toString("utf8");
    } catch { return data; }
  });
}

function collect(contentType, body, out, depth) {
  if (depth > 8) return;
  const ct = (contentType || "").toLowerCase();
  if (ct.startsWith("multipart/")) {
    const boundary = param(contentType, "boundary");
    if (!boundary) return;
    const parts = body.split("--" + boundary);
    for (const part of parts) {
      const p = part.replace(/^\r?\n/, "");
      if (!p || p.startsWith("--")) continue; // Schluss-Marker/leer
      const { headerText, body: pbody } = splitHeadersBody(p);
      const ph = parseHeaders(headerText);
      const pct = ph["content-type"] || "";
      const cte = (ph["content-transfer-encoding"] || "").toLowerCase();
      const disp = ph["content-disposition"] || "";
      if ((pct || "").toLowerCase().startsWith("multipart/")) {
        collect(pct, pbody, out, depth + 1);
        continue;
      }
      const filename = param(disp, "filename") || param(pct, "name");
      const isAttachment = /attachment/i.test(disp) || !!filename ||
        /^(application\/pdf|image\/|application\/octet-stream)/i.test(pct);
      if (isAttachment && cte === "base64") {
        out.push({ filename: decodeHeader(filename) || "anhang", content: pbody.replace(/[\r\n\s]/g, "") });
      }
    }
  }
}

export function parseEmail(raw) {
  const { headerText, body } = splitHeadersBody(String(raw || ""));
  const h = parseHeaders(headerText);
  const out = { subject: decodeHeader(h["subject"] || ""), from: h["from"] || "", to: h["to"] || "", date: h["date"] || "", attachments: [] };
  try { collect(h["content-type"] || "", body, out.attachments, 0); } catch { /* Anhänge optional */ }
  return out;
}
