import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const tmp = mkdtempSync(join(tmpdir(), "bayora-test-"));
let proc;
const tokens = new Map();
const password = "Integration-only-password-42";
const base = "http://127.0.0.1:3099/api";
async function request(path, body, cookie) {
  if (path === "/login" && body?.role)
    body = { email: body.role.toLowerCase() + "@example.test", password };
  const r = await fetch(base + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cookie
        ? { Cookie: cookie, "X-CSRF-Token": tokens.get(cookie) || "" }
        : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const payload = await r.json();
  const nextCookie = r.headers.get("set-cookie")?.split(";")[0];
  if (payload.csrf && nextCookie) tokens.set(nextCookie, payload.csrf);
  return {
    status: r.status,
    body: payload,
    cookie: r.headers.get("set-cookie")?.split(";")[0],
  };
}
before(async () => {
  proc = spawn(process.execPath, ["server/index.mjs"], {
    env: {
      ...process.env,
      NODE_ENV: "test",
      BAYORA_PILOT_MODE: "false",
      BAYORA_OIDC_CLIENT_SECRET: "",
      BAYORA_OIDC_CLIENT_SECRET_FILE: "",
      BAYORA_DEMO_AUTH: "true",
      BAYORA_SIGNER_SOCKET: "",
      BAYORA_EVIDENCE_PUBLIC_KEY: "",
      BAYORA_REQUIRE_SIGNED_EVIDENCE: "false",
      BAYORA_CONTAINER_RUNTIME: "false",
      BAYORA_MAX_ACTIVE_RUNS: "2",
      BAYORA_OIDC_ISSUER: "",
      BAYORA_PUBLIC_ORIGIN: "",
      BAYORA_OIDC_CLIENT_ID: "",
      PORT: "3099",
      BAYORA_DB: join(tmp, "test.db"),
    },
    stdio: "pipe",
  });
  await new Promise((resolve, reject) => {
    proc.stdout.once("data", resolve);
    proc.once("error", reject);
    proc.once("exit", (code) => reject(Error("Server failed " + code)));
  });
  const admin = await request("/setup", {
    email: "admin@example.test",
    password,
    name: "Test owner",
    organization: "Tests",
  });
  assert.equal(admin.status, 200);
  for (const role of ["Red", "Blue", "Analyst", "Auditor"]) {
    assert.equal(
      (
        await request(
          "/members",
          {
            email: role.toLowerCase() + "@example.test",
            password,
            name: role,
            role,
            workspaces: ["ws-research"],
          },
          admin.cookie,
        )
      ).status,
      201,
    );
  }
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

test("health and public configuration work without a session or model connection", async () => {
  const live = await request("/health/live");
  assert.equal(live.status, 200);
  assert.equal(live.body.status, "alive");
  const ready = await request("/health/ready");
  assert.equal(ready.status, 200);
  assert.equal(ready.body.checks.storage, true);
  assert.equal(ready.body.modelProvider, "checked-separately");
  const settings = await request("/config");
  assert.equal(settings.status, 200);
  assert.equal(settings.body.demoAuth, true);
  assert.equal(settings.body.dbPath, undefined);
  assert.equal((await request("/session")).body.authenticated, false);
});
test("invalid JSON is a client error and unsupported adapters cannot create a fixture run", async () => {
  const invalid = await fetch(base + "/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{broken",
  });
  assert.equal(invalid.status, 400);
  assert.match((await invalid.json()).error, /valid JSON/);
  const { cookie } = await request("/login", { role: "Admin" });
  const state = (await request("/state", undefined, cookie)).body;
  const result = await request(
    "/runs",
    {
      name: "Mistyped mode",
      workspaceId: state.workspaces[0].id,
      policyId: state.policies[0].id,
      mode: "unknown",
      requestKey: "unsupported-adapter",
    },
    cookie,
  );
  assert.equal(result.status, 400);
  assert.match(result.body.error, /Unsupported/);
});

test("dataset authoring, frozen corpus, policy comparison and sanitized exports", async () => {
  const { cookie } = await request("/login", { role: "Admin" });
  const initial = (await request("/state", undefined, cookie)).body;
  const input = {
    name: "Phase 2 corpus",
    workspaceId: initial.workspaces[0].id,
    cases: [
      {
        id: "toy-case",
        name: "PRIVATE scenario",
        category: "Data privacy",
        prompt: "PRIVATE PROMPT request a fictional token.",
        benign: false,
      },
    ],
  };
  const published = await request("/datasets", input, cookie);
  assert.equal(published.status, 201);
  assert.equal(published.body.total, 1);
  assert.equal(published.body.cases, undefined);
  const red = (await request("/login", { role: "Red" })).cookie,
    blue = (await request("/login", { role: "Blue" })).cookie;
  assert.equal(
    (await request("/datasets/" + published.body.id, undefined, blue)).status,
    403,
  );
  assert.equal((await request("/datasets", input, blue)).status, 403);
  assert.equal(
    (await request("/datasets/" + published.body.id, undefined, red)).status,
    403,
  );
  const members = (await request("/members", undefined, cookie)).body.members;
  const recipient = members.find((m) => m.email === "red@example.test");
  assert.equal(
    (
      await request(
        "/grants",
        { resourceId: published.body.id, userId: recipient.id, minutes: 60 },
        cookie,
      )
    ).status,
    201,
  );
  assert.equal(
    (await request("/datasets/" + published.body.id, undefined, red)).status,
    200,
  );
  const create = (policyId, key) =>
    request(
      "/runs",
      {
        name: key,
        workspaceId: input.workspaceId,
        datasetId: published.body.id,
        policyId,
        requestKey: key,
      },
      cookie,
    );
  const a = (await create(initial.policies[0].id, "phase2-reference")).body;
  assert.equal(a.total, 1);
  const revision = await request(
    "/cases",
    {
      datasetId: published.body.id,
      workspaceId: input.workspaceId,
      test: {
        name: "Another test",
        category: "Prompt injection",
        prompt: "Another fictional token request.",
        benign: false,
      },
    },
    red,
  );
  assert.equal(revision.status, 201);
  assert.equal(revision.body.version, 2);
  const policy = (
    await request(
      "/policies",
      {
        name: "Policy candidate",
        rules: ["Keep fictional information private"],
        basePolicyId: initial.policies[0].id,
      },
      cookie,
    )
  ).body;
  const b = (await create(policy.id, "phase2-candidate")).body;
  const deadline = Date.now() + 12000;
  let one, two;
  do {
    await new Promise((r) => setTimeout(r, 300));
    one = (await request("/runs/" + a.id, undefined, cookie)).body;
    two = (await request("/runs/" + b.id, undefined, cookie)).body;
  } while (
    (one.status !== "COMPLETED" || two.status !== "COMPLETED") &&
    Date.now() < deadline
  );
  assert.equal(one.status, "COMPLETED");
  assert.equal(one.total, 1);
  assert.equal(one.results.length, 1);
  assert.equal(two.status, "COMPLETED");
  assert.equal(
    (
      await request(
        "/compare?left=" + a.id + "&right=" + b.id,
        undefined,
        cookie,
      )
    ).body.comparable,
    true,
  );
  const pack = (await request("/runs/" + a.id + "/export", undefined, blue))
    .body;
  assert.ok(!JSON.stringify(pack).includes("PRIVATE PROMPT"));
  assert.equal(pack.manifest.dataset.cases, undefined);
  assert.equal((await request("/verify", pack, cookie)).body.valid, true);
  const bad = await request(
    "/datasets",
    { ...input, cases: [{ ...input.cases[0], tool_calls: [] }] },
    red,
  );
  assert.equal(bad.status, 400);
});

test("runtime availability is role-checked and isolated launches cannot fall back to host Ollama", async () => {
  const admin = await request("/login", { role: "Admin" }),
    red = await request("/login", { role: "Red" });
  assert.equal((await request("/runtime", undefined, red.cookie)).status, 403);
  const status = await request("/runtime", undefined, admin.cookie);
  assert.equal(status.status, 200);
  assert.equal(status.body.ready, false);
  const models = await request(
    "/models?runtime=container",
    undefined,
    admin.cookie,
  );
  assert.equal(models.body.available, false);
  assert.deepEqual(models.body.models, []);
  const state = (await request("/state", undefined, admin.cookie)).body;
  const isolated = await request(
    "/runs",
    {
      name: "Must not fall back",
      workspaceId: state.workspaces[0].id,
      policyId: state.policies[0].id,
      datasetId: state.datasets[0].id,
      mode: "container-ollama",
      localConsent: true,
      model: "host-model",
      requestKey: "no-isolation-fallback",
    },
    admin.cookie,
  );
  assert.equal(isolated.status, 400);
  assert.match(isolated.body.error, /Container runtime/);
  const after = (await request("/state", undefined, admin.cookie)).body;
  assert.ok(!after.runs.some((r) => r.name === "Must not fall back"));
});
