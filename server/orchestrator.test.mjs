import { test } from "node:test";
import assert from "node:assert/strict";
import { createOrchestrator } from "./orchestrator.mjs";
test("shutdown awaits aborted live work before persistence can close", async () => {
  const state = { runs: [] },
    events = [];
  let started;
  const ready = new Promise((resolve) => (started = resolve));
  const orchestrator = createOrchestrator({
    state,
    audit: (type, data) => events.push({ type, data }),
    config: { syntheticStepMs: 1, ollamaOrigin: "http://localhost:11434" },
    adapters: {
      listModels: async () => [{ id: "local", digest: "revision" }],
      evaluateOllama: async (snapshot, { signal }) => {
        started();
        await new Promise((resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          });
        });
      },
    },
  });
  const run = {
    id: "shutdown-run",
    status: "VALIDATING",
    snapshot: {
      workspace: { ttl: 1 },
      model: "local",
      modelDigest: "revision",
    },
    timeline: [],
    results: [],
  };
  state.runs.push(run);
  orchestrator.liveProgress(run.id);
  await ready;
  await orchestrator.close();
  assert.equal(run.status, "FAILED");
  assert.equal(run.validity, "UNVERIFIED");
  assert.match(run.error, /shutting down/);
  assert.equal(events.at(-1).type, "run.failed");
});
