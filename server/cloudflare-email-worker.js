// Cloudflare Email Worker für iou.fm – empfängt Belege-Mails und schickt sie als
// sauberes JSON (inkl. extrahierter Anhänge) an den Hub-Endpunkt /api/inbound-email.
//
// Warum hier (und nicht im Hub) geparst wird: Der Hub bleibt absichtlich ohne externe
// Abhängigkeiten. Das MIME-Parsing (Anhänge rausziehen) macht der Worker mit postal-mime.
//
// Einrichtung: siehe INBOUND_SETUP.md
//   - Domain bei Cloudflare, Email Routing aktiviert
//   - Route: belege-*@<deine-domain>  ->  dieser Worker
//   - Secrets/Vars im Worker:  HUB_URL,  INBOUND_SECRET
//   - Dependency:  npm i postal-mime   (wird per wrangler gebündelt)
import PostalMime from "postal-mime";

function toB64(buf) {
  let bin = ""; const b = new Uint8Array(buf); const chunk = 0x8000;
  for (let i = 0; i < b.length; i += chunk) bin += String.fromCharCode.apply(null, b.subarray(i, i + chunk));
  return btoa(bin);
}

export default {
  async email(message, env) {
    const rawBuf = await new Response(message.raw).arrayBuffer();
    const parsed = await PostalMime.parse(rawBuf);
    const attachments = (parsed.attachments || []).map((a) => ({
      filename: a.filename || "anhang",
      content: toB64(a.content),
      contentType: a.mimeType || "application/octet-stream",
    }));
    await fetch(env.HUB_URL.replace(/\/+$/, "") + "/api/inbound-email", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-inbound-secret": env.INBOUND_SECRET },
      body: JSON.stringify({
        to: message.to,
        from: message.from,
        subject: parsed.subject || "",
        date: parsed.date || null,
        raw: toB64(rawBuf),
        attachments,
      }),
    });
  },
};
