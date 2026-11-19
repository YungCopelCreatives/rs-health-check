// RS Practice Health Check(TM) scoring, v2.0 (RS questionnaire and scoring guide, Nov 2026).
// 13 statements on a 1-5 scale across six areas.
// Practice Health Score = total of all 13 answers / 65 x 100. Area percentages are shown for insight only.
(function (root) {
  const SCORING_VERSION = "2.0";

  const SCALE = [
    { value: 1, label: "Strongly disagree / Never" },
    { value: 2, label: "Disagree / Rarely" },
    { value: 3, label: "Partly / Sometimes" },
    { value: 4, label: "Agree / Usually" },
    { value: 5, label: "Strongly agree / Consistently" },
  ];

  // RS's wording. "short" labels are used in WhatsApp lists and Airtable column names (max 20 characters).
  const DOMAINS = [
    { key: "A", name: "Business Strategy", questions: [
      { n: 1, short: "Clear goals", text: "My practice has clear business goals for the next 12–24 months." },
      { n: 2, short: "Strategy-led", text: "Important business decisions are guided by a defined strategy rather than mainly responding to problems as they arise." },
    ]},
    { key: "B", name: "Financial Health", questions: [
      { n: 3, short: "Financial reviews", text: "I regularly review my practice's financial performance and use this information to make business decisions." },
      { n: 4, short: "Revenue leakage", text: "I am confident that my practice is identifying and addressing avoidable revenue leakage and unnecessary costs." },
    ]},
    { key: "C", name: "Operational Excellence", questions: [
      { n: 5, short: "Efficient operations", text: "The day-to-day operations of my practice run efficiently with minimal unnecessary delays or duplication." },
      { n: 6, short: "Systems & technology", text: "My practice uses appropriate systems and technology to reduce administrative burden and improve efficiency." },
    ]},
    { key: "D", name: "Team & Systems", questions: [
      { n: 7, short: "Documented SOPs", text: "My practice has documented processes or SOPs for important recurring activities." },
      { n: 8, short: "Runs without me", text: "The practice can operate effectively when I am away and does not depend on me to resolve most non-clinical decisions." },
    ]},
    { key: "E", name: "Patient Experience", questions: [
      { n: 9, short: "Patient journey", text: "We understand the patient's experience from first contact through consultation, follow-up and ongoing care." },
      { n: 10, short: "Feedback acted on", text: "Patient feedback, complaints and recurring service issues are systematically captured and acted upon." },
    ]},
    { key: "F", name: "Growth Readiness", questions: [
      { n: 11, short: "Growth opportunity", text: "I know where the next meaningful growth opportunity for my practice could come from." },
      { n: 12, short: "Capacity to grow", text: "My current team, systems and infrastructure could support additional growth without significantly compromising efficiency or patient experience." },
      { n: 13, short: "3–5 year plan", text: "I have a clear plan for making the practice more sustainable and valuable over the next 3–5 years." },
    ]},
  ];

  const TURNOVER = ["Below R5 million", "R5 million – R15 million", "Above R15 million", "Prefer to discuss during the consultation"];

  // RS scoring guide. Keys are shown to doctors in capitals.
  const CLASSIFICATIONS = {
    EXCELLENT: { color: "var(--thriving)", hex: "#0fb9b1", range: "85–100%", line: "Your practice is performing well across most areas. Focus on sustaining momentum and exploring growth opportunities." },
    GOOD: { color: "var(--healthy)", hex: "#3fae5a", range: "70–84%", line: "Your practice is on the right track, with a few areas to strengthen to unlock greater potential." },
    OPPORTUNITY: { color: "var(--opportunity)", hex: "#e8a33a", range: "55–69%", line: "There are several areas that need attention. With the right support, meaningful improvements are achievable." },
    CRITICAL: { color: "var(--priority)", hex: "#d9534f", range: "Below 55%", line: "Your practice is facing significant challenges. A focused plan and close support will be essential." },
  };

  // Round to 10 decimals before comparing so 84.99999999 never misses 85.
  function band(pct) {
    const o = Math.round(pct * 1e10) / 1e10;
    return o >= 85 ? "EXCELLENT" : o >= 70 ? "GOOD" : o >= 55 ? "OPPORTUNITY" : "CRITICAL";
  }

  function isValid(v) { return Number.isInteger(v) && v >= 1 && v <= 5; }

  // answers: { 1: 4, 2: 5, ... 13: 3 }
  function score(answers) {
    for (let n = 1; n <= 13; n++) if (!isValid(answers[n])) return { complete: false };
    const domains = DOMAINS.map(d => {
      const sum = d.questions.reduce((s, q) => s + answers[q.n], 0);
      return { key: d.key, name: d.name, pct: (sum / (d.questions.length * 5)) * 100 };
    });
    let total = 0;
    for (let n = 1; n <= 13; n++) total += answers[n];
    const overall = (total / 65) * 100;
    return { complete: true, version: SCORING_VERSION, domains, total, overall, classification: band(overall) };
  }

  function tier(turnover) {
    return { "Below R5 million": "Tier 1", "R5 million – R15 million": "Tier 2", "Above R15 million": "Tier 3" }[turnover] || "Unconfirmed";
  }

  const api = { SCORING_VERSION, SCALE, DOMAINS, TURNOVER, CLASSIFICATIONS, band, score, tier };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.RSScoring = api;
})(typeof window !== "undefined" ? window : globalThis);
