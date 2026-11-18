// Sends the approved WhatsApp invite template to one doctor, from the "Send invite" button in Airtable.
//
// The button opens:  /api/invite?k=<INVITE_KEY>&rec=<Airtable record id>&to=<WhatsApp>&name=<Doctor>
// GET shows a confirmation page (so link previews can't send anything); the Send button POSTs back here.
// When the doctor taps a button on the invite, the normal Health Check flow in api/whatsapp.js takes over.
//
// Env vars: INVITE_KEY (any long random phrase, also typed into the Airtable button formula),
//           WA_TOKEN, WA_PHONE_NUMBER_ID, MAKE_WEBHOOK_URL,
//           WA_INVITE_TEMPLATE (default rs_health_check_invite), WA_INVITE_LANG (default en)

const crypto = require("crypto");
const AT = require("./_airtable.js");

const GRAPH = "https://graph.facebook.com/v21.0";
const esc = s => String(s || "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const firstName = n => String(n || "").replace(/^\s*(dr\.?|doctor|prof\.?)\s+/i, "").trim();

function keyOk(k) {
  const want = process.env.INVITE_KEY || "";
  if (!want || typeof k !== "string" || k.length !== want.length) return false;
  return crypto.timingSafeEqual(Buffer.from(k), Buffer.from(want));
}

function page(res, status, title, body) {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Robots-Tag", "noindex");
  return res.status(status).send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · RS Health Check</title>
<style>body{font-family:system-ui,-apple-system,Segoe UI,sans-serif;background:#fff;color:#2b3235;margin:0;display:grid;place-items:center;min-height:100vh;padding:16px}
main{max-width:420px;width:100%;border:1px solid #dfe3e6;border-radius:16px;padding:28px}h1{font-size:20px;color:#050505;margin:0 0 12px}
p{line-height:1.5}.n{font-weight:600;color:#050505}button{background:#0fb9b1;color:#050505;border:0;border-radius:999px;padding:12px 22px;font-weight:600;font-size:15px;cursor:pointer}
.muted{color:#6b757b;font-size:13px}</style></head><body><main><h1>${esc(title)}</h1>${body}</main></body></html>`);
}

async function readForm(req) {
  if (req.body && typeof req.body === "object") return req.body;
  let raw = typeof req.body === "string" ? req.body : "";
  if (!raw && req[Symbol.asyncIterator]) { const c = []; for await (const x of req) c.push(x); raw = Buffer.concat(c).toString("utf8"); }
  return Object.fromEntries(new URLSearchParams(raw));
}

function template(to, name) {
  const qr = (index, payload) => ({ type: "button", sub_type: "quick_reply", index: String(index), parameters: [{ type: "payload", payload }] });
  return {
    messaging_product: "whatsapp", to, type: "template",
    template: {
      name: process.env.WA_INVITE_TEMPLATE || "rs_health_check_invite",
      language: { code: process.env.WA_INVITE_LANG || "en" },
      components: [
        { type: "body", parameters: [{ type: "text", text: firstName(name) || "Doctor" }] },
        qr(0, "START"), qr(1, "BROCHURE"), qr(2, "TESTIMONIALS"),
      ],
    },
  };
}

module.exports = async function handler(req, res) {
  const q = req.query || Object.fromEntries(new URL(req.url, "http://x").searchParams);
  const form = req.method === "POST" ? await readForm(req) : {};
  const p = { ...q, ...form };
  if (!keyOk(p.k)) return page(res, 403, "Link not valid", "<p>This invite link is missing its key or the key has changed. Check the Send invite button formula in Airtable.</p>");

  const to = AT.phone(p.to).replace(/^\+/, "");
  const rec = /^rec[A-Za-z0-9]{14}$/.test(p.rec || "") ? p.rec : "";
  const name = String(p.name || "").slice(0, 80);
  if (!/^\d{8,15}$/.test(to)) return page(res, 400, "Check the number", `<p>“${esc(p.to)}” doesn't look like a WhatsApp number. Fix it in Airtable and press the button again.</p>`);

  if (req.method === "GET") {
    return page(res, 200, "Send WhatsApp invite?",
      `<p>Send the RS Practice Health Check invite to <span class="n">${esc(name || "this doctor")}</span> on <span class="n">+${esc(to)}</span>?</p>
<form method="post"><input type="hidden" name="k" value="${esc(p.k)}"><input type="hidden" name="rec" value="${esc(rec)}"><input type="hidden" name="to" value="${esc(to)}"><input type="hidden" name="name" value="${esc(name)}"><button>Send invite</button></form>
<p class="muted">They'll get one WhatsApp message with buttons to start the Health Check, see the brochure or read reviews.</p>`);
  }
  if (req.method !== "POST") return res.status(405).end();

  const token = process.env.WA_TOKEN, phoneId = process.env.WA_PHONE_NUMBER_ID;
  if (!token || !phoneId) return page(res, 503, "WhatsApp isn't connected yet", "<p>The WhatsApp number hasn't been set up on the server, so nothing was sent.</p>");

  const r = await fetch(`${GRAPH}/${phoneId}/messages`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(template(to, name)),
  });
  if (!r.ok) {
    const err = (await r.text()).slice(0, 400);
    console.error("Invite failed", r.status, err);
    return page(res, 502, "Invite not sent", `<p>WhatsApp refused the message. The usual reasons are that the invite template isn't approved yet, or (on a test number) this number isn't on the allowed list.</p><p class="muted">${esc(err)}</p>`);
  }

  const hook = process.env.MAKE_WEBHOOK_URL;
  if (hook && rec) {
    try {
      await fetch(hook, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "invite", src: "airtable", submittedAt: new Date().toISOString(), doctor: { name, whatsapp: "+" + to }, airtable: AT.forInvite({ recordId: rec, whatsapp: to }) }) });
    } catch (e) { console.error("Make invite log failed", e.message); }
  }
  return page(res, 200, "Invite sent ✓", `<p>${esc(name || "The doctor")} will get the invite on WhatsApp shortly. Their status in Airtable changes to <b>Invited</b>.</p><p class="muted">You can close this tab.</p>`);
};

module.exports._template = template;
