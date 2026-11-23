// Calendly → WhatsApp: thanks the doctor in the WhatsApp chat as soon as they book (or cancel) their consultation.
//
// How the booking finds the doctor: the bot's "Book consultation" link carries the doctor's WhatsApp number
// (utm_content), and Calendly sends it back with the booking.
//
// Env vars (Vercel):
//   CALENDLY_TOKEN   Calendly personal access token (Calendly → Integrations → API and webhooks).
//                    Webhooks need a paid Calendly plan (Standard or higher, or the free trial).
//   WA_VERIFY_TOKEN  also protects the one-tap setup link below and seeds the webhook signing key.
//
// One-tap setup (after CALENDLY_TOKEN is saved): open /api/calendly?k=<WA_VERIFY_TOKEN>&setup=1
// (the bot status page has the button). It registers this endpoint with Calendly.

const crypto = require("crypto");
const AT = require("./_airtable.js");
const store = require("./_store.js");
const CFG = require("./_config.js");
const { _send: send } = require("./whatsapp.js");

const API = "https://api.calendly.com";
const TZ = "Africa/Johannesburg";

const signingKey = () => crypto.createHash("sha256").update("rs-calendly:" + (process.env.WA_VERIFY_TOKEN || "")).digest("hex").slice(0, 48);
const bare = name => String(name || "").replace(/^\s*(dr\.?|doctor|prof\.?)\s+/i, "").trim();
const first = name => bare(name).split(/\s+/)[0] || "";
const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function when(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return "";
  const day = d.toLocaleDateString("en-ZA", { timeZone: TZ, weekday: "long", day: "numeric", month: "long" });
  const time = d.toLocaleTimeString("en-ZA", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false });
  return `${day} at ${time}`;
}

// The doctor's WhatsApp number: from the bot's link first, then any phone number they typed into Calendly.
function waNumber(p) {
  const t = p.tracking || {};
  const tries = [t.utm_content, p.text_reminder_number, ...(p.questions_and_answers || []).map(q => q.answer)];
  for (const x of tries) {
    let d = String(x || "").replace(/\D/g, "");
    if (d.startsWith("0") && d.length === 10) d = "27" + d.slice(1);
    if (d.length >= 10 && d.length <= 15) return d;
  }
  return "";
}

function verify(raw, header) {
  const parts = Object.fromEntries(String(header || "").split(",").map(x => x.trim().split("=")));
  if (!parts.t || !parts.v1) return false;
  const expected = crypto.createHmac("sha256", signingKey()).update(`${parts.t}.${raw}`).digest("hex");
  if (expected.length !== parts.v1.length || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(parts.v1))) return false;
  return Math.abs(Date.now() / 1000 - Number(parts.t)) < 3 * 60 * 60; // reject old replays
}

const textMsg = body => ({ type: "text", text: { body, preview_url: false } });

async function onBooked(p) {
  const to = waNumber(p);
  const ev = p.scheduled_event || {};
  const at = when(ev.start_time);
  const hi = first(p.name) ? `Thank you, Dr ${first(p.name)}! 🙏` : "Thank you, Doctor! 🙏";
  const join = ev.location && ev.location.join_url;
  let ok = false;
  if (to) {
    ok = await send(to, textMsg(
      `${hi}\n\nYour complimentary consultation with an RS consultant is booked${at ? ` for *${at}*` : ""}. ` +
      `A calendar invite is on its way to ${p.email ? p.email : "your email"}.\n\n` +
      "We'll go through your Practice Health Check results together and talk about your biggest priorities. " +
      "Afterwards you'll receive your RS Practice Health Report™ with clear recommendations." +
      (join ? `\n\nJoin the call here: ${join}` : "") +
      (p.reschedule_url ? `\n\nNeed a different time? Reschedule here: ${p.reschedule_url}` : "") +
      "\n\nWe look forward to meeting you. 🩺"));
  }
  await log({ to, p, status: "Consultation booked", note: `Booked consultation${at ? " for " + at : ""} (${ev.name || "Calendly"})`, ok });
  return { to, ok };
}

async function onCanceled(p) {
  if (p.rescheduled) return { skipped: "rescheduled" }; // a new booking event follows
  const to = waNumber(p);
  const ev = p.scheduled_event || {};
  let ok = false;
  if (to) {
    const u = new URL(CFG.calendlyUrl);
    if (p.name) u.searchParams.set("name", p.name);
    if (p.email) u.searchParams.set("email", p.email);
    u.searchParams.set("utm_source", "whatsapp");
    u.searchParams.set("utm_content", to);
    ok = await send(to, textMsg(
      `${first(p.name) ? `Dr ${first(p.name)}, y` : "Y"}our consultation${ev.start_time ? ` on ${when(ev.start_time)}` : ""} has been cancelled. ` +
      `No problem at all. Whenever suits you, you can book a new time here:\n${u}`));
  }
  await log({ to, p, status: "Consultation cancelled", note: `Cancelled consultation${ev.start_time ? " for " + when(ev.start_time) : ""}${p.cancellation && p.cancellation.reason ? ": " + p.cancellation.reason : ""}`, ok });
  return { to, ok };
}

async function log({ to, p, status, note, ok }) {
  await store.set("diag:calendly", { at: new Date().toISOString(), status, matched: Boolean(to), whatsappSent: ok });
  const url = process.env.MAKE_WEBHOOK_URL;
  if (!url || !to) return;
  try {
    await fetch(url, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "booking", src: "calendly", submittedAt: new Date().toISOString(), doctor: { name: p.name || "", email: p.email || "", whatsapp: "+" + to }, status, note,
        airtable: AT.forBooking({ whatsapp: to, name: p.name, email: p.email, status, note }) }),
    });
  } catch (e) { console.error("Make booking save failed", e.message); }
}

// One-tap setup: register this endpoint as a Calendly webhook (replacing any older one for the same address).
async function setup(req) {
  const token = (process.env.CALENDLY_TOKEN || "").trim();
  if (!token) return { ok: false, msg: "CALENDLY_TOKEN isn't set in Vercel yet." };
  const H = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const me = await (await fetch(`${API}/users/me`, { headers: H })).json();
  if (!me.resource) return { ok: false, msg: `Calendly didn't accept the token: ${me.message || me.title || "unknown error"}` };
  const user = me.resource.uri, org = me.resource.current_organization;
  const url = `https://${req.headers["x-forwarded-host"] || req.headers.host}/api/calendly`;
  const list = await (await fetch(`${API}/webhook_subscriptions?${new URLSearchParams({ organization: org, user, scope: "user" })}`, { headers: H })).json();
  for (const w of list.collection || []) if (w.callback_url === url) await fetch(w.uri, { method: "DELETE", headers: H });
  const r = await fetch(`${API}/webhook_subscriptions`, {
    method: "POST", headers: H,
    body: JSON.stringify({ url, events: ["invitee.created", "invitee.canceled"], organization: org, user, scope: "user", signing_key: signingKey() }),
  });
  const j = await r.json();
  if (!r.ok) return { ok: false, msg: `Calendly said: ${j.message || j.title || r.status}${r.status === 403 ? " (webhooks need a paid Calendly plan or the free trial)" : ""}` };
  await store.set("diag:calendlySetup", { at: new Date().toISOString(), user: me.resource.name || "" });
  return { ok: true, msg: `Connected to ${me.resource.name || "your Calendly"}. New bookings will now be thanked on WhatsApp.` };
}

async function rawBody(req) {
  if (typeof req.body === "string") return req.body;
  if (Buffer.isBuffer(req.body)) return req.body.toString("utf8");
  if (req.body && typeof req.body === "object") return JSON.stringify(req.body);
  const chunks = [];
  if (req[Symbol.asyncIterator]) for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks).toString("utf8");
}

module.exports = async function handler(req, res) {
  if (req.method === "GET") {
    const q = req.query || Object.fromEntries(new URL(req.url, "http://x").searchParams);
    const key = (process.env.WA_VERIFY_TOKEN || "").trim();
    if (!key || q.k !== key || !q.setup) return res.status(403).send("Forbidden");
    let out;
    try { out = await setup(req); } catch (e) { out = { ok: false, msg: e.message }; }
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(200).send(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Calendly setup</title>
<body style="font:17px/1.5 system-ui;padding:24px;max-width:560px;margin:auto"><h1 style="font-size:22px">${out.ok ? "✅" : "❌"} Calendly booking thank-you</h1><p>${esc(out.msg)}</p>
<p><a href="/api/status?k=${encodeURIComponent(q.k)}">Back to bot status</a></p></body>`);
  }
  if (req.method !== "POST") return res.status(405).end();
  const raw = await rawBody(req);
  if (!verify(raw, req.headers["calendly-webhook-signature"])) return res.status(401).end();
  let body;
  try { body = JSON.parse(raw); } catch { return res.status(400).end(); }
  try {
    const p = body.payload || {};
    if (body.event === "invitee.created") await onBooked(p);
    else if (body.event === "invitee.canceled") await onCanceled(p);
  } catch (e) { console.error("Calendly handler error", e); }
  return res.status(200).json({ ok: true });
};

module.exports._signingKey = signingKey;
module.exports._when = when;
