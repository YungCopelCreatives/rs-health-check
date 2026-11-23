// Simulates Calendly telling the bot about a booking and a cancellation. Run: npm test
const assert = require("assert");
const crypto = require("crypto");
process.env.WA_TOKEN = "test";
process.env.WA_PHONE_NUMBER_ID = "123";
process.env.WA_VERIFY_TOKEN = "verify";
process.env.MAKE_WEBHOOK_URL = "https://make.test/hook";
process.env.RS_STORE = "memory";

const sent = [], saved = [];
global.fetch = async (url, opts) => {
  const body = JSON.parse(opts.body);
  (String(url).startsWith("https://graph.facebook.com") ? sent : saved).push(body);
  return { ok: true, status: 200, text: async () => "", json: async () => ({}) };
};
const handler = require("../api/calendly.js");

function call(event, payload, sign = true) {
  const raw = JSON.stringify({ event, payload });
  const t = Math.floor(Date.now() / 1000);
  const v1 = crypto.createHmac("sha256", handler._signingKey()).update(`${t}.${raw}`).digest("hex");
  const res = { status(c) { this.code = c; return this; }, json() { return this; }, end() { return this; }, send() { return this; }, setHeader() {} };
  return handler({ method: "POST", body: raw, headers: { "calendly-webhook-signature": sign ? `t=${t},v1=${v1}` : "t=1,v1=bad" } }, res).then(() => res);
}

(async () => {
  const booking = {
    name: "Dr Priya Naidoo", email: "priya@example.com", reschedule_url: "https://calendly.com/reschedulings/abc",
    tracking: { utm_source: "whatsapp", utm_content: "27825550142" },
    scheduled_event: { name: "30 Minute Meeting", start_time: "2026-11-25T08:00:00.000000Z" },
  };
  assert.strictEqual((await call("invitee.created", booking, false)).code, 401, "unsigned calls are refused");
  assert.strictEqual(sent.length, 0);

  assert.strictEqual((await call("invitee.created", booking)).code, 200);
  assert.strictEqual(sent.length, 1);
  assert.strictEqual(sent[0].to, "27825550142");
  const msg = sent[0].text.body;
  assert.match(msg, /Thank you, Dr Priya/);
  assert.match(msg, /Wednesday, 25 November at 10:00|Wednesday 25 November at 10:00/);
  assert.match(msg, /reschedulings\/abc/);
  const at = JSON.parse(saved[0].airtable.doctorBody);
  assert.strictEqual(at.records[0].fields.Status, "Consultation booked");
  assert.strictEqual(at.records[0].fields["WA ID"], "27825550142");

  await call("invitee.canceled", { ...booking, rescheduled: true });
  assert.strictEqual(sent.length, 1, "a reschedule sends nothing extra");
  await call("invitee.canceled", { ...booking, tracking: {}, questions_and_answers: [{ question: "WhatsApp", answer: "082 555 0142" }] });
  assert.strictEqual(sent.length, 2);
  assert.strictEqual(sent[1].to, "27825550142");
  assert.match(sent[1].text.body, /cancelled[\s\S]*utm_content=27825550142/);
  console.log("Calendly booking thank-you tests pass");
})().catch(e => { console.error(e); process.exit(1); });
