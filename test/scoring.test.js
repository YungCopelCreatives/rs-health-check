// Scoring tests from the build plan. Run: npm test
const assert = require("assert");
const S = require("../assets/scoring.js");
const mk = a => Object.fromEntries(a.map((v, i) => [i + 1, v]));
const cases = [
  [Array(13).fill(5), 100, "THRIVING"], [Array(13).fill(4), 80, "HEALTHY"],
  [Array(13).fill(3), 60, "OPPORTUNITY"], [Array(13).fill(2), 40, "PRIORITY"], [Array(13).fill(1), 20, "PRIORITY"],
  [[2,3,2,3,2,3,2,2,2,3,3,3,3], 50, "OPPORTUNITY"],
  [[3,4,3,4,3,4,3,4,4,4,3,3,3], 70, "HEALTHY"],
  [[4,5,4,5,4,5,4,4,4,4,4,4,4], 85, "THRIVING"],
];
for (const [a, overall, cls] of cases) {
  const r = S.score(mk(a));
  assert.ok(Math.abs(r.overall - overall) < 1e-9, `overall ${r.overall} != ${overall}`);
  assert.strictEqual(r.classification, cls);
}
const blank = mk(Array(13).fill(3)); delete blank[7];
assert.strictEqual(S.score(blank).complete, false);
assert.deepStrictEqual(S.TURNOVER.map(S.tier), ["Tier 1", "Tier 2", "Tier 3", "Unconfirmed"]);
console.log("All scoring tests pass");
