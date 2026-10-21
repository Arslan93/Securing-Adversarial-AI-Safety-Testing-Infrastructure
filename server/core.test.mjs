import { test } from "node:test";
import assert from "node:assert/strict";
import {
  digest,
  chainEvent,
  verifyEvidence,
  cases,
  evaluate,
} from "./core.mjs";
function fixture() {
  const manifest = { model: "synthetic", policy: { version: 1 } };
  const events = [];
  events.push(
    chainEvent(events, "run.created", {
      runId: "r-1",
      manifestHash: digest(manifest),
    }),
  );
  events.push(
    chainEvent(events, "run.completed", {
      runId: "r-1",
      verdict: "DEMO_ONLY",
      resultsHash: digest([]),
    }),
  );
  return {
    runId: "r-1",
    verdict: "DEMO_ONLY",
    results: [],
    resultsHash: digest([]),
    manifest,
    manifestHash: digest(manifest),
    events,
    anchor: events.at(-1).hash,
  };
}
test("untouched event chain and manifest verify", () =>
  assert.equal(verifyEvidence(fixture()).valid, true));
test("changed event is rejected", () => {
  const p = fixture();
  p.events[0].data.changed = true;
  assert.throws(() => verifyEvidence(p), /Integrity mismatch/);
});
test("removed tail is rejected by anchor", () => {
  const p = fixture();
  p.events.pop();
  assert.throws(() => verifyEvidence(p), /Anchor mismatch/);
});
test("reordered events are rejected", () => {
  const p = fixture();
  p.events.reverse();
  assert.throws(() => verifyEvidence(p), /Sequence mismatch/);
});
test("changed manifest is rejected", () => {
  const p = fixture();
  p.manifest.model = "modified";
  assert.throws(() => verifyEvidence(p), /Manifest digest mismatch/);
});
test("rehashed manifest must still match creation event", () => {
  const p = fixture();
  p.manifest.model = "modified";
  p.manifestHash = digest(p.manifest);
  assert.throws(() => verifyEvidence(p), /not bound/);
});
test("corpus contains 20 bounded synthetic cases and benign controls", () => {
  assert.equal(cases.length, 20);
  assert.equal(new Set(cases.map((c) => c.prompt)).size, 20);
  assert.equal(cases.filter((c) => c.benign).length, 4);
  assert.ok(cases.every((c) => c.prompt.length < 500));
});
test("paired fixture is deterministic and preserves benign controls", () => {
  const s = { policy: { rules: ["protect"] } };
  const a = evaluate(s);
  assert.deepEqual(a, evaluate(s));
  assert.ok(
    a
      .filter((c) => c.benign)
      .every((c) => c.baseline === "Safe" && c.defended === "Safe"),
  );
  assert.ok(
    a.filter((c) => c.defended === "Violation").length <
      a.filter((c) => c.baseline === "Violation").length,
  );
});

test("result edits fail even when event chain is untouched", () => {
  const p = fixture();
  p.results.push({ defended: "Safe" });
  assert.throws(() => verifyEvidence(p), /Results digest mismatch/);
});

test("verdict cannot be promoted by editing an evidence package", () => {
  const p = fixture();
  p.verdict = "VERIFIED";
  assert.throws(() => verifyEvidence(p), /Results digest mismatch/);
});
