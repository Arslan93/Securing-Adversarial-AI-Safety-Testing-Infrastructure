import { test } from "node:test";
import assert from "node:assert/strict";
import { makeCanary, assess } from "./scoring.mjs";
import { seedDataset, publishDataset, validateCase } from "./datasets.mjs";
import { publicManifest, summary } from "./presenters.mjs";
import { compareRuns } from "./comparison.mjs";
import { evaluateOllama } from "./ollama.mjs";
import {
  digest,
  evidenceAttempts,
  verifyEvidence,
  chainEvent,
} from "./core.mjs";
test("canaries use private entropy, not run identifiers", () => {
  const a = makeCanary(),
    b = makeCanary();
  assert.notEqual(a, b);
  assert.match(a, /^BAYORA_[a-f0-9]{48}$/);
  assert.notEqual(a, "BAYORA_" + digest("known-run").slice(0, 16));
});
test("scoring distinguishes disclosure, no disclosure, utility and inconclusive output", () => {
  const canary = "BAYORA_private";
  assert.equal(assess(canary, { benign: false }, canary).outcome, "Violation");
  assert.equal(
    assess("No.", { benign: false }, canary).outcome,
    "No disclosure detected",
  );
  assert.equal(assess("", { benign: false }, canary).outcome, "Inconclusive");
  assert.equal(
    assess("I cannot answer", { benign: true }, canary).outcome,
    "Possible overblocking",
  );
  assert.equal(
    assess("4", { benign: true, expectedContains: "4" }, canary).outcome,
    "Control passed",
  );
  assert.equal(
    assess("5", { benign: true, expectedContains: "4" }, canary).outcome,
    "Utility mismatch",
  );
});
test("datasets are bounded, immutable revisions and reject executable schemas", () => {
  const seed = seedDataset(),
    state = { datasets: [seed], workspaces: [{ id: "ws" }] };
  const one = publishDataset(state, {
    name: "Test",
    workspaceId: "ws",
    cases: [seed.cases[0]],
    baseDatasetId: seed.id,
  });
  state.datasets.push(one);
  const two = publishDataset(state, {
    name: "Test",
    workspaceId: "ws",
    cases: [...one.cases, seed.cases[1]],
    baseDatasetId: one.id,
  });
  assert.equal(one.cases.length, 1);
  assert.equal(two.version, 2);
  assert.notEqual(one.digest, two.digest);
  assert.throws(() => validateCase({ ...seed.cases[0], tool_calls: [] }));
  assert.throws(
    () =>
      publishDataset(state, {
        name: "bad",
        workspaceId: "ws",
        cases: [seed.cases[0], seed.cases[0]],
      }),
    /unique/,
  );
  assert.throws(
    () => publishDataset(state, { name: "bad", workspaceId: "ws", cases: [] }),
    /1–100/,
  );
});
function run(id, policyVersion = 1) {
  return {
    id,
    workspaceId: "ws",
    status: "COMPLETED",
    snapshot: {
      datasetHash: "dataset",
      dataset: {
        id: "d",
        total: 1,
        adversarialTotal: 1,
        cases: [{ prompt: "PRIVATE RED PROMPT" }],
      },
      policy: { version: policyVersion, rules: ["PRIVATE BLUE RULE"] },
      model: "local",
      modelDigest: "revision",
      adapter: "v2",
      evaluator: "canary-v2",
      temperature: 0,
      seed: 42,
      maxTokens: 128,
      mode: "ollama",
    },
    results: [
      {
        id: "case",
        benign: false,
        baseline: "Violation",
        defended: "No disclosure detected",
      },
    ],
    attempts: [],
  };
}
test("public manifests omit corpus and rules, while comparison rejects incompatible settings", () => {
  const a = run("a"),
    b = run("b", 2);
  assert.ok(!JSON.stringify(publicManifest(a.snapshot)).includes("PRIVATE"));
  assert.equal(compareRuns(a, b).comparable, true);
  b.snapshot.datasetHash = "other";
  const result = compareRuns(a, b);
  assert.equal(result.comparable, false);
  assert.equal(result.deltaPercentagePoints, null);
  assert.ok(result.reasons.includes("Dataset content differs"));
  assert.equal(summary(a).total, 1);
});
test("baseline success survives a failed defended request as a partial attempt", async () => {
  const attempts = [],
    results = [];
  let count = 0;
  await evaluateOllama(
    { model: "local", policy: { rules: [] } },
    {
      signal: new AbortController().signal,
      corpus: [{ id: "one", prompt: "toy", benign: false }],
      runId: "r",
      canaryFactory: () => "BAYORA_test",
      onAttempt: (a) => attempts.push(a),
      onResult: (r) => results.push(r),
      fetcher: async () =>
        ++count === 1
          ? {
              ok: true,
              json: async () => ({
                done: true,
                message: { content: "BAYORA_test" },
              }),
            }
          : { ok: false, status: 503 },
    },
  );
  assert.equal(attempts[0].status, "COMPLETED");
  assert.equal(attempts[1].status, "FAILED");
  assert.equal(results[0].baseline, "Violation");
  assert.equal(results[0].defended, "Transport error");
  assert.ok(
    !JSON.stringify(evidenceAttempts(attempts)).includes("BAYORA_test"),
  );
});
test("v2 evidence binds attempts as well as results", () => {
  const manifest = {},
    events = [],
    attempts = [{ id: "a", status: "FAILED" }],
    results = [];
  events.push(
    chainEvent(events, "run.created", {
      runId: "r",
      manifestHash: digest(manifest),
    }),
  );
  events.push(
    chainEvent(events, "run.completed", {
      runId: "r",
      resultsHash: digest(results),
      attemptsHash: digest(attempts),
      verdict: "UNVERIFIED",
    }),
  );
  const pack = {
    format: "bayora-evidence-v2",
    runId: "r",
    manifest,
    manifestHash: digest(manifest),
    results,
    resultsHash: digest(results),
    attempts,
    attemptsHash: digest(attempts),
    verdict: "UNVERIFIED",
    events,
    anchor: events.at(-1).hash,
  };
  assert.equal(verifyEvidence(pack).valid, true);
  pack.attempts[0].status = "COMPLETED";
  assert.throws(() => verifyEvidence(pack), /Attempt digest/);
});
