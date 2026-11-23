// Simulates a doctor going through the WhatsApp Health Check. Run: npm test
const assert = require("assert");
process.env.WA_TOKEN = "test";
process.env.WA_PHONE_NUMBER_ID = "123";
process.env.MAKE_WEBHOOK_URL = "https://make.test/hook";
process.env.RS_STORE = "memory";

const sent = [];
const saved = [];
global.fetch = async (url, opts) => {
  const body = JSON.parse(opts.body);
  if (url.startsWith("https://graph.facebook.com")) sent.push(body);
  else saved.push(body);
  return { ok: true, status: 200, text: async () => "" };
};

const { _handle: handle } = require("../api/whatsapp.js");
const FROM = "27825550142";
const textMsg = body => ({ from: FROM, type: "text", text: { body } });
const tap = id => ({ from: FROM, type: "interactive", interactive: { list_reply: { id } } });
const last = () => sent[sent.length - 1];

function checkLimits(p) {
  if (p.type !== "interactive") return;
  const i = p.interactive;
  assert.ok(i.body.text.length <= 1024, "body too long");
  if (i.header) assert.ok(i.header.text.length <= 60, "header too long");
  if (i.type === "button") {
    assert.ok(i.action.buttons.length <= 3);
    i.action.buttons.forEach(b => { assert.ok(b.reply.title.length <= 20, "button title " + b.reply.title); assert.ok(b.reply.id.length <= 256); });
  }
  if (i.type === "list") {
    assert.ok(i.action.button.length <= 20);
    i.action.sections.forEach(s => {
      assert.ok(s.title.length <= 24);
      assert.ok(s.rows.length <= 10);
      s.rows.forEach(r => { assert.ok(r.title.length <= 24, "row title " + r.title); assert.ok(r.id.length <= 200); if (r.description) assert.ok(r.description.length <= 72); });
    });
  }
}
const rowId = (p, title) => {
  const i = p.interactive;
  const items = i.type === "list" ? i.action.sections[0].rows.map(r => ({ id: r.id, title: r.title })) : i.action.buttons.map(b => b.reply);
  const hit = items.find(x => x.title.startsWith(title));
  assert.ok(hit, `no option "${title}" in ${items.map(x => x.title).join(", ")}`);
  return hit.id;
};

(async () => {
  const P = "Priya Naidoo"; // WhatsApp profile name
  await handle(textMsg("Hi"), P);
  assert.match(last().interactive.body.text, /Dr Priya/);
  await handle(tap(rowId(last(), "About RS")), P);
  assert.ok(sent.some(p => p.interactive && p.interactive.type === "cta_url" && /\/about$/.test(p.interactive.action.parameters.url)));
  await handle(tap(rowId(last(), "What doctors say")), P);
  assert.ok(sent.some(p => p.interactive && p.interactive.type === "cta_url" && p.interactive.action.parameters.display_text === "Read reviews"));
  await handle(tap(rowId(last(), "Start Health Check")), P);
  // 1. About your practice (typed)
  assert.match(last().text.body, /What is your name/);
  await handle(textMsg("Dr Priya Naidoo"), P);
  assert.match(last().text.body, /name of your practice/);
  await handle(textMsg("Naidoo Family Practice"), P);
  assert.match(last().text.body, /speciality/);
  await handle(textMsg("General Practitioner"), P);
  // 2. The 13 statements
  const labels = { 5: "Strongly agree", 4: "Agree", 3: "Partly", 2: "Disagree", 1: "Strongly disagree" };
  assert.match(last().interactive.body.text, /clear business goals for the next 12–24 months/);
  assert.deepStrictEqual(last().interactive.action.sections[0].rows.map(r => r.description), ["Consistently", "Usually", "Sometimes", "Rarely", "Never"]);
  const ans = [3, 4, 3, 4, 3, 4, 3, 4, 4, 4, 3, 3, 3];
  for (const v of ans) await handle(tap(rowId(last(), labels[v])), P);
  // 3. Biggest challenge (typed), then 4. turnover last
  assert.match(last().interactive.body.text, /single biggest frustration/);
  await handle(textMsg("Medical aid rejections are hurting our cash flow."), P);
  assert.match(last().interactive.body.text, /approximate annual turnover/);
  await handle(tap(rowId(last(), "R5 million – R15 million")), P);
  const sum = last().interactive.body.text;
  assert.match(sum, /Is this right/);
  assert.match(sum, /Naidoo Family Practice · General Practitioner/);
  assert.match(sum, /Biggest challenge:\* Medical aid rejections/);
  // Edit Q13 to Strongly agree
  await handle(tap(rowId(last(), "Edit")), P);
  await handle(tap(rowId(last(), "Growth Readiness")), P);
  await handle(tap(rowId(last(), "13.")), P);
  await handle(tap(rowId(last(), "Strongly agree")), P);
  assert.match(last().interactive.body.text, /13\. 3–5 year plan: Strongly agree/);
  // Edit practice details from the summary
  await handle(tap(rowId(last(), "Edit")), P);
  await handle(tap(rowId(last(), "About your practice")), P);
  await handle(textMsg("Dr P. Naidoo"), P);
  await handle(textMsg("Naidoo Family Practice"), P);
  await handle(textMsg("Family Medicine"), P);
  assert.match(last().interactive.body.text, /Dr P\. Naidoo\nNaidoo Family Practice · Family Medicine/);
  await handle(tap(rowId(last(), "Confirm")), P);
  const res = sent.filter(p => p.type === "text").pop().text.body;
  assert.match(res, /Thank you, Dr P\./);
  assert.match(res, /Practice Health Score: 72\.3%/);
  assert.match(res, /GOOD/);
  const a = saved.find(s => s.type === "assessment");
  assert.strictEqual(a.doctor.whatsapp, "+" + FROM);
  assert.strictEqual(a.doctor.name, "Dr P. Naidoo");
  assert.strictEqual(a.doctor.practice, "Naidoo Family Practice");
  assert.strictEqual(a.doctor.specialty, "Family Medicine");
  assert.strictEqual(a.challenge, "Medical aid rejections are hurting our cash flow.");
  assert.strictEqual(a.turnover, "R5 million – R15 million");
  assert.strictEqual(a.answers.q13, 5);
  assert.strictEqual(a.scores.classification, "GOOD");
  assert.strictEqual(a.airtable.childTable, "Assessments");
  assert.match(a.airtable.doctorBody, /"WhatsApp":"\+27825550142"/);
  assert.match(a.airtable.doctorBody, /"Practice":"Naidoo Family Practice"/);
  // After finishing, a typed message is saved as a note for RS, and the menu comes back
  await handle(textMsg("Can someone call me tomorrow?"), P);
  assert.ok(saved.some(s => s.type === "message" && /call me/.test(s.challenge)));
  assert.match(last().interactive.body.text, /Welcome/);
  // Skip the challenge, and pick "Prefer to discuss"
  await handle(tap("S|x|3333333333333"), P);
  await handle(tap(rowId(last(), "Skip")), P);
  await handle(tap(rowId(last(), "Prefer to discuss")), P);
  assert.match(last().interactive.body.text, /Turnover:\* Prefer to discuss during the consultation/);
  // Tampered ids fall back to the welcome menu
  await handle(tap("S|9|xyz"), P);
  assert.match(last().interactive.body.text, /Welcome/);
  sent.forEach(checkLimits);
  console.log(`WhatsApp flow test passes (${sent.length} messages, all within WhatsApp limits)`);
})().catch(e => { console.error(e); process.exit(1); });
