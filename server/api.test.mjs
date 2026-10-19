import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const tmp = mkdtempSync(join(tmpdir(), "bayora-test-"));
let proc;
const base = "http://127.0.0.1:3099/api";
async function request(path, body, cookie) {
  const r = await fetch(base + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return {
    status: r.status,
    body: await r.json(),
    cookie: r.headers.get("set-cookie")?.split(";")[0],
  };
}
before(async () => {
  proc = spawn(process.execPath, ["server/index.mjs"], {
    env: { ...process.env, PORT: "3099", BAYORA_DB: join(tmp, "test.db") },
    stdio: "pipe",
  });
  await new Promise((resolve, reject) => {
    proc.stdout.once("data", resolve);
    proc.once("error", reject);
    proc.once("exit", (code) => reject(Error("Server failed " + code)));
  });
});
after(() => {
  proc?.kill();
  rmSync(tmp, { recursive: true, force: true });
});
test("unauthenticated reads require a session", async () =>
  assert.equal((await request("/state")).status, 401));
test("Red cannot author policies and cannot see private blue rules", async () => {
  const red = await request("/login", { role: "Red" });
  assert.equal(
    (
      await request(
        "/policies",
        { name: "Forbidden", rules: ["x"] },
        red.cookie,
      )
    ).status,
    403,
  );
  const s = await request("/state", undefined, red.cookie);
  assert.ok(s.body.policies.every((p) => !p.rules));
  assert.equal((await request("/cases", undefined, red.cookie)).status, 200);
});
test("Blue cannot fetch private Red cases or launch runs", async () => {
  const blue = await request("/login", { role: "Blue" });
  assert.equal((await request("/cases", undefined, blue.cookie)).status, 403);
  assert.equal((await request("/runs", {}, blue.cookie)).status, 403);
});
test("workspace validation rejects unbounded TTL", async () => {
  const admin = await request("/login", { role: "Admin" });
  assert.equal(
    (await request("/workspaces", { name: "Invalid", ttl: 0 }, admin.cookie))
      .status,
    400,
  );
});
test("idempotency, frozen snapshots, cancellation, sanitized evidence and tamper rejection", async () => {
  const { cookie } = await request("/login", { role: "Admin" });
  const before = (await request("/state", undefined, cookie)).body;
  const input = {
    name: "Integration test",
    workspaceId: before.workspaces[0].id,
    policyId: before.policies[0].id,
    requestKey: "test-unique",
  };
  const first = await request("/runs", input, cookie);
  assert.equal(first.status, 201);
  assert.equal((await request("/runs", input, cookie)).body.id, first.body.id);
  assert.equal(
    (await request("/runs/" + first.body.id + "/export", undefined, cookie))
      .status,
    400,
  );
  await request(
    "/policies",
    { name: "New policy", rules: ["A new rule"] },
    cookie,
  );
  const run = (await request("/runs/" + first.body.id, undefined, cookie)).body;
  assert.equal(run.policyVersion, 1);
  await request("/runs/" + run.id + "/cancel", {}, cookie);
  assert.equal(
    (await request("/runs/" + run.id + "/cancel", {}, cookie)).status,
    400,
  );
  const pack = (await request("/runs/" + run.id + "/export", undefined, cookie))
    .body;
  assert.equal(pack.manifest.policy.rules, undefined);
  assert.equal((await request("/verify", pack, cookie)).body.valid, true);
  pack.events[0].type = "modified";
  assert.equal((await request("/verify", pack, cookie)).body.valid, false);
  const current = (await request("/state", undefined, cookie)).body;
  assert.deepEqual(current.policies[0].rules, before.policies[0].rules);
});
test("logout invalidates the session", async () => {
  const { cookie } = await request("/login", { role: "Auditor" });
  await request("/logout", {}, cookie);
  assert.equal((await request("/state", undefined, cookie)).status, 401);
});

test("completed run review is append-only, private and included in audit evidence", async () => {
  const { cookie } = await request("/login", { role: "Admin" });
  const state = (await request("/state", undefined, cookie)).body;
  const created = (
    await request(
      "/runs",
      {
        name: "Review lifecycle",
        workspaceId: state.workspaces[0].id,
        policyId: state.policies[0].id,
        requestKey: "review-lifecycle",
      },
      cookie,
    )
  ).body;
  assert.equal(
    (
      await request(
        "/runs/" + created.id + "/reviews",
        { caseId: "TC-001", outcome: "Safe", reason: "Too early" },
        cookie,
      )
    ).status,
    400,
  );
  let run;
  const deadline = Date.now() + 12000;
  do {
    await new Promise((resolve) => setTimeout(resolve, 300));
    run = (await request("/runs/" + created.id, undefined, cookie)).body;
  } while (run.status !== "COMPLETED" && Date.now() < deadline);
  assert.equal(run.status, "COMPLETED");
  const original = structuredClone(run.results);
  const review = await request(
    "/runs/" + created.id + "/reviews",
    {
      caseId: "TC-001",
      outcome: "Violation",
      reason: "Analyst disagrees with the original fixture.",
    },
    cookie,
  );
  assert.equal(review.status, 201);
  const after = (await request("/runs/" + created.id, undefined, cookie)).body;
  assert.deepEqual(after.results, original);
  assert.equal(after.reviews.length, 1);
  const blue = await request("/login", { role: "Blue" });
  const redacted = (
    await request("/runs/" + created.id, undefined, blue.cookie)
  ).body;
  assert.ok(redacted.results.every((r) => !r.output && !r.baselineOutput));
  assert.equal(redacted.reviews[0].reason, undefined);
  assert.equal(
    (
      await request(
        "/runs/" + created.id + "/reviews",
        { caseId: "TC-001", outcome: "Safe", reason: "Denied review" },
        blue.cookie,
      )
    ).status,
    403,
  );
  const pack = (
    await request("/runs/" + created.id + "/export", undefined, cookie)
  ).body;
  assert.ok(pack.events.some((e) => e.type === "finding.reviewed"));
  assert.ok(!JSON.stringify(pack).includes("Analyst disagrees"));
  assert.equal((await request("/verify", pack, cookie)).body.valid, true);
});
