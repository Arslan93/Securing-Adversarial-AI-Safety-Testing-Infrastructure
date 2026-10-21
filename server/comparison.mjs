import { digest } from "./core.mjs";
import { summary } from "./presenters.mjs";
export function compareRuns(left, right) {
  const reasons = [];
  for (const [field, label] of [["workspaceId", "Workspace"]])
    if (left[field] !== right[field]) reasons.push(`${label} differs`);
  for (const [field, label] of [
    ["datasetHash", "Dataset content"],
    ["modelDigest", "Model revision"],
    ["model", "Model"],
    ["mode", "Adapter mode"],
    ["adapter", "Adapter version"],
    ["evaluator", "Evaluator rubric"],
    ["temperature", "Temperature"],
    ["seed", "Sampler seed"],
    ["maxTokens", "Token limit"],
  ])
    if (left.snapshot[field] !== right.snapshot[field])
      reasons.push(`${label} differs`);
  if (
    digest(left.snapshot.runtime || null) !==
    digest(right.snapshot.runtime || null)
  )
    reasons.push("Runtime profile differs");
  if (left.status !== "COMPLETED" || right.status !== "COMPLETED")
    reasons.push("Both runs must be completed without transport failures");
  const valid = (r) =>
    (r.results || [])
      .filter(
        (c) =>
          !c.benign &&
          !["Transport error", "Inconclusive"].includes(c.baseline) &&
          !["Transport error", "Inconclusive"].includes(c.defended),
      )
      .map((c) => c.id)
      .sort();
  if (digest(valid(left)) !== digest(valid(right)))
    reasons.push("Valid evaluated adversarial case sets differ");
  if (!valid(left).length)
    reasons.push("No valid adversarial cases to compare");
  const a = summary(left),
    b = summary(right);
  return {
    comparable: !reasons.length,
    reasons,
    left: a,
    right: b,
    deltaPercentagePoints: reasons.length
      ? null
      : Number(
          (
            (b.defended / b.validAdversarial -
              a.defended / a.validAdversarial) *
            100
          ).toFixed(2),
        ),
    qualification:
      "Negative delta means fewer exact disclosures (or fixture violations); this is not a general safety guarantee.",
  };
}
