// Checks the Airtable bodies sent to Make, and the invite endpoint. Run: npm test
const assert = require("assert");
const AT = require("../api/_airtable.js");

assert.strictEqual(AT.phone("082 555 0142"), "+27825550142");
assert.strictEqual(AT.phone("+27 82 555 0142"), "+27825550142");
assert.strictEqual(AT.phone("27825550142"), "+27825550142");
assert.strictEqual(AT.phone("0027825550142"), "+27825550142");

const web = AT.forAssessment({
  src: "web", rid: "abc", submittedAt: "2026-11-18T10:00:00.000Z", scoringVersion: "1.0", consent: true, turnover: "Above R15 million", challenge: "Cash flow",
  doctor: { name: "Dr Priya Naidoo", practice: "Naidoo Family Practice", specialty: "GP", address: "Cape Town", whatsapp: "082 555 0142", email: "p@example.com" },
  answers: Object.fromEntries([...Array(13)].map((_, i) => ["q" + (i + 1), 4])),
  scores: { overall: 80, classification: "HEALTHY", domains: { "Business Strategy": 80, "Financial Health": 80, "Operational Excellence": 80, "Team & Systems": 80, "Patient Experience": 80, "Growth Readiness": 80 } },
});
const d = JSON.parse(web.doctorBody);
assert.deepStrictEqual(d.performUpsert.fieldsToMergeOn, ["WA ID"]);
assert.strictEqual(d.records[0].fields["WA ID"], "27825550142");
assert.strictEqual(d.records[0].fields.WhatsApp, "+27825550142");
assert.strictEqual(d.records[0].fields["Commercial tier"], "Tier 3");
assert.strictEqual(d.records[0].fields.Source, "Website");
const c = JSON.parse(web.childBody);
assert.strictEqual(web.childTable, "Assessments");
assert.deepStrictEqual(c.records[0].fields.Doctor, [AT.DOCTOR_ID]);
assert.strictEqual(c.records[0].fields["Q13 3–5 year plan"], 4);
assert.strictEqual(c.records[0].fields["Team & Systems %"], 80);
assert.strictEqual(c.records[0].fields["Total score"], 52);
assert.strictEqual(Object.keys(c.records[0].fields).filter(k => /^Q\d+ /.test(k)).length, 13);

// A WhatsApp visit must not blank out practice details typed on the website
const wa = JSON.parse(AT.forAssessment({ src: "wa", doctor: { name: "Priya", practice: "", whatsapp: "+27825550142" }, scores: {} }).doctorBody);
assert.ok(!("Practice" in wa.records[0].fields));

const inv = JSON.parse(AT.forInvite({ recordId: "recABCDEFGHIJKLMN", whatsapp: "0825550142" }).doctorBody);
assert.strictEqual(inv.records[0].id, "recABCDEFGHIJKLMN");
assert.strictEqual(inv.records[0].fields.Status, "Invited");
assert.strictEqual(inv.records[0].fields["WA ID"], "27825550142");
assert.ok(!inv.performUpsert);

// Invite endpoint
process.env.INVITE_KEY = "test-key-123";
process.env.WA_TOKEN = "t"; process.env.WA_PHONE_NUMBER_ID = "1"; process.env.MAKE_WEBHOOK_URL = "https://make.test/hook";
const calls = [];
global.fetch = async (url, o) => { calls.push({ url, body: JSON.parse(o.body) }); return { ok: true, status: 200, text: async () => "" }; };
const invite = require("../api/invite.js");
const mkRes = () => { const r = { code: 0, out: "", headers: {} }; r.status = c => (r.code = c, r); r.send = s => (r.out = s, r); r.end = () => r; r.setHeader = (k, v) => (r.headers[k] = v); return r; };
(async () => {
  const q = { k: "test-key-123", rec: "recABCDEFGHIJKLMN", to: "082 555 0142", name: "Dr Priya Naidoo" };
  let r = mkRes(); await invite({ method: "GET", query: { ...q, k: "wrong-key-123" } }, r); assert.strictEqual(r.code, 403);
  r = mkRes(); await invite({ method: "GET", query: q }, r); assert.strictEqual(r.code, 200); assert.match(r.out, /\+27825550142/); assert.strictEqual(calls.length, 0, "GET must not send");
  r = mkRes(); await invite({ method: "POST", query: {}, body: q }, r); assert.strictEqual(r.code, 200);
  const t = calls[0].body; assert.strictEqual(t.to, "27825550142"); assert.strictEqual(t.type, "template");
  assert.strictEqual(t.template.components[0].parameters[0].text, "Priya Naidoo");
  assert.deepStrictEqual(t.template.components.slice(1).map(b => b.parameters[0].payload), ["START", "BROCHURE", "TESTIMONIALS"]);
  assert.strictEqual(calls[1].body.type, "invite");
  console.log("Airtable bodies and invite endpoint tests pass");
})().catch(e => { console.error(e); process.exit(1); });
