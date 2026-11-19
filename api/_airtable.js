// Builds ready-to-send Airtable API bodies for the RS CRM base, so the Make scenario only has to
// forward them (no field mapping in Make). Make does:
//   1. PATCH v0/<base>/Doctors        body = airtable.doctorBody   (upsert on "WA ID", or update by record id)
//   2. POST  v0/<base>/<childTable>   body = airtable.childBody with __DOCTOR_ID__ replaced by the doctor's record id
// Empty values are left out, so a WhatsApp visit never wipes practice details typed on the website.

const S = require("../assets/scoring.js");

const DOCTOR_ID = "__DOCTOR_ID__";

// South African numbers in any common format -> +27XXXXXXXXX. Other countries keep their digits.
function phone(raw) {
  let d = String(raw || "").replace(/[^\d+]/g, "");
  if (!d) return "";
  if (d.startsWith("+")) return "+" + d.slice(1).replace(/\D/g, "");
  if (d.startsWith("00")) return "+" + d.slice(2);
  if (d.startsWith("0") && d.length === 10) return "+27" + d.slice(1);
  if (d.startsWith("27") && d.length === 11) return "+" + d;
  return "+" + d;
}

function clean(o) {
  const out = {};
  for (const [k, v] of Object.entries(o)) {
    if (v === undefined || v === null || v === "" || (typeof v === "number" && !isFinite(v))) continue;
    out[k] = v;
  }
  return out;
}

const r1 = n => (typeof n === "number" ? Math.round(n * 10) / 10 : undefined);
const source = src => (src === "wa" ? "WhatsApp" : "Website");
// Airtable can't merge on a phone-number field, so "WA ID" (digits only) is the match key.
const waId = raw => phone(raw).replace(/^\+/, "");
const upsert = fields => JSON.stringify({ performUpsert: { fieldsToMergeOn: ["WA ID"] }, typecast: true, records: [{ fields: clean({ "WA ID": waId(fields.WhatsApp), ...fields }) }] });
const create = fields => JSON.stringify({ typecast: true, records: [{ fields: { ...clean(fields), Doctor: [DOCTOR_ID] } }] });

function forAssessment(p) {
  const d = p.doctor || {};
  const sc = p.scores || {};
  const dom = sc.domains || {};
  const when = p.submittedAt || p.receivedAt || new Date().toISOString();
  const wa = phone(d.whatsapp);
  const tier = S.tier(p.turnover);
  const doctorBody = upsert({
    Doctor: d.name, WhatsApp: wa, Practice: d.practice, Specialty: d.specialty, Email: d.email,
    "Latest score": r1(sc.overall), "Latest band": sc.classification, "Commercial tier": tier, Turnover: p.turnover,
    Source: source(p.src), Consent: p.consent === true || undefined, "Last activity": when,
  });
  const a = p.answers || {};
  const qs = {};
  S.DOMAINS.forEach(dm => dm.questions.forEach(q => { qs[`Q${q.n} ${q.short}`] = a["q" + q.n]; }));
  let total = 0;
  for (let n = 1; n <= 13; n++) total += Number(a["q" + n]) || 0;
  const doms = {};
  S.DOMAINS.forEach(dm => { doms[dm.name + " %"] = r1(dom[dm.name]); });
  const childBody = create({
    Assessment: `${d.name || wa} · ${when.slice(0, 10)}`, Submitted: when, Source: source(p.src),
    "Total score": total || undefined, "Overall %": r1(sc.overall), Band: sc.classification, "Commercial tier": tier, Turnover: p.turnover,
    "Biggest challenge": p.challenge, ...doms, ...qs, "Scoring version": p.scoringVersion, Ref: p.rid,
  });
  return { doctorBody, childTable: "Assessments", childBody };
}

function forMessage(p) {
  const d = p.doctor || {};
  const when = p.submittedAt || new Date().toISOString();
  return {
    doctorBody: upsert({ Doctor: d.name, WhatsApp: phone(d.whatsapp), Source: "WhatsApp", "Last activity": when }),
    childTable: "Messages",
    childBody: create({ Message: p.challenge, Received: when }),
  };
}

// Invite sent from the Airtable button: update that exact record (by id) and store the number in +27 format.
function forInvite({ recordId, whatsapp, when }) {
  const t = when || new Date().toISOString();
  return {
    doctorBody: JSON.stringify({ typecast: true, records: [{ id: recordId, fields: clean({ "WA ID": waId(whatsapp), WhatsApp: phone(whatsapp), Status: "Invited", "Invited at": t, "Last activity": t }) }] }),
    childTable: "",
    childBody: "",
  };
}

module.exports = { phone, forAssessment, forMessage, forInvite, DOCTOR_ID };
