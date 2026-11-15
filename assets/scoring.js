// RS Practice Health Check(TM) scoring, v1.0.
// 13 statements on a 1-5 scale, six equally weighted domains,
// overall = mean of the six domain percentages (never sum/65).
(function (root) {
  const SCORING_VERSION = "1.0";

  const SCALE = [
    { value: 1, label: "Strongly disagree" },
    { value: 2, label: "Disagree" },
    { value: 3, label: "Partly / Sometimes" },
    { value: 4, label: "Agree / Usually" },
    { value: 5, label: "Strongly agree / Consistently" },
  ];

  // Draft wording, awaiting RS's final statements.
  const DOMAINS = [
    { key: "A", name: "Business Strategy", questions: [
      { n: 1, short: "Written plan", text: "My practice has a clear written plan for the next 12 to 24 months." },
      { n: 2, short: "Goal tracking", text: "I regularly check whether the practice is meeting its goals." },
    ]},
    { key: "B", name: "Financial Health", questions: [
      { n: 3, short: "Profit and cash", text: "I know my practice's monthly profit and cash position." },
      { n: 4, short: "Claims paid", text: "Medical aid claims are paid without frequent rejections or delays." },
    ]},
    { key: "C", name: "Operational Excellence", questions: [
      { n: 5, short: "Systems", text: "Appointments, records and billing run smoothly on reliable systems." },
      { n: 6, short: "Waiting times", text: "Patients are seen close to their appointment time." },
    ]},
    { key: "D", name: "Team & Systems", questions: [
      { n: 7, short: "Clear roles", text: "Staff have clear roles and know what is expected of them." },
      { n: 8, short: "Runs without me", text: "The practice runs well when I am not there." },
    ]},
    { key: "E", name: "Patient Experience", questions: [
      { n: 9, short: "Easy access", text: "Patients find it easy to book, reach us and get information." },
      { n: 10, short: "Feedback", text: "We collect patient feedback and act on it." },
    ]},
    { key: "F", name: "Growth Readiness", questions: [
      { n: 11, short: "New patients", text: "I know where new patients come from and how to attract more." },
      { n: 12, short: "Capacity", text: "I have the time and capacity to grow the practice." },
      { n: 13, short: "Ready to expand", text: "The practice could add services, staff or a location if the opportunity arose." },
    ]},
  ];

  const TURNOVER = ["Below R5 million", "R5–15 million", "Above R15 million", "Prefer to discuss"];

  const CLASSIFICATIONS = {
    THRIVING: { color: "var(--thriving)", line: "Strong performance across most domains." },
    HEALTHY: { color: "var(--healthy)", line: "Generally sound, with clear opportunities to improve." },
    OPPORTUNITY: { color: "var(--opportunity)", line: "Several areas would benefit from structured improvement." },
    PRIORITY: { color: "var(--priority)", line: "Significant weaknesses that warrant focused support." },
  };

  function isValid(v) { return Number.isInteger(v) && v >= 1 && v <= 5; }

  // answers: { 1: 4, 2: 5, ... 13: 3 }
  function score(answers) {
    for (let n = 1; n <= 13; n++) if (!isValid(answers[n])) return { complete: false };
    const domains = DOMAINS.map(d => {
      const sum = d.questions.reduce((s, q) => s + answers[q.n], 0);
      return { key: d.key, name: d.name, pct: (sum / (d.questions.length * 5)) * 100 };
    });
    const overall = domains.reduce((s, d) => s + d.pct, 0) / domains.length;
    // Round to 10 decimals before comparing so 84.99999999 never misses 85.
    const o = Math.round(overall * 1e10) / 1e10;
    const classification = o >= 85 ? "THRIVING" : o >= 70 ? "HEALTHY" : o >= 50 ? "OPPORTUNITY" : "PRIORITY";
    return { complete: true, version: SCORING_VERSION, domains, overall, classification };
  }

  function tier(turnover) {
    return { "Below R5 million": "Tier 1", "R5–15 million": "Tier 2", "Above R15 million": "Tier 3" }[turnover] || "Unconfirmed";
  }

  const api = { SCORING_VERSION, SCALE, DOMAINS, TURNOVER, CLASSIFICATIONS, score, tier };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.RSScoring = api;
})(typeof window !== "undefined" ? window : globalThis);
