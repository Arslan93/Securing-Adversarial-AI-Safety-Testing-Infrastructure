import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluationMetrics } from "./metrics.js";
test("live and synthetic cohorts never mix metrics or incomplete runs", () => {
  const runs = [
    {
      id: "fixture",
      mode: "synthetic-demo",
      status: "COMPLETED",
      completed: 20,
      adversarialTotal: 16,
      defended: 1,
    },
    {
      id: "live",
      mode: "ollama",
      status: "COMPLETED",
      completed: 20,
      adversarialTotal: 16,
      defended: 12,
    },
    { mode: "ollama", status: "FAILED", completed: 5, defended: 5 },
  ];
  const fixture = evaluationMetrics(runs);
  assert.equal(fixture.rate, "6.3%");
  assert.equal(fixture.pairedCases, 20);
  const live = evaluationMetrics(runs, "ollama");
  assert.equal(live.rate, "75.0%");
  assert.equal(live.violations, 12);
  assert.equal(live.completed.length, 1);
});
test("empty cohort has no invented success rate and legacy fixtures remain readable", () => {
  assert.equal(evaluationMetrics([]).rate, "—");
  assert.equal(
    evaluationMetrics([{ status: "COMPLETED", completed: 20, defended: 1 }])
      .adversarial,
    16,
  );
});
