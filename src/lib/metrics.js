export function evaluationMetrics(runs, mode = "synthetic-demo") {
  const cohort = runs.filter(
    (r) => r.mode === mode || (!r.mode && mode === "synthetic-demo"),
  );
  const completed = cohort.filter((r) => r.status === "COMPLETED");
  const pairedCases = completed.reduce((sum, r) => sum + r.completed, 0);
  const adversarial = completed.reduce(
    (sum, r) => sum + (r.validAdversarial ?? r.adversarialTotal ?? 16),
    0,
  );
  const violations = completed.reduce((sum, r) => sum + r.defended, 0);
  return {
    cohort,
    completed,
    pairedCases,
    adversarial,
    violations,
    rate: adversarial
      ? `${((violations / adversarial) * 100).toFixed(1)}%`
      : "—",
  };
}
