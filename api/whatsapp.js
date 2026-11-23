// WhatsApp Cloud API webhook: runs the whole RS Practice Health Check inside WhatsApp.
//
// Env vars (Vercel → Settings → Environment Variables):
//   WA_TOKEN            access token for the WhatsApp Cloud API (system user token in production)
//   WA_PHONE_NUMBER_ID  the number's Phone Number ID from Meta's API Setup page
//   WA_VERIFY_TOKEN     any secret string; paste the same value into Meta's webhook settings
//   WA_APP_SECRET       (optional) Meta app secret, to check that requests really come from Meta
//   MAKE_WEBHOOK_URL    Make webhook that saves results (shared with /api/submit)
//
// Order follows RS's questionnaire: about your practice (typed), 13 statements, biggest challenge (typed),
// turnover, then confirm. The 13 answers and turnover travel in each list row's id
// (e.g. "S|x|3443" = no turnover yet, answers 3,4,4,3; "S|2|..." = turnover option 2), so a doctor can pick up
// from any earlier message. Typed answers need memory, kept in Upstash (see api/_store.js).

const crypto = require("crypto");
const S = require("../assets/scoring.js");
const CFG = require("./_config.js");
const AT = require("./_airtable.js");
const store = require("./_store.js");

const GRAPH = "https://graph.facebook.com/v21.0";
const QUESTIONS = S.DOMAINS.flatMap(d => d.questions.map(q => ({ ...q, domain: d })));

// ---------- WhatsApp senders ----------
async function send(to, payload) {
  const token = process.env.WA_TOKEN;
  const phoneId = process.env.WA_PHONE_NUMBER_ID;
  if (!token || !phoneId) {
    console.log("WA not configured; would send:", JSON.stringify(payload).slice(0, 300));
    await store.set("diag:sendError", { at: new Date().toISOString(), status: 0, error: "WA_TOKEN or WA_PHONE_NUMBER_ID missing" });
    return;
  }
  const r = await fetch(`${GRAPH}/${phoneId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to, ...payload }),
  });
  if (!r.ok) {
    const err = (await r.text()).slice(0, 500);
    console.error("WA send failed", r.status, err);
    await store.set("diag:sendError", { at: new Date().toISOString(), status: r.status, error: err });
  } else {
    await store.set("diag:sendOk", { at: new Date().toISOString() });
  }
}

const text = (to, body) => send(to, { type: "text", text: { body, preview_url: true } });

function buttons(to, body, btns, header) {
  return send(to, {
    type: "interactive",
    interactive: {
      type: "button",
      ...(header ? { header: { type: "text", text: header.slice(0, 60) } } : {}),
      body: { text: body.slice(0, 1024) },
      footer: { text: "RS Medical Consultancy" },
      action: { buttons: btns.slice(0, 3).map(b => ({ type: "reply", reply: { id: b.id, title: b.title.slice(0, 20) } })) },
    },
  });
}

function list(to, body, buttonText, rows, header, sectionTitle) {
  return send(to, {
    type: "interactive",
    interactive: {
      type: "list",
      ...(header ? { header: { type: "text", text: header.slice(0, 60) } } : {}),
      body: { text: body.slice(0, 1024) },
      footer: { text: "RS Practice Health Check™" },
      action: {
        button: buttonText.slice(0, 20),
        sections: [{ title: (sectionTitle || "Choose one").slice(0, 24), rows: rows.slice(0, 10).map(r => ({ id: r.id.slice(0, 200), title: r.title.slice(0, 24), ...(r.description ? { description: r.description.slice(0, 72) } : {}) })) }],
      },
    },
  });
}

function ctaUrl(to, body, label, url) {
  return send(to, {
    type: "interactive",
    interactive: { type: "cta_url", body: { text: body.slice(0, 1024) }, action: { name: "cta_url", parameters: { display_text: label.slice(0, 20), url } } },
  });
}

// ---------- Copy ----------
const SCALE_ROWS = S.SCALE.slice().reverse().map(x => {
  const [title, description] = x.label.split(" / ");
  return { v: x.value, title, description };
});
const SHORT = { 1: "Strongly disagree", 2: "Disagree", 3: "Partly", 4: "Agree", 5: "Strongly agree" };
const bare = name => String(name || "").replace(/^\s*(dr\.?|doctor|prof\.?)\s+/i, "").trim();
const first = name => bare(name).split(/\s+/)[0] || "";
const key = to => "wa:" + to;
// WhatsApp list rows are 24 characters at most.
const turnoverTitle = t => (t.length > 24 ? "Prefer to discuss" : t);

function welcome(to, name) {
  const hi = first(name) ? `Good day, Dr ${first(name)} 👋🏽` : "Good day, Doctor 👋🏽";
  return buttons(to,
    `${hi}\n\nWelcome to the *RS Practice Health Check™*, a complimentary business assessment for doctors in private practice.\n\n` +
    "A few details about your practice, then 13 quick statements across six areas. It takes about 5 minutes, right here in WhatsApp, and you'll see your score straight away.\n\n" +
    "No obligation. No commitment. Just an expert second opinion on your practice. 🩺",
    [{ id: "START", title: "Start Health Check" }, { id: "BROCHURE", title: "View our brochure" }, { id: "REVIEWS", title: "What doctors say" }],
    "YOUR PATIENTS GET HEALTH CHECKS. DOES YOUR PRACTICE?");
}

// Step 1: about your practice (typed answers). Skipped if the bot has no memory connected.
async function startDetails(to, back) {
  if (!store.enabled()) return startQuestions(to);
  // A fresh start forgets earlier answers; an edit from the summary keeps the challenge.
  const st = back ? (await store.get(key(to))) || {} : {};
  await store.set(key(to), { ...st, step: "name", back });
  return text(to, (back ? "" : "Wonderful! 🙌 First, a few details about your practice.\n\n") + "What is your name?");
}

function startQuestions(to) {
  return text(to, "Thank you. Now 13 short statements. Tap *Choose answer* under each one. 👇").then(() => askQuestion(to, "x", ""));
}

// After the 13 statements: biggest challenge (typed, optional)
async function askChallenge(to, ans, back) {
  if (!store.enabled()) return askTurnover(to, ans);
  const st = (await store.get(key(to))) || {};
  await store.set(key(to), { ...st, step: "challenge", ans, ...(back ? { back } : { back: undefined }) });
  return buttons(to, "What is the single biggest frustration or challenge you currently have with your practice?\n\nType it in a message, or tap Skip.",
    [{ id: `K|${back ? back.t : "x"}|${ans}`, title: "Skip" }], "Your biggest challenge");
}

function askTurnover(to, ans) {
  return list(to,
    "Last one: what is the approximate annual turnover of your practice?\n\nThis stays confidential and doesn't affect your score.",
    "Choose turnover",
    S.TURNOVER.map((t, i) => ({ id: `S|${i}|${ans}`, title: turnoverTitle(t), ...(t.length > 24 ? { description: "During the consultation" } : {}) })),
    "Practice turnover", "Annual turnover");
}

// Typed replies while the bot is waiting for one. Returns true if the message was used.
async function typedAnswer(to, body) {
  const st = await store.get(key(to));
  if (!st || !st.step || st.step === "done") return false;
  const v = body.trim().slice(0, st.step === "challenge" ? 1500 : 120);
  if (!v) return false;
  if (st.step === "name") {
    await store.set(key(to), { ...st, name: v, step: "practice" });
    await text(to, "And the name of your practice?");
  } else if (st.step === "practice") {
    await store.set(key(to), { ...st, practice: v, step: "specialty" });
    await text(to, "What is your medical speciality?");
  } else if (st.step === "specialty") {
    await store.set(key(to), { ...st, specialty: v, step: "done", back: undefined });
    if (st.back) await summary(to, st.back.t, st.back.ans);
    else await startQuestions(to);
  } else if (st.step === "challenge") {
    await store.set(key(to), { ...st, challenge: v, step: "done", back: undefined });
    if (st.back) await summary(to, st.back.t, st.back.ans);
    else await askTurnover(to, st.ans);
  } else return false;
  return true;
}

function askQuestion(to, t, ans) {
  const q = QUESTIONS[ans.length];
  return list(to,
    `*${q.domain.name}*\n\n${q.text}\n\nHow much do you agree?`,
    "Choose answer",
    SCALE_ROWS.map(r => ({ id: `S|${t}|${ans}${r.v}`, title: r.title, description: r.description })),
    `Statement ${q.n} of 13`, `Statement ${q.n}`);
}

async function summary(to, t, ans) {
  const st = (await store.get(key(to))) || {};
  const cut = (v, n) => (v && v.length > n ? v.slice(0, n - 1) + "…" : v || "");
  const about = st.name ? `*About your practice*\n${cut(st.name, 50)}\n${[cut(st.practice, 50), cut(st.specialty, 40)].filter(Boolean).join(" · ")}\n\n` : "";
  const lines = S.DOMAINS.map(d => `*${d.name}*\n` + d.questions.map(q => `${q.n}. ${q.short}: ${SHORT[+ans[q.n - 1]]}`).join("\n")).join("\n\n");
  const ch = st.challenge ? (st.challenge.length > 90 ? st.challenge.slice(0, 89) + "…" : st.challenge) : "";
  const challenge = store.enabled() ? `\n\n*Biggest challenge:* ${ch || "Not provided"}` : "";
  return buttons(to,
    `${about}${lines}${challenge}\n*Turnover:* ${S.TURNOVER[t]}\n\nIs this right?`,
    [{ id: `C|${t}|${ans}`, title: "Confirm" }, { id: `E|${t}|${ans}`, title: "Edit" }],
    "Check your answers");
}

const pct = p => (Math.round(p * 10) / 10).toFixed(1).replace(/\.0$/, "") + "%";
const dot = p => ({ EXCELLENT: "🟢", GOOD: "🟢", OPPORTUNITY: "🟡", CRITICAL: "🔴" })[S.band(p)];

async function result(to, profileName, t, ans) {
  const st = (await store.get(key(to))) || {};
  const name = st.name || profileName;
  const answers = {};
  for (let i = 0; i < 13; i++) answers[i + 1] = +ans[i];
  const r = S.score(answers);
  const c = S.CLASSIFICATIONS[r.classification];
  const bars = r.domains.map(d => `${dot(d.pct)} ${d.name}: ${pct(d.pct)}`).join("\n");
  await text(to,
    `Thank you${first(name) ? ", Dr " + first(name) : ""}. Here is your result 🩺\n\n` +
    `*Practice Health Score: ${pct(r.overall)}*\n*${r.classification}*: ${c.line}\n\n${bars}\n\n` +
    "_Based on your own self-assessment, not a verified audit._");
  const next = "Book a complimentary consultation with an RS consultant to go through your results. You'll receive your RS Practice Health Report™ with recommendations afterwards.";
  if (CFG.calendlyUrl) {
    const u = new URL(CFG.calendlyUrl);
    if (name) u.searchParams.set("name", name);
    u.searchParams.set("utm_source", "whatsapp");
    u.searchParams.set("utm_content", to);
    await ctaUrl(to, next, "Book consultation", u.toString());
  } else {
    await buttons(to, next, [{ id: "BOOK", title: "Book consultation" }]);
  }
  await saveToMake({ to, name, st, t, answers, r });
  await store.del(key(to));
}

const withAirtable = (p, build) => ({ ...p, airtable: build(p) });

async function saveToMake({ to, name, st, t, answers, r }) {
  const url = process.env.MAKE_WEBHOOK_URL;
  if (!url) return;
  const a = {}; for (let n = 1; n <= 13; n++) a["q" + n] = answers[n];
  const domains = {}; r.domains.forEach(d => { domains[d.name] = Math.round(d.pct * 100) / 100; });
  const flat = { strategy: domains["Business Strategy"], finance: domains["Financial Health"], operations: domains["Operational Excellence"], team: domains["Team & Systems"], patient: domains["Patient Experience"], growth: domains["Growth Readiness"] };
  try {
    await fetch(url, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(withAirtable({
        type: "assessment", rid: "", src: "wa", submittedAt: new Date().toISOString(), scoringVersion: r.version,
        doctor: { name: name || "", practice: st.practice || "", specialty: st.specialty || "", whatsapp: "+" + to, email: "" },
        turnover: S.TURNOVER[t], answers: a, challenge: st.challenge || "", consent: true,
        scores: { domains, overall: Math.round(r.overall * 100) / 100, classification: r.classification }, flat,
      }, AT.forAssessment)),
    });
  } catch (e) { console.error("Make save failed", e.message); }
}

async function note(to, name, body) {
  const url = process.env.MAKE_WEBHOOK_URL;
  if (!url) return;
  try {
    await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(withAirtable({ type: "message", src: "wa", submittedAt: new Date().toISOString(), doctor: { name: name || "", whatsapp: "+" + to }, challenge: body }, AT.forMessage)) });
  } catch (e) { console.error("Make note failed", e.message); }
}

// ---------- Router ----------
const valid = (t, ans) => /^[0-3x]$/.test(t) && /^[1-5]{0,13}$/.test(ans);

async function handle(msg, name) {
  const to = msg.from;
  let id = null;
  if (msg.type === "interactive") id = (msg.interactive.list_reply || msg.interactive.button_reply || {}).id;
  if (msg.type === "button") id = msg.button.payload; // quick replies on template messages

  if (!id) {
    const body = (msg.text && msg.text.body) || "";
    if (/^\s*stop\s*$/i.test(body)) { await store.del(key(to)); return text(to, "You won't receive further messages from us. Reply START any time if you change your mind."); }
    if (body && store.enabled() && await typedAnswer(to, body)) return;
    if (body && !/^\s*(hi|hello|hey|start|good\s*(day|morning|afternoon|evening)|health\s*check)\b/i.test(body)) await note(to, name, body);
    return welcome(to, name);
  }

  // Template quick-reply payloads from the invite (TESTIMONIALS / BROCHURE / BOOK)
  if (id === "BOOK" && !CFG.calendlyUrl) return text(to, "Thank you! An RS consultant will contact you on this number to arrange your complimentary consultation. 📅");
  if (id === "START" || id === "BOOK") return startDetails(to);
  if (id === "BROCHURE") {
    await send(to, { type: "document", document: { link: `${CFG.siteUrl}/assets/rs-brochure.pdf`, filename: "RS Medical Consultancy brochure.pdf", caption: "Who we are, how we help practices, and how to reach us." } });
    return buttons(to, "Ready to see how your practice is doing? It takes about 5 minutes.", [{ id: "START", title: "Start Health Check" }, { id: "REVIEWS", title: "What doctors say" }]);
  }
  if (id === "REVIEWS" || id === "TESTIMONIALS") {
    if (CFG.reviewsUrl) await ctaUrl(to, "Here's what doctors we work with say about RS Medical Consultancy ⭐", "Read reviews", CFG.reviewsUrl);
    else await text(to, "Here's what doctors we work with say about RS Medical Consultancy ⭐\n\n(Our Google reviews link will appear here.)");
    return buttons(to, "Ready to see how your practice is doing?", [{ id: "START", title: "Start Health Check" }, { id: "BROCHURE", title: "View our brochure" }]);
  }

  const [kind, t, ans = "", x, y] = id.split("|");
  if (!valid(t, ans)) return welcome(to, name);

  if (kind === "K") { // skipped the biggest challenge
    if (ans.length !== 13) return askQuestion(to, "x", ans.slice(0, 12));
    const st = (await store.get(key(to))) || {};
    await store.set(key(to), { ...st, challenge: st.back ? st.challenge : "", step: "done", back: undefined });
    return t === "x" ? askTurnover(to, ans) : summary(to, t, ans);
  }
  if (kind === "S") {
    if (ans.length < 13) return askQuestion(to, "x", ans);
    return t === "x" ? askChallenge(to, ans) : summary(to, t, ans);
  }
  if (ans.length !== 13) return askQuestion(to, "x", ans.slice(0, 12));
  if (t === "x") return askChallenge(to, ans);
  if (kind === "C") return result(to, name, t, ans);
  if (kind === "E") {
    return list(to, "Which area would you like to change?", "Choose area",
      S.DOMAINS.map((d, i) => ({ id: `ED|${t}|${ans}|${i}`, title: d.name }))
        .concat(store.enabled() ? [{ id: `EX|${t}|${ans}`, title: "About your practice" }, { id: `EC|${t}|${ans}`, title: "Biggest challenge" }] : [])
        .concat([{ id: `ET|${t}|${ans}`, title: "Practice turnover" }]),
      "Edit an answer", "Areas");
  }
  if (kind === "EX") return startDetails(to, { t, ans });
  if (kind === "EC") return askChallenge(to, ans, { t, ans });
  if (kind === "ED") {
    const d = S.DOMAINS[+x];
    if (!d) return summary(to, t, ans);
    return list(to, `*${d.name}*\nWhich statement?`, "Choose statement",
      d.questions.map(q => ({ id: `EQ|${t}|${ans}|${q.n}`, title: `${q.n}. ${q.short}`, description: `Now: ${SHORT[+ans[q.n - 1]]}` })),
      "Edit an answer", d.name);
  }
  if (kind === "EQ") {
    const q = QUESTIONS[+x - 1];
    if (!q) return summary(to, t, ans);
    return list(to, `*${q.domain.name}*\n\n${q.text}`, "Choose answer",
      SCALE_ROWS.map(r => ({ id: `EA|${t}|${ans}|${q.n}|${r.v}`, title: r.title, description: r.description })),
      `Statement ${q.n} of 13`, `Statement ${q.n}`);
  }
  if (kind === "EA") {
    const n = +x, v = +y;
    if (!(n >= 1 && n <= 13 && v >= 1 && v <= 5)) return summary(to, t, ans);
    const next = ans.slice(0, n - 1) + v + ans.slice(n);
    return summary(to, t, next);
  }
  if (kind === "ET") {
    return list(to, "Choose your annual turnover.", "Choose turnover",
      S.TURNOVER.map((tt, i) => ({ id: `EU|${i}|${ans}`, title: turnoverTitle(tt), ...(tt.length > 24 ? { description: "During the consultation" } : {}) })), "Edit an answer", "Practice turnover");
  }
  if (kind === "EU") return summary(to, t, ans);
  return welcome(to, name);
}

// ---------- HTTP ----------
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
    if (q["hub.mode"] === "subscribe" && process.env.WA_VERIFY_TOKEN && q["hub.verify_token"] === process.env.WA_VERIFY_TOKEN) {
      return res.status(200).send(q["hub.challenge"]);
    }
    return res.status(403).send("Forbidden");
  }
  if (req.method !== "POST") return res.status(405).end();

  const raw = await rawBody(req);
  const secret = process.env.WA_APP_SECRET;
  if (secret) {
    const sig = req.headers["x-hub-signature-256"] || "";
    const expected = "sha256=" + crypto.createHmac("sha256", secret).update(raw).digest("hex");
    if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return res.status(401).end();
  }

  let body;
  try { body = JSON.parse(raw || "{}"); } catch { return res.status(400).end(); }

  try {
    for (const entry of body.entry || []) {
      for (const change of entry.changes || []) {
        const v = change.value || {};
        await store.set("diag:webhook", { at: new Date().toISOString(), field: change.field, messages: (v.messages || []).length, statuses: (v.statuses || []).length, phoneNumberId: (v.metadata || {}).phone_number_id || "" });
        const names = Object.fromEntries((v.contacts || []).map(c => [c.wa_id, c.profile && c.profile.name]));
        for (const msg of v.messages || []) await handle(msg, names[msg.from]);
      }
    }
  } catch (e) {
    console.error("WhatsApp handler error", e);
  }
  // Always 200, so Meta doesn't retry and send duplicate replies.
  return res.status(200).json({ ok: true });
};

module.exports._handle = handle; // for tests
