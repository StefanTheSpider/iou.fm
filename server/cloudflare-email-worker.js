// Cloudflare Email Worker für iou.fm – ABHÄNGIGKEITSFREI (direkt im Cloudflare-
// Dashboard einfügbar, kein npm/CLI nötig). Schickt die rohe Mail + Absender/Betreff
// an den Hub-Endpunkt /api/inbound-email. Das Extrahieren der PDF-Anhänge übernimmt
// der Hub (server/mime.mjs).
//
// Einrichtung: siehe INBOUND_SETUP.md
//   - Empfangs-Domain komplett bei Cloudflare (Email Routing aktiviert)
//   - Routing rule: Catch-all  ->  Send to a Worker  ->  dieser Worker
//   - Worker-Variablen (Settings → Variables):
//       HUB_URL        = https://ioufm-production.up.railway.app
//       INBOUND_SECRET = <dasselbe Geheimnis wie im Hub>

function toB64(buf) {
  let bin = ""; const b = new Uint8Array(buf); const chunk = 0x8000;
  for (let i = 0; i < b.length; i += chunk) bin += String.fromCharCode.apply(null, b.subarray(i, i + chunk));
  return btoa(bin);
}

export default {
  async email(message, env) {
    const rawBuf = await new Response(message.raw).arrayBuffer();
    await fetch(env.HUB_URL.replace(/\/+$/, "") + "/api/inbound-email", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-inbound-secret": env.INBOUND_SECRET },
      body: JSON.stringify({
        to: message.to,
        from: message.from,
        subject: (message.headers && message.headers.get("subject")) || "",
        raw: toB64(rawBuf),
      }),
    });
  },
};
