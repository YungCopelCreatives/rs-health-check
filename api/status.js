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

  // Is the WhatsApp Business Account subscribed to this app? Without it Meta sends no message webhooks.
  let fixForm = "";
  if (token && phoneId) {
    try {
      const G = "https://graph.facebook.com/v21.0";
      const auth = { Authorization: `Bearer ${token.trim()}` };
      let wabas = q.waba ? [String(q.waba).replace(/\D/g, "")] : [];
      if (!wabas.length) {
        const d = await (await fetch(`${G}/debug_token?input_token=${encodeURIComponent(token.trim())}`, { headers: auth })).json();
        const scopes = (d.data && d.data.granular_scopes) || [];
        wabas = [...new Set(scopes.filter(x => /whatsapp_business_(management|messaging)/.test(x.scope)).flatMap(x => x.target_ids || []))];
      }
      let found = null;
      for (const w of wabas) {
        const pn = await (await fetch(`${G}/${w}/phone_numbers?fields=id`, { headers: auth })).json();
        if ((pn.data || []).some(x => x.id === phoneId)) { found = w; break; }
      }
      if (!found && wabas.length === 1) found = wabas[0];
      if (!found) {
        items.push(row(false, "Couldn't find the WhatsApp Business Account", "Add &waba=<WhatsApp Business Account ID from API Setup> to this address"));
      } else {
        if (q.fix === "subscribe") {
          const r = await fetch(`${G}/${found}/subscribed_apps`, { method: "POST", headers: auth });
          const j = await r.json();
          items.push(row(r.ok && j.success, "Subscribe the account to the app", r.ok ? "Done" : (j.error && j.error.message) || `HTTP ${r.status}`));
        }
        const sa = await (await fetch(`${G}/${found}/subscribed_apps`, { headers: auth })).json();
        const n = (sa.data || []).length;
        items.push(row(n > 0, "WhatsApp account is linked to the app", sa.error ? sa.error.message : n ? `Account …${found.slice(-4)}, ${n} app(s) subscribed` : `Account …${found.slice(-4)} has no app subscribed, so Meta won't forward messages`));
        if (!n) fixForm = `<form method="get"><input type="hidden" name="k" value="${esc(q.k)}"><input type="hidden" name="waba" value="${esc(found)}"><input type="hidden" name="fix" value="subscribe"><button style="background:#0fb9b1;border:0;border-radius:999px;padding:14px 22px;font-size:16px;font-weight:600">Fix: link account to app</button></form>`;
      }
    } catch (e) { items.push(row(false, "Couldn't check the account link", e.message)); }
  }

  // Memory and recent activity
  let memOk = false;
  if (store.enabled()) { await store.set("diag:ping", Date.now()); memOk = !!(await store.get("diag:ping")); }
  items.push(row(memOk, "Bot memory (Upstash) works", store.enabled() ? (memOk ? "" : "Connected but not answering") : "Not connected, so typed questions are skipped"));
  if (memOk) {
    const [wh, se, ok, hit] = await Promise.all([store.get("diag:webhook"), store.get("diag:sendError"), store.get("diag:sendOk"), store.get("diag:hit")]);
    items.push(row(!!hit, "Last call from Meta to the bot", hit ? `${ago(hit.at)} · ${hit.bytes} bytes` : "none yet"));
    items.push(row(!!wh, "Last message event from Meta", wh ? `${ago(wh.at)} · ${wh.messages} message(s), ${wh.statuses} status update(s)${wh.phoneNumberId && phoneId && wh.phoneNumberId !== phoneId ? " · for a DIFFERENT phone number ID than WA_PHONE_NUMBER_ID" : ""}` : "Meta hasn't sent anything to the bot yet"));
    items.push(row(!!ok && (!se || Date.parse(ok.at) > Date.parse(se.at)), "Last reply sent", ok ? ago(ok.at) : "none yet"));
    if (se) items.push(row(false, `Last send error (${ago(se.at)})`, se.error));
  }

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  return res.status(200).send(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Bot status</title>
<style>body{font-family:system-ui,sans-serif;margin:0;padding:16px;background:#fff;color:#222}h1{font-size:20px}ul{list-style:none;padding:0}li{border:1px solid #e3e6e8;border-radius:12px;padding:12px;margin:8px 0}li span{display:block;color:#555;font-size:14px;margin-top:4px;word-break:break-word}.bad{border-color:#f0b4b2;background:#fdf3f3}</style>
<h1>RS WhatsApp bot status</h1><ul>${items.join("")}</ul>${fixForm}<p style="color:#777;font-size:13px">Checked ${new Date().toISOString()}. Refresh after sending "Hi".</p>`);
};
