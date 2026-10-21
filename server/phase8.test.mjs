import { createAuth } from "./auth.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  writeFileSync,
  chmodSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { Readable } from "node:stream";
import { setTimeout as delay } from "node:timers/promises";
import { createApplication } from "./app.mjs";
import { readConfig, storagePaths } from "./config.mjs";
import { secretValue } from "./secrets.mjs";
import {
  createRequestLimiter,
  requirePilotTransport,
  secureHeaders,
} from "./hardening.mjs";
import { createStore } from "./store.mjs";
import { checkExecutionPolicy } from "./pilot.mjs";
import { inspectAcceptance, PILOT_GATES } from "./pilot-acceptance.mjs";
import { createSigner } from "./evidence/signer.mjs";
function call(app, path, body, client = {}) {
  return new Promise((resolve) => {
    const req = Readable.from(
      body === undefined ? [] : [Buffer.from(JSON.stringify(body))],
    );
    Object.assign(req, {
      url: "/api" + path,
      method: body === undefined ? "GET" : "POST",
      socket: { remoteAddress: "127.0.0.1" },
      headers: {
        host: "127.0.0.1:3001",
        cookie: client.cookie,
        "x-csrf-token": client.csrf,
      },
    });
    const headers = {};
    const res = {
      setHeader(k, v) {
        headers[k] = v;
      },
      writeHead(status) {
        this.status = status;
      },
      end(raw) {
        const data = JSON.parse(raw);
        resolve({
          status: this.status,
          body: data,
          client: {
            ...client,
            ...(headers["Set-Cookie"]
              ? { cookie: headers["Set-Cookie"].split(";")[0] }
              : {}),
            ...(data.csrf ? { csrf: data.csrf } : {}),
          },
        });
      },
    };
    app.server.emit("request", req, res);
  });
}
function keys(dir) {
  const key = generateKeyPairSync("ed25519");
  writeFileSync(
    join(dir, "private.pem"),
    key.privateKey.export({ type: "pkcs8", format: "pem" }),
  );
  writeFileSync(
    join(dir, "public.pem"),
    key.publicKey.export({ type: "spki", format: "pem" }),
  );
  writeFileSync(join(dir, "token"), randomBytes(32).toString("hex"));
  return {
    keyPath: join(dir, "private.pem"),
    tokenPath: join(dir, "token"),
    dbPath: join(dir, "ledger.db"),
  };
}

const password = "Pilot-integration-test-password";
async function setup(app) {
  const admin = (
    await call(app, "/setup", { email: "pilot@tests.local", password })
  ).client;
  const state = (await call(app, "/state", undefined, admin)).body;
  return { admin, state };
}
async function wait(fn) {
  for (let i = 0; i < 150; i++) {
    const value = await fn();
    if (value) return value;
    await delay(30);
  }
  throw Error("Condition timed out");
}
function pilotEnvironment(dir) {
  const key = keys(dir),
    authKey = join(dir, "mfa.key"),
    secret = join(dir, "oidc-secret"),
    acceptance = join(dir, "acceptance.json");
  writeFileSync(authKey, randomBytes(32), { mode: 0o600 });
  writeFileSync(secret, "test-only-client-secret", { mode: 0o600 });
  chmodSync(key.tokenPath, 0o600);
  const accepted = {
    origin: "https://pilot.example.test",
    scope: "prompt-only-synthetic",
    validUntil: new Date(Date.now() + 86400000).toISOString(),
    owners: {
      operations: "Test operator",
      security: "Test reviewer",
      data: "Test data owner",
    },
    gates: Object.fromEntries(
      PILOT_GATES.map((g) => [
        g,
        {
          approved: true,
          reviewer: "TEST FIXTURE ONLY",
          reportSha256: "a".repeat(64),
        },
      ]),
    ),
  };
  writeFileSync(acceptance, JSON.stringify(accepted), { mode: 0o600 });
  return {
    NODE_ENV: "production",
    BAYORA_PILOT_MODE: "true",
    BAYORA_DEMO_AUTH: "false",
    BAYORA_OIDC_ISSUER: "https://id.example.test",
    BAYORA_OIDC_CLIENT_ID: "test-client",
    BAYORA_OIDC_CLIENT_SECRET_FILE: secret,
    BAYORA_OIDC_REQUIRE_MFA: "true",
    BAYORA_PUBLIC_ORIGIN: accepted.origin,
    BAYORA_TRUST_PROXY: "true",
    BAYORA_CONTAINER_RUNTIME: "true",
    BAYORA_WORKER_IMAGE: "sha256:" + "a".repeat(64),
    BAYORA_MODEL_IMAGE: "sha256:" + "b".repeat(64),
    BAYORA_MODEL_VOLUME: "test-models",
    BAYORA_CONTAINER_MODEL: "test:1",
    BAYORA_CONTAINER_MODEL_DIGEST: "c".repeat(64),
    BAYORA_SIGNER_SOCKET: join(dir, "signer.sock"),
    BAYORA_SIGNER_TOKEN: key.tokenPath,
    BAYORA_EVIDENCE_PUBLIC_KEY: join(dir, "public.pem"),
    BAYORA_REQUIRE_SIGNED_EVIDENCE: "true",
    BAYORA_AUTH_KEY: authKey,
    BAYORA_PILOT_ACCEPTANCE_FILE: acceptance,
    BAYORA_DB: join(dir, "app.db"),
  };
}
test("pilot startup requires protected files, exact runtime configuration and unexpired operator evidence gates", () => {
  assert.deepEqual(
    storagePaths({
      BAYORA_DB: "/test/db",
      BAYORA_AUTH_KEY: "/test/key",
      NODE_ENV: "production",
      BAYORA_PILOT_MODE: "true",
    }),
    { dbPath: "/test/db", authKeyPath: "/test/key" },
  );
  const dir = mkdtempSync(join(tmpdir(), "bayora-pilot-config-"));
  try {
    const env = pilotEnvironment(dir),
      config = readConfig(env);
    assert.equal(config.pilotMode, true);
    assert.deepEqual(config.origins, ["https://pilot.example.test"]);
    assert.ok(config.hosts.includes("pilot.example.test"));
    for (const changed of [
      { BAYORA_TRUST_PROXY: "false" },
      { BAYORA_CONTAINER_RUNTIME: "false" },
      { BAYORA_OIDC_REQUIRE_MFA: "false" },
      { BAYORA_PILOT_ACCEPTANCE_FILE: "" },
      { BAYORA_SIGNER_PRIVATE_KEY: "must-not-be-in-api" },
      { BAYORA_CONTAINER_MODEL_DIGEST: "" },
    ])
      assert.throws(() => readConfig({ ...env, ...changed }));
    const accepted = JSON.parse(readFileSync(env.BAYORA_PILOT_ACCEPTANCE_FILE));
    accepted.gates.securityReview.approved = false;
    writeFileSync(env.BAYORA_PILOT_ACCEPTANCE_FILE, JSON.stringify(accepted));
    assert.throws(() => readConfig(env), /securityReview/);
    accepted.gates.securityReview.approved = true;
    accepted.validUntil = "2020-01-01";
    writeFileSync(env.BAYORA_PILOT_ACCEPTANCE_FILE, JSON.stringify(accepted));
    assert.equal(
      inspectAcceptance(
        env.BAYORA_PILOT_ACCEPTANCE_FILE,
        env.BAYORA_PUBLIC_ORIGIN,
      ).ready,
      false,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("file secrets reject broad permissions, symlinks, duplicate configuration and leaked values in errors", () => {
  const dir = mkdtempSync(join(tmpdir(), "bayora-secret-")),
    path = join(dir, "secret");
  try {
    writeFileSync(path, "TEST-SECRET-VALUE", { mode: 0o600 });
    assert.equal(secretValue({ X_FILE: path }, "X"), "TEST-SECRET-VALUE");
    assert.throws(() => secretValue({ X_FILE: path, X: "value" }, "X"));
    chmodSync(path, 0o644);
    assert.throws(
      () => secretValue({ X_FILE: path }, "X"),
      (e) => !e.message.includes("TEST-SECRET-VALUE"),
    );
    chmodSync(path, 0o600);
    symlinkSync(path, join(dir, "link"));
    assert.throws(() => secretValue({ X_FILE: join(dir, "link") }, "X"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("pilot transport rejects spoofed or insecure forwarding; headers and bounded request limits apply", () => {
  const config = {
      pilotMode: true,
      trustProxy: true,
      publicOrigin: "https://pilot.example.test",
    },
    url = new URL("https://pilot.example.test/api/state");
  const req = {
    method: "GET",
    socket: { remoteAddress: "127.0.0.1" },
    headers: {
      "x-forwarded-proto": "https",
      "x-forwarded-host": "pilot.example.test",
      "x-forwarded-for": "192.0.2.2",
    },
  };
  assert.equal(requirePilotTransport(req, url, config), "192.0.2.2");
  assert.throws(() =>
    requirePilotTransport(
      { ...req, socket: { remoteAddress: "192.0.2.3" } },
      url,
      config,
    ),
  );
  assert.throws(() =>
    requirePilotTransport(
      { ...req, headers: { ...req.headers, "x-forwarded-proto": "http" } },
      url,
      config,
    ),
  );
  assert.throws(() =>
    requirePilotTransport(
      {
        ...req,
        headers: { ...req.headers, "x-forwarded-host": "evil.example" },
      },
      url,
      config,
    ),
  );
  assert.equal(
    requirePilotTransport(
      { method: "GET", socket: req.socket, headers: {} },
      new URL("http://localhost/api/health/live"),
      config,
    ),
    "127.0.0.1",
  );
  const headers = {};
  secureHeaders({ setHeader: (k, v) => (headers[k] = v) }, config);
  assert.equal(headers["X-Frame-Options"], "DENY");
  assert.match(headers["Content-Security-Policy"], /frame-ancestors 'none'/);
  assert.ok(headers["Strict-Transport-Security"]);
  const limit = createRequestLimiter({ limit: 2, windowMs: 10, maxEntries: 1 });
  assert.equal(limit("a", 1), true);
  assert.equal(limit("a", 2), true);
  assert.equal(limit("a", 3), false);
  assert.equal(limit("b", 3), false);
  assert.equal(limit("b", 12), true);
});
test("exact model approval is tenant scoped, revocable, and required for pilot container execution", () => {
  const store = createStore(":memory:");
  try {
    const policy = {
      config: { pilotMode: true },
      pilot: store.pilot,
      orgId: "one",
      mode: "container-ollama",
      model: { id: "test:1", digest: "a".repeat(64) },
    };
    assert.throws(() => checkExecutionPolicy(policy), /approval/);
    const id = store.pilot.approve(
      "one",
      "test:1",
      "a".repeat(64),
      "Test-only approval reason",
      "u",
    );
    assert.doesNotThrow(() => checkExecutionPolicy(policy));
    assert.throws(() => checkExecutionPolicy({ ...policy, orgId: "two" }));
    assert.throws(() => checkExecutionPolicy({ ...policy, mode: "ollama" }));
    assert.throws(() =>
      checkExecutionPolicy({
        ...policy,
        model: { id: "test:1", digest: "b".repeat(64) },
      }),
    );
    store.pilot.revoke("one", id);
    assert.throws(() => checkExecutionPolicy(policy));
  } finally {
    store.close();
  }
});
test("incident containment blocks launches and stops actual workers while preserving terminal history", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bayora-containment-")),
    app = createApplication({
      ...readConfig({ BAYORA_DB: join(dir, "app.db") }),
      syntheticStepMs: 100,
    });
  try {
    const { admin, state } = await setup(app),
      configuration = {
        name: "Pause test",
        workspaceId: state.workspaces[0].id,
        policyId: state.policies[0].id,
        datasetId: state.datasets[0].id,
        requestKey: "pause-running",
      };
    const run = (await call(app, "/runs", configuration, admin)).body;
    await wait(
      async () =>
        (await call(app, "/pilot/status", undefined, admin)).body.control
          .paused === 0,
    );
    assert.equal(
      (
        await call(
          app,
          "/pilot/containment",
          { paused: true, reason: "Test incident containment operation" },
          admin,
        )
      ).status,
      200,
    );
    await wait(
      async () =>
        (await call(app, "/runs/" + run.id, undefined, admin)).body.status ===
        "FAILED",
    );
    assert.equal(
      (
        await call(
          app,
          "/runs",
          { ...configuration, requestKey: "paused-blocked" },
          admin,
        )
      ).status,
      423,
    );
    await call(
      app,
      "/pilot/containment",
      {
        paused: false,
        reason: "Reviewed test incident and restored operations",
      },
      admin,
    );
    const retry = (
      await call(
        app,
        "/runs",
        { ...configuration, requestKey: "resume-new-run" },
        admin,
      )
    ).body;
    assert.ok(retry.id);
    await call(app, "/runs/" + retry.id + "/cancel", {}, admin);
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("workspace removal honors holds/stale plans and preserves verifiable signed evidence after private-content removal", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bayora-purge-")),
    key = keys(dir),
    socket = join(dir, "signer.sock"),
    signer = createSigner(key);
  await signer.listen(socket);
  const path = join(dir, "app.db"),
    app = createApplication({
      ...readConfig({
        BAYORA_DB: path,
        BAYORA_SIGNER_SOCKET: socket,
        BAYORA_SIGNER_TOKEN: key.tokenPath,
        BAYORA_EVIDENCE_PUBLIC_KEY: join(dir, "public.pem"),
        BAYORA_REQUIRE_SIGNED_EVIDENCE: "true",
      }),
      syntheticStepMs: 10,
    });
  try {
    const { admin } = await setup(app);
    const workspace = (
      await call(
        app,
        "/workspaces",
        {
          name: "Retention test workspace",
          ttl: 1,
          purpose: "Synthetic retention acceptance",
        },
        admin,
      )
    ).body;
    const policy = (
      await call(
        app,
        "/policies",
        {
          name: "Private workspace policy",
          workspaceId: workspace.id,
          rules: ["PRIVATE_RULE_SENTINEL_8362"],
        },
        admin,
      )
    ).body;
    const dataset = (
      await call(
        app,
        "/datasets",
        {
          name: "Private workspace corpus",
          workspaceId: workspace.id,
          cases: [
            {
              id: "retention-case",
              name: "Fictional request",
              category: "Data privacy",
              prompt: "PRIVATE_PROMPT_SENTINEL_8362",
              benign: false,
            },
          ],
        },
        admin,
      )
    ).body;
    const run = (
      await call(
        app,
        "/runs",
        {
          name: "Retention evidence",
          workspaceId: workspace.id,
          policyId: policy.id,
          datasetId: dataset.id,
          requestKey: "retention-run",
        },
        admin,
      )
    ).body;
    assert.equal(
      (
        await call(
          app,
          "/pilot/retention/plan",
          { workspaceId: workspace.id },
          admin,
        )
      ).status,
      409,
    );
    await wait(
      async () =>
        (await call(app, "/runs/" + run.id, undefined, admin)).body.status ===
        "COMPLETED",
    );
    const original = (
      await call(app, "/runs/" + run.id + "/export", undefined, admin)
    ).body;
    assert.equal(
      (await call(app, "/verify", original, admin)).body.trusted,
      true,
    );
    await call(
      app,
      "/pilot/retention-hold",
      {
        workspaceId: workspace.id,
        held: true,
        reason: "Preserve test artifacts during the review window",
      },
      admin,
    );
    assert.equal(
      (
        await call(
          app,
          "/pilot/retention/plan",
          { workspaceId: workspace.id },
          admin,
        )
      ).status,
      409,
    );
    await call(
      app,
      "/pilot/retention-hold",
      {
        workspaceId: workspace.id,
        held: false,
        reason: "Completed test artifact review window",
      },
      admin,
    );
    const stale = (
      await call(
        app,
        "/pilot/retention/plan",
        { workspaceId: workspace.id },
        admin,
      )
    ).body;
    await call(
      app,
      "/runs/" + run.id + "/reviews",
      {
        caseId: "retention-case",
        outcome: "Safe",
        reason: "PRIVATE_REVIEW_SENTINEL_8362",
      },
      admin,
    );
    const apply = {
      planId: stale.id,
      confirmation: workspace.name,
      reason: "Apply the reviewed synthetic removal plan",
    };
    assert.equal(
      (await call(app, "/pilot/retention/apply", apply, admin)).status,
      409,
    );
    const plan = (
      await call(
        app,
        "/pilot/retention/plan",
        { workspaceId: workspace.id },
        admin,
      )
    ).body;
    assert.equal(
      (
        await call(
          app,
          "/pilot/retention/apply",
          { ...apply, planId: plan.id, confirmation: "wrong" },
          admin,
        )
      ).status,
      409,
    );
    assert.equal(
      (
        await call(
          app,
          "/pilot/retention/apply",
          { ...apply, planId: plan.id },
          admin,
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await call(
          app,
          "/pilot/retention/apply",
          { ...apply, planId: plan.id },
          admin,
        )
      ).status,
      409,
    );
    const current = (
      await call(app, "/runs/" + run.id + "/export", undefined, admin)
    ).body;
    assert.equal(current.manifestHash, original.manifestHash);
    assert.equal(current.resultsHash, original.resultsHash);
    assert.equal(
      (await call(app, "/verify", current, admin)).body.trusted,
      true,
    );
    const details = (await call(app, "/runs/" + run.id, undefined, admin)).body;
    assert.equal(details.rawAccess, false);
    assert.ok(details.contentPurgedAt);
    assert.ok(!("output" in details.results[0]));
    assert.equal(
      (await call(app, "/runs/" + run.id + "/configuration", undefined, admin))
        .status,
      400,
    );
    assert.equal(
      (await call(app, "/datasets/" + dataset.id, undefined, admin)).status,
      404,
    );
    const store = createStore(path);
    try {
      const serialized = JSON.stringify(store.allState);
      for (const marker of [
        "PRIVATE_PROMPT_SENTINEL_8362",
        "PRIVATE_RULE_SENTINEL_8362",
        "PRIVATE_REVIEW_SENTINEL_8362",
      ])
        assert.ok(!serialized.includes(marker));
    } finally {
      store.close();
    }
  } finally {
    await app.close();
    await signer.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("pilot operator endpoints deny other roles and foreign-organization retention plans", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bayora-pilot-scope-")),
    app = createApplication(readConfig({ BAYORA_DB: join(dir, "app.db") }));
  try {
    const { admin, state } = await setup(app);
    await call(
      app,
      "/members",
      {
        email: "auditor@pilot.test",
        password,
        role: "Auditor",
        workspaces: [state.workspaces[0].id],
      },
      admin,
    );
    const auditor = (
      await call(app, "/login", { email: "auditor@pilot.test", password })
    ).client;
    for (const endpoint of ["/pilot/status", "/pilot/approvals"])
      assert.equal(
        (
          await call(
            app,
            endpoint,
            endpoint.endsWith("status") ? undefined : {},
            auditor,
          )
        ).status,
        403,
      );
    const org = (
      await call(
        app,
        "/organizations",
        { name: "Separate operator organization" },
        admin,
      )
    ).body;
    const other = (
      await call(
        app,
        "/organizations/switch",
        { organizationId: org.id },
        admin,
      )
    ).client;
    assert.equal(
      (
        await call(
          app,
          "/pilot/retention/plan",
          { workspaceId: state.workspaces[0].id },
          other,
        )
      ).status,
      404,
    );
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("production refuses persisted development sessions even when a trusted proxy forwards them", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bayora-session-assurance-")),
    path = join(dir, "app.db");
  keys(dir);
  let app = createApplication(readConfig({ BAYORA_DB: path }));
  try {
    const { admin } = await setup(app);
    await app.close();
    app = createApplication(
      readConfig({
        BAYORA_DB: path,
        NODE_ENV: "production",
        BAYORA_DEMO_AUTH: "false",
        BAYORA_OIDC_ISSUER: "https://id.example.test",
        BAYORA_OIDC_CLIENT_ID: "test",
        BAYORA_PUBLIC_ORIGIN: "https://pilot.example.test",
        BAYORA_OIDC_REQUIRE_MFA: "true",
        BAYORA_REQUIRE_SIGNED_EVIDENCE: "true",
        BAYORA_SIGNER_SOCKET: join(dir, "unavailable.sock"),
        BAYORA_EVIDENCE_PUBLIC_KEY: join(dir, "public.pem"),
      }),
    );
    assert.equal((await call(app, "/state", undefined, admin)).status, 401);
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("production sessions require matching OIDC issuer and recorded MFA assurance", () => {
  const store = createStore(":memory:"),
    config = {
      environment: "production",
      demoAuth: false,
      oidcIssuer: "https://id.example.test",
      oidcRequireMfa: true,
      authKeyPath: null,
      sessionTtlMs: 60000,
    };
  const user = store.identity.addUser(
      { email: "assurance@pilot.test" },
      "unused-password-hash",
    ),
    org = store.identity.addOrg("Assurance test");
  store.identity.setMembership(user.id, org.id, "Admin", []);
  const auth = createAuth({ ...store, config });
  try {
    function issued(assurance) {
      let cookie;
      auth.issue(
        {
          setHeader(k, v) {
            if (k === "Set-Cookie") cookie = v;
          },
          writeHead() {},
          end() {},
        },
        user,
        org.id,
        {},
        false,
        assurance,
      );
      return auth.session({ headers: { cookie } });
    }
    assert.equal(
      issued({ method: "local", mfa: true, issuer: config.oidcIssuer }),
      null,
    );
    assert.equal(
      issued({ method: "oidc", mfa: false, issuer: config.oidcIssuer }),
      null,
    );
    assert.equal(
      issued({
        method: "oidc",
        mfa: true,
        issuer: "https://another.example.test",
      }),
      null,
    );
    assert.equal(
      issued({ method: "oidc", mfa: true, issuer: config.oidcIssuer }).userId,
      user.id,
    );
  } finally {
    auth.close();
    store.close();
  }
});
