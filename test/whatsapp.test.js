// Simulates a doctor going through the WhatsApp Health Check. Run: npm test
const assert = require("assert");
process.env.WA_TOKEN = "test";
process.env.WA_PHONE_NUMBER_ID = "123";
process.env.MAKE_WEBHOOK_URL = "https://make.test/hook";

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
  await handle(textMsg("Hi"), "Priya Naidoo");
  assert.match(last().interactive.body.text, /Dr Priya/);
  await handle(tap(rowId(last(), "View our brochure")), "Priya Naidoo");
  assert.ok(sent.some(p => p.type === "document"));
  await handle(tap(rowId(last(), "Start Health Check")), "Priya Naidoo");
  await handle(tap(rowId(last(), "R5–15 million")), "Priya Naidoo");
  const labels = { 5: "Strongly agree", 4: "Agree", 3: "Partly", 2: "Disagree", 1: "Strongly disagree" };
  const ans = [3, 4, 3, 4, 3, 4, 3, 4, 4, 4, 3, 3, 3];
  for (const v of ans) await handle(tap(rowId(last(), labels[v])), "Priya Naidoo");
  assert.match(last().interactive.body.text, /Is this right/);
  // Edit Q13 to Strongly agree
  await handle(tap(rowId(last(), "Edit")), "Priya Naidoo");
  await handle(tap(rowId(last(), "Growth Readiness")), "Priya Naidoo");
  await handle(tap(rowId(last(), "13.")), "Priya Naidoo");
  await handle(tap(rowId(last(), "Strongly agree")), "Priya Naidoo");
  assert.match(last().interactive.body.text, /13\. Ready to expand: Strongly agree/);
  await handle(tap(rowId(last(), "Confirm")), "Priya Naidoo");
  const res = sent.filter(p => p.type === "text").pop().text.body;
  assert.match(res, /Practice Health Score: 72\.2%/);
  assert.match(res, /HEALTHY/);
  const a = saved.find(s => s.type === "assessment");
  assert.strictEqual(a.doctor.whatsapp, "+" + FROM);
  assert.strictEqual(a.turnover, "R5–15 million");
  assert.strictEqual(a.answers.q13, 5);
  assert.strictEqual(a.scores.classification, "HEALTHY");
  // Typed message is saved as a note for RS, and the menu comes back
  await handle(textMsg("Can someone call me tomorrow?"), "Priya Naidoo");
  assert.ok(saved.some(s => s.type === "message" && /call me/.test(s.challenge)));
  // Tampered ids fall back to the welcome menu
  await handle(tap("S|9|xyz"), "Priya Naidoo");
  assert.match(last().interactive.body.text, /Welcome/);
  sent.forEach(checkLimits);
  console.log(`WhatsApp flow test passes (${sent.length} messages, all within WhatsApp limits)`);
})().catch(e => { console.error(e); process.exit(1); });
