// Minimaler MIME-Parser (ohne externe Abhängigkeiten) – zieht aus einer Roh-E-Mail
// Betreff/Absender, die (base64-kodierten) Anhänge UND den lesbaren Text-Inhalt heraus
// (text/plain bevorzugt, sonst HTML → Text). Bewusst schlank, deckt den Normalfall ab
// (Bestellbestätigungen/Rechnungen). Schlägt das Parsen fehl, bleibt die Roh-Mail (.eml) erhalten.

function splitHeadersBody(text) {
  const i = text.search(/\r?\n\r?\n/);
  if (i === -1) return { headerText: text, body: "" };
  const sep = text.slice(i).startsWith("\r\n\r\n") ? 4 : 2;
  return { headerText: text.slice(0, i), body: text.slice(i + sep) };
}

function parseHeaders(headerText) {
  const out = {};
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

function decodeHeader(v) {
  if (!v) return "";
  return v.replace(/=\?[^?]+\?([bBqQ])\?([^?]*)\?=/g, (_, enc, data) => {
    try {
      if (enc.toLowerCase() === "b") return Buffer.from(data, "base64").toString("utf8");
      return Buffer.from(data.replace(/_/g, " ").replace(/=([0-9A-Fa-f]{2})/g, (_m, h) => String.fromCharCode(parseInt(h, 16))), "binary").toString("utf8");
    } catch { return data; }
  });
}

// Quoted-Printable / Base64 → Text in der angegebenen Kodierung.
function decodeText(body, cte, charset) {
  const enc = /8859-1|1252|latin/i.test(charset || "") ? "latin1" : "utf8";
  const c = (cte || "").toLowerCase();
  if (c === "base64") {
    try { return Buffer.from(body.replace(/\s+/g, ""), "base64").toString(enc); } catch { return body; }
  }
  if (c === "quoted-printable") {
    const noSoft = body.replace(/=\r?\n/g, "");
    const bytes = [];
    for (let i = 0; i < noSoft.length; i++) {
      const ch = noSoft[i];
      if (ch === "=" && /^[0-9A-Fa-f]{2}$/.test(noSoft.substr(i + 1, 2))) { bytes.push(parseInt(noSoft.substr(i + 1, 2), 16)); i += 2; }
      else bytes.push(ch.charCodeAt(0) & 0xff);
    }
    try { return Buffer.from(bytes).toString(enc); } catch { return noSoft; }
  }
  return body; // 7bit/8bit – Roh-Mail wurde bereits als UTF-8 gelesen
}

// HTML grob in lesbaren Text wandeln (Zeilenstruktur erhalten, Entities auflösen).
export function htmlToText(html) {
  return String(html || "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<\s*li[^>]*>/gi, "\n• ")
    .replace(/<\s*(br|\/p|\/div|\/tr|\/li|\/h[1-6]|\/table)\s*\/?\s*>/gi, "\n")
    .replace(/<\s*td[^>]*>/gi, "  ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"').replace(/&euro;/gi, "€").replace(/&auml;/g, "ä").replace(/&ouml;/g, "ö")
    .replace(/&uuml;/g, "ü").replace(/&Auml;/g, "Ä").replace(/&Ouml;/g, "Ö").replace(/&Uuml;/g, "Ü").replace(/&szlig;/g, "ß")
    .replace(/&#(\d+);/g, (_, n) => { try { return String.fromCodePoint(+n); } catch { return ""; } })
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => { try { return String.fromCodePoint(parseInt(h, 16)); } catch { return ""; } })
    .replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
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
      if (!p || p.startsWith("--")) continue;
      const { headerText, body: pbody } = splitHeadersBody(p);
      const ph = parseHeaders(headerText);
      const pct = ph["content-type"] || "";
      const cte = (ph["content-transfer-encoding"] || "").toLowerCase();
      const disp = ph["content-disposition"] || "";
      if ((pct || "").toLowerCase().startsWith("multipart/")) { collect(pct, pbody, out, depth + 1); continue; }
      const filename = param(disp, "filename") || param(pct, "name");
      const isAttachment = /attachment/i.test(disp) || !!filename ||
        /^(application\/pdf|image\/|application\/octet-stream)/i.test(pct);
      if (isAttachment) {
        if (cte === "base64") out.attachments.push({ filename: decodeHeader(filename) || "anhang", content: pbody.replace(/[\r\n\s]/g, "") });
      } else if (/text\/plain/i.test(pct)) {
        out.text.push(decodeText(pbody, cte, param(pct, "charset")));
      } else if (/text\/html/i.test(pct)) {
        out.html.push(decodeText(pbody, cte, param(pct, "charset")));
      }
    }
  }
}

export function parseEmail(raw) {
  const { headerText, body } = splitHeadersBody(String(raw || ""));
  const h = parseHeaders(headerText);
  const ct = h["content-type"] || "";
  const out = {
    subject: decodeHeader(h["subject"] || ""), from: h["from"] || "", to: h["to"] || "",
    date: h["date"] || "", attachments: [], text: [], html: [],
  };
  try {
    if (/^multipart\//i.test(ct)) {
      collect(ct, body, out, 0);
    } else {
      const decoded = decodeText(body, h["content-transfer-encoding"], param(ct, "charset"));
      if (/text\/html/i.test(ct)) out.html.push(decoded); else out.text.push(decoded);
    }
  } catch { /* Anhänge/Text optional – Roh-Mail bleibt Nachweis */ }
  const text = (out.text.join("\n\n").trim()) || htmlToText(out.html.join("\n"));
  return { subject: out.subject, from: out.from, to: out.to, date: out.date, attachments: out.attachments, text };
}
