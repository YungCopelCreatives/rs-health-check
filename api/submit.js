// Receives a completed Health Check and forwards it to Make.
// Set MAKE_WEBHOOK_URL in Vercel (Project → Settings → Environment Variables).
// Without it, submissions are accepted and logged only (handy for demos).

const AT = require("./_airtable.js");

const MAX_BYTES = 20000;

function bad(res, msg) {
  return res.status(400).json({ ok: false, error: msg });
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const body = typeof req.body === "string" ? safeParse(req.body) : req.body;
  if (!body || typeof body !== "object") return bad(res, "Invalid JSON");
  if (JSON.stringify(body).length > MAX_BYTES) return bad(res, "Too large");

  const d = body.doctor || {};
  for (const k of ["name", "practice", "specialty", "whatsapp", "email"]) {
    if (typeof d[k] !== "string" || !d[k].trim()) return bad(res, `Missing ${k}`);
  }
  if (body.consent !== true) return bad(res, "Consent required");
  for (let n = 1; n <= 13; n++) {
    const v = body.answers && body.answers["q" + n];
    if (!Number.isInteger(v) || v < 1 || v > 5) return bad(res, `Invalid answer q${n}`);
  }

  // Flat copy of the domain scores, so Make can map them without keys that contain spaces.
  const dom = (body.scores && body.scores.domains) || {};
  const flat = {
    strategy: dom["Business Strategy"],
    finance: dom["Financial Health"],
    operations: dom["Operational Excellence"],
    team: dom["Team & Systems"],
    patient: dom["Patient Experience"],
    growth: dom["Growth Readiness"],
  };
  const payload = { ...body, flat, receivedAt: new Date().toISOString(), userAgent: req.headers["user-agent"] || "" };
  // The clickable preview posts here too; keep its sample doctor out of the CRM.
  if (body.src !== "preview") payload.airtable = AT.forAssessment(payload);
  const url = process.env.MAKE_WEBHOOK_URL;

  if (!url) {
    console.log("Health Check received (no MAKE_WEBHOOK_URL set):", d.practice, body.scores && body.scores.overall);
    return res.status(200).json({ ok: true, forwarded: false });
  }

  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!r.ok) throw new Error(`Make responded ${r.status}`);
    return res.status(200).json({ ok: true, forwarded: true });
  } catch (err) {
    console.error("Forward to Make failed:", err.message);
    return res.status(502).json({ ok: false, error: "Could not save your answers" });
  }
};

function safeParse(s) {
  try { return JSON.parse(s); } catch { return null; }
}
