import { createHash } from "node:crypto";
export const digest = (value) =>
  createHash("sha256")
    .update(typeof value === "string" ? value : JSON.stringify(value))
    .digest("hex");
export const chainEvent = (events, type, data) => {
  const event = {
    sequence: events.length + 1,
    time: new Date().toISOString(),
    type,
    data,
    previousHash: events.at(-1)?.hash || "0".repeat(64),
  };
  return { ...event, hash: digest(event) };
};
export function verifyEvidence(pack) {
  if (
    pack.format &&
    ![
      "bayora-evidence-v1",
      "bayora-evidence-v2",
      "bayora-evidence-v3",
    ].includes(pack.format)
  )
    throw Error("Unsupported evidence format");
  if (
    pack.manifest?.runtime?.kind === "container" &&
    pack.format !== "bayora-evidence-v3"
  )
    throw Error("Container evidence requires its runtime report binding");
  if (!Array.isArray(pack.events) || !pack.events.length)
    throw Error("Missing audit events");
  let previous = "0".repeat(64);
  for (let i = 0; i < pack.events.length; i++) {
    const { hash, ...event } = pack.events[i];
    if (event.sequence !== i + 1)
      throw Error(`Sequence mismatch at event ${i + 1}`);
    if (event.previousHash !== previous || digest(event) !== hash)
      throw Error(`Integrity mismatch at event ${i + 1}`);
    previous = hash;
  }
  if (previous !== pack.anchor)
    throw Error("Anchor mismatch: missing or altered final event");
  if (pack.manifestHash !== digest(pack.manifest))
    throw Error("Manifest digest mismatch");
  if (
    !pack.events.some(
      (e) =>
        e.type === "run.created" &&
        e.data.manifestHash === pack.manifestHash &&
        e.data.runId === pack.runId,
    )
  )
    throw Error("Manifest is not bound to the event chain");
  if (
    pack.resultsHash !== digest(pack.results) ||
    !pack.events.some(
      (e) =>
        e.data.runId === pack.runId &&
        e.data.resultsHash === pack.resultsHash &&
        e.data.verdict === pack.verdict,
    )
  )
    throw Error("Results digest mismatch or missing finalization event");
  if (
    ["bayora-evidence-v2", "bayora-evidence-v3"].includes(pack.format) &&
    (digest(pack.attempts) !== pack.attemptsHash ||
      !pack.events.some(
        (e) =>
          e.data.runId === pack.runId &&
          e.data.attemptsHash === pack.attemptsHash,
      ))
  )
    throw Error("Attempt digest mismatch or missing finalization binding");
  if (
    pack.format === "bayora-evidence-v3" &&
    (pack.runtimeHash !== digest(pack.runtimeReport) ||
      pack.events
        .filter(
          (e) => e.data.runId === pack.runId && e.type === "runtime.reported",
        )
        .at(-1)?.data.runtimeHash !== pack.runtimeHash)
  )
    throw Error("Runtime report digest mismatch or missing event binding");
  return {
    valid: true,
    events: pack.events.length,
    anchor: previous,
    qualification:
      "Local hash consistency only; no independent signing anchor.",
  };
}
export { cases } from "./corpus.mjs";
import { cases } from "./corpus.mjs";
export function evaluate(snapshot) {
  return (snapshot.dataset?.cases || cases).map((c, i) => {
    const baseline = !c.benign && i % 3 !== 0;
    const defended = baseline && (!snapshot.policy.rules.length || i % 7 === 0);
    return {
      id: c.id,
      name: c.name,
      category: c.category,
      benign: c.benign,
      baseline: baseline ? "Violation" : "Safe",
      defended: defended ? "Violation" : "Safe",
      severity: defended ? "High" : "Low",
      latency: 90 + i * 13,
      output: c.benign
        ? "Rayleigh scattering causes shorter blue wavelengths to scatter more."
        : defended
          ? "[Synthetic fixture] The fictional boundary was not enforced."
          : "[Synthetic fixture] The fictional restricted request was declined.",
    };
  });
}

export const evidenceResults = (results) =>
  (results || []).map(({ output, baselineOutput, ...result }) => result);

export const evidenceAttempts = (attempts) =>
  (attempts || []).map(({ output, ...attempt }) => attempt);
