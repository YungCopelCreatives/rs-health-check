// Phone-friendly health check for the WhatsApp bot. Shows no secrets.
// Open: /api/status?k=<WA_VERIFY_TOKEN>
const store = require("./_store.js");

const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const row = (ok, label, detail) => `<li class="${ok ? "ok" : "bad"}"><b>${ok ? "✅" : "❌"} ${esc(label)}</b>${detail ? `<span>${esc(detail)}</span>` : ""}</li>`;
const ago = iso => { if (!iso) return "never"; const m = Math.round((Date.now() - Date.parse(iso)) / 60000); return m < 1 ? "just now" : m < 120 ? `${m} min ago` : `${Math.round(m / 60)} h ago`; };

module.exports = async function handler(req, res) {
  const q = req.query || Object.fromEntries(new URL(req.url, "http://x").searchParams);
  const want = process.env.WA_VERIFY_TOKEN || "";
  res.setHeader("Cache-Control", "no-store");
  if (!want || q.k !== want) return res.status(403).send("Add ?k=<your WA_VERIFY_TOKEN> to the address.");

  const token = process.env.WA_TOKEN || "", phoneId = process.env.WA_PHONE_NUMBER_ID || "";
  const items = [];
  items.push(row(!!token, "WA_TOKEN is set", token ? `${token.length} characters${/\s/.test(token) ? " — contains a space or line break, re-paste it" : ""}` : "Missing in Vercel"));
  items.push(row(!!phoneId, "WA_PHONE_NUMBER_ID is set", phoneId ? `ends in …${phoneId.slice(-4)}` : "Missing in Vercel"));
  items.push(row(!!want, "WA_VERIFY_TOKEN is set", ""));
  items.push(row(!!process.env.MAKE_WEBHOOK_URL, "MAKE_WEBHOOK_URL is set", process.env.MAKE_WEBHOOK_URL ? "" : "Results won't reach Airtable"));

  // Does Meta accept the token and number?
  if (token && phoneId) {
    try {
      const r = await fetch(`https://graph.facebook.com/v21.0/${encodeURIComponent(phoneId)}?fields=display_phone_number,verified_name`, { headers: { Authorization: `Bearer ${token.trim()}` } });
      const j = await r.json();
      items.push(r.ok ? row(true, "Meta accepts the token and number", `${j.display_phone_number || ""} ${j.verified_name ? "· " + j.verified_name : ""}`)
        : row(false, "Meta rejected the token or number", (j.error && j.error.message) || `HTTP ${r.status}`));
    } catch (e) { items.push(row(false, "Couldn't reach Meta", e.message)); }
  }

  // Memory and recent activity
  let memOk = false;
  if (store.enabled()) { await store.set("diag:ping", Date.now()); memOk = !!(await store.get("diag:ping")); }
  items.push(row(memOk, "Bot memory (Upstash) works", store.enabled() ? (memOk ? "" : "Connected but not answering") : "Not connected, so typed questions are skipped"));
  if (memOk) {
    const [wh, se, ok] = await Promise.all([store.get("diag:webhook"), store.get("diag:sendError"), store.get("diag:sendOk")]);
    items.push(row(!!wh, "Last message event from Meta", wh ? `${ago(wh.at)} · ${wh.messages} message(s), ${wh.statuses} status update(s)${wh.phoneNumberId && phoneId && wh.phoneNumberId !== phoneId ? " · for a DIFFERENT phone number ID than WA_PHONE_NUMBER_ID" : ""}` : "Meta hasn't sent anything to the bot yet"));
    items.push(row(!!ok && (!se || Date.parse(ok.at) > Date.parse(se.at)), "Last reply sent", ok ? ago(ok.at) : "none yet"));
    if (se) items.push(row(false, `Last send error (${ago(se.at)})`, se.error));
  }

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  return res.status(200).send(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Bot status</title>
<style>body{font-family:system-ui,sans-serif;margin:0;padding:16px;background:#fff;color:#222}h1{font-size:20px}ul{list-style:none;padding:0}li{border:1px solid #e3e6e8;border-radius:12px;padding:12px;margin:8px 0}li span{display:block;color:#555;font-size:14px;margin-top:4px;word-break:break-word}.bad{border-color:#f0b4b2;background:#fdf3f3}</style>
<h1>RS WhatsApp bot status</h1><ul>${items.join("")}</ul><p style="color:#777;font-size:13px">Checked ${new Date().toISOString()}. Refresh after sending "Hi".</p>`);
};
