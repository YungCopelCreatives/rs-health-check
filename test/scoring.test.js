// Scoring tests against RS's scoring guide (total / 65 x 100). Run: npm test
const assert = require("assert");
const S = require("../assets/scoring.js");
const mk = a => Object.fromEntries(a.map((v, i) => [i + 1, v]));
const withTotal = t => { const a = Array(13).fill(1); let left = t - 13; for (let i = 0; left > 0; i = (i + 1) % 13) { if (a[i] < 5) { a[i]++; left--; } } return a; };
const cases = [
  [Array(13).fill(5), 100, "EXCELLENT"], [Array(13).fill(4), 80, "GOOD"],
  [Array(13).fill(3), 60, "OPPORTUNITY"], [Array(13).fill(2), 40, "CRITICAL"], [Array(13).fill(1), 20, "CRITICAL"],
  [withTotal(56), 56 / 65 * 100, "EXCELLENT"], [withTotal(55), 55 / 65 * 100, "GOOD"],
  [withTotal(46), 46 / 65 * 100, "GOOD"], [withTotal(45), 45 / 65 * 100, "OPPORTUNITY"],
  [withTotal(36), 36 / 65 * 100, "OPPORTUNITY"], [withTotal(35), 35 / 65 * 100, "CRITICAL"],
  [[3,4,3,4,3,4,3,4,4,4,3,3,5], 47 / 65 * 100, "GOOD"],
];
for (const [a, overall, cls] of cases) {
  const r = S.score(mk(a));
  assert.ok(Math.abs(r.overall - overall) < 1e-9, `overall ${r.overall} != ${overall}`);
  assert.strictEqual(r.total, a.reduce((x, y) => x + y, 0));
  assert.strictEqual(r.classification, cls, `${a} -> ${r.classification}`);
}
assert.deepStrictEqual([85, 84.99, 70, 69.99, 55, 54.99].map(S.band), ["EXCELLENT", "GOOD", "GOOD", "OPPORTUNITY", "OPPORTUNITY", "CRITICAL"]);
// Growth has 3 questions, so area % differs from the overall: answers all 5 except Q13=1
const r = S.score(mk([5,5,5,5,5,5,5,5,5,5,5,5,1]));
assert.ok(Math.abs(r.overall - 61 / 65 * 100) < 1e-9);
assert.ok(Math.abs(r.domains[5].pct - 11 / 15 * 100) < 1e-9);
const blank = mk(Array(13).fill(3)); delete blank[7];
assert.strictEqual(S.score(blank).complete, false);
assert.deepStrictEqual(S.TURNOVER.map(S.tier), ["Tier 1", "Tier 2", "Tier 3", "Unconfirmed"]);
assert.strictEqual(S.DOMAINS.flatMap(d => d.questions).length, 13);
S.DOMAINS.forEach(d => d.questions.forEach(q => assert.ok(q.short.length <= 20, q.short)));
console.log("All scoring tests pass");
