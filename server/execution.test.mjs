import { test } from "node:test";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { setTimeout as delay } from "node:timers/promises";
import { createServer } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { createApplication } from "./app.mjs";
import { readConfig } from "./config.mjs";
import { createQueue } from "./execution/queue.mjs";
import { acquireBrokerLock } from "./execution/lock.mjs";
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

const password = "Execution-failure-test-password";
async function wait(fn, timeout = 10000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const value = await fn();
    if (value) return value;
    await delay(30);
  }
  throw Error("Condition timed out");
}
async function setup(app) {
  const admin = (
    await call(app, "/setup", { email: "execution@tests.local", password })
  ).client;
  const s = (await call(app, "/state", undefined, admin)).body;
  return {
    admin,
    configuration: {
      name: "Execution test",
      workspaceId: s.workspaces[0].id,
      policyId: s.policies[0].id,
      datasetId: s.datasets[0].id,
      mode: "synthetic-demo",
    },
  };
}
test("SQLite queue reserves quota/idempotency atomically, scopes workspace keys and fences expired leases", () => {
  const dir = mkdtempSync(join(tmpdir(), "bayora-queue-")),
    db = new DatabaseSync(join(dir, "db"));
  try {
    const queue = createQueue(db);
    const run = {
      id: "r",
      orgId: "o",
      ownerId: "u",
      workspaceId: "w",
      requestKey: "same",
      execution: { deadline: Date.now() + 10000, maxCalls: 2 },
    };
    db.exec("BEGIN IMMEDIATE");
    queue.reserve(run, 2);
    db.exec("COMMIT");
    db.exec("BEGIN IMMEDIATE");
    assert.throws(() => queue.reserve({ ...run, id: "other" }, 2), /UNIQUE/);
    db.exec("ROLLBACK");
    assert.equal(queue.all().length, 1);
    queue.reserve({ ...run, id: "other-workspace", workspaceId: "w2" }, 2);
    assert.throws(
      () => queue.reserve({ ...run, id: "full", requestKey: "full" }, 2),
      /Concurrency/,
    );
    queue.ready("r");
    const token = queue.claim("r", 1000);
    assert.ok(token);
    assert.equal(queue.claim("r", 1000), null);
    assert.equal(queue.heartbeat("r", "forged", 123, 1000), false);
    db.prepare("UPDATE execution_jobs SET lease_until=0 WHERE run_id=?").run(
      "r",
    );
    assert.equal(queue.heartbeat("r", token, 123, 1000), false);
    const unlock = acquireBrokerLock(join(dir, "app.db"));
    assert.throws(
      () => acquireBrokerLock(join(dir, "app.db")),
      /running API broker/,
    );
    unlock();
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("killing an actual live worker preserves completed and unknown partial attempts; retry is a distinct linked execution", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bayora-worker-kill-")),
    dbPath = join(dir, "app.db");
  let calls = 0,
    block = true;
  const model = createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      res.setHeader("Content-Type", "application/json");
      if (req.url === "/api/tags") {
        res.end(
          JSON.stringify({
            models: [{ name: "fixture:latest", digest: "a".repeat(64) }],
          }),
        );
        return;
      }
      calls++;
      if (block && calls === 2) return;
      res.end(
        JSON.stringify({
          done: true,
          message: { content: "I cannot disclose private context." },
        }),
      );
    });
  });
  await new Promise((r) => model.listen(0, "127.0.0.1", r));
  const app = createApplication(
    readConfig({
      BAYORA_DB: dbPath,
      BAYORA_OLLAMA_ORIGIN: "http://127.0.0.1:" + model.address().port,
    }),
  );
  const db = new DatabaseSync(dbPath);
  try {
    const { admin, configuration } = await setup(app);
    const started = await call(
      app,
      "/runs",
      {
        ...configuration,
        mode: "ollama",
        model: "fixture:latest",
        localConsent: true,
        requestKey: "worker-kill-test",
      },
      admin,
    );
    assert.equal(started.status, 201);
    const id = started.body.id;
    await wait(async () => {
      const r = (await call(app, "/runs/" + id, undefined, admin)).body;
      return r.attempts.length === 1 && calls === 2;
    });
    const job = db
      .prepare("SELECT * FROM execution_jobs WHERE run_id=?")
      .get(id);
    assert.notEqual(job.worker_pid, process.pid);
    assert.equal(job.max_calls, 40);
    process.kill(job.worker_pid, "SIGKILL");
    const failed = await wait(async () => {
      const r = (await call(app, "/runs/" + id, undefined, admin)).body;
      return r.status === "FAILED" && r;
    });
    assert.equal(failed.attempts.length, 2);
    assert.equal(failed.attempts[0].status, "COMPLETED");
    assert.match(failed.attempts[1].error, /outcome unknown/);
    const exported = (
      await call(app, "/runs/" + id + "/export", undefined, admin)
    ).body;
    assert.equal(
      (await call(app, "/verify", exported, admin)).body.valid,
      true,
    );
    block = false;
    const clone = (
      await call(app, "/runs/" + id + "/configuration", undefined, admin)
    ).body;
    const retry = (
      await call(
        app,
        "/runs",
        { ...clone, localConsent: true, requestKey: "linked-worker-retry" },
        admin,
      )
    ).body;
    assert.notEqual(retry.id, id);
    assert.equal(retry.parentId, id);
    assert.equal(retry.execution.attemptNumber, 2);
    await wait(
      async () =>
        (await call(app, "/runs/" + retry.id, undefined, admin)).body.status ===
        "COMPLETED",
    );
    assert.equal(
      (await call(app, "/runs/" + id, undefined, admin)).body.attempts.length,
      2,
    );
    assert.equal(calls, 42);
  } finally {
    await app.close();
    db.close();
    model.closeAllConnections();
    await new Promise((r) => model.close(r));
    rmSync(dir, { recursive: true, force: true });
  }
});
test("queued work survives broker restart with original deadlines; interrupted jobs are never executed twice", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bayora-restart-")),
    dbPath = join(dir, "app.db"),
    config = { ...readConfig({ BAYORA_DB: dbPath }), syntheticStepMs: 150 };
  let app = createApplication(config);
  const db = new DatabaseSync(dbPath);
  try {
    const { admin, configuration } = await setup(app);
    const a = (
      await call(
        app,
        "/runs",
        { ...configuration, requestKey: "restart-one" },
        admin,
      )
    ).body;
    await wait(
      () =>
        db
          .prepare("SELECT worker_pid FROM execution_jobs WHERE run_id=?")
          .get(a.id)?.worker_pid,
    );
    const b = (
      await call(
        app,
        "/runs",
        { ...configuration, requestKey: "restart-two" },
        admin,
      )
    ).body;
    const before = db
      .prepare("SELECT * FROM execution_jobs WHERE run_id=?")
      .get(b.id);
    assert.equal(before.state, "READY");
    await app.close();
    app = createApplication({ ...config, syntheticStepMs: 20 });
    await wait(
      async () =>
        (await call(app, "/runs/" + b.id, undefined, admin)).body.status ===
        "COMPLETED",
    );
    const terminal = (await call(app, "/runs/" + a.id, undefined, admin)).body;
    assert.equal(terminal.status, "FAILED");
    assert.equal(
      db.prepare("SELECT deadline FROM execution_jobs WHERE run_id=?").get(b.id)
        .deadline,
      before.deadline,
    );
    assert.equal(
      (
        await call(
          app,
          "/runs",
          { ...configuration, requestKey: "restart-one" },
          admin,
        )
      ).body.id,
      a.id,
    );
  } finally {
    await app.close();
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("an unresponsive real worker loses its lease and is failed within the bounded recovery window", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bayora-lease-")),
    dbPath = join(dir, "app.db");
  const app = createApplication({
      ...readConfig({ BAYORA_DB: dbPath, BAYORA_WORKER_LEASE_MS: "2000" }),
      syntheticStepMs: 1000,
    }),
    db = new DatabaseSync(dbPath);
  try {
    const { admin, configuration } = await setup(app);
    const run = (
      await call(
        app,
        "/runs",
        { ...configuration, requestKey: "lease-expiry" },
        admin,
      )
    ).body;
    const pid = await wait(
      () =>
        db
          .prepare("SELECT worker_pid FROM execution_jobs WHERE run_id=?")
          .get(run.id)?.worker_pid,
    );
    process.kill(pid, "SIGSTOP");
    const failed = await wait(async () => {
      const r = (await call(app, "/runs/" + run.id, undefined, admin)).body;
      return r.status === "FAILED" && r;
    }, 5000);
    assert.match(failed.error, /lease expired/);
    assert.equal(
      db.prepare("SELECT state FROM execution_jobs WHERE run_id=?").get(run.id)
        .state,
      "DONE",
    );
  } finally {
    await app.close();
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a persisted queued deadline is not extended by restart and expired work never starts", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bayora-expiry-")),
    dbPath = join(dir, "app.db");
  let app = createApplication({
    ...readConfig({ BAYORA_DB: dbPath }),
    syntheticStepMs: 500,
  });
  const db = new DatabaseSync(dbPath);
  try {
    const { admin, configuration } = await setup(app);
    const one = (
      await call(
        app,
        "/runs",
        { ...configuration, requestKey: "holding-worker" },
        admin,
      )
    ).body;
    await wait(
      () =>
        db
          .prepare("SELECT worker_pid FROM execution_jobs WHERE run_id=?")
          .get(one.id)?.worker_pid,
    );
    const queued = (
      await call(
        app,
        "/runs",
        { ...configuration, requestKey: "expired-queued" },
        admin,
      )
    ).body;
    await app.close();
    db.prepare("UPDATE execution_jobs SET deadline=1 WHERE run_id=?").run(
      queued.id,
    );
    app = createApplication(readConfig({ BAYORA_DB: dbPath }));
    const failed = await wait(async () => {
      const r = (await call(app, "/runs/" + queued.id, undefined, admin)).body;
      return r.status === "FAILED" && r;
    });
    assert.match(failed.error, /deadline exceeded/);
    assert.equal(
      db
        .prepare("SELECT worker_pid FROM execution_jobs WHERE run_id=?")
        .get(queued.id).worker_pid,
      null,
    );
    assert.equal(failed.completed, 0);
  } finally {
    await app.close();
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("SIGKILL of the API broker preserves queued work and recovers interrupted execution without replay", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bayora-broker-crash-")),
    dbPath = join(dir, "app.db"),
    port = 3096;
  let child;
  async function start() {
    child = spawn(process.execPath, ["server/index.mjs"], {
      env: {
        ...process.env,
        PORT: String(port),
        BAYORA_DB: dbPath,
        NODE_ENV: "test",
        BAYORA_PILOT_MODE: "false",
        BAYORA_OIDC_CLIENT_SECRET: "",
        BAYORA_OIDC_CLIENT_SECRET_FILE: "",
        BAYORA_CONTAINER_RUNTIME: "false",
        BAYORA_MAX_ACTIVE_RUNS: "2",
        BAYORA_SIGNER_SOCKET: "",
        BAYORA_EVIDENCE_PUBLIC_KEY: "",
        BAYORA_REQUIRE_SIGNED_EVIDENCE: "false",
        BAYORA_OIDC_ISSUER: "",
        BAYORA_PUBLIC_ORIGIN: "",
        BAYORA_DEMO_AUTH: "true",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    await new Promise((resolve, reject) => {
      child.stdout.once("data", resolve);
      child.once("error", reject);
      child.once("exit", () => reject(Error("Broker exited during startup")));
    });
  }
  let cookie, csrf;
  async function request(path, body) {
    const response = await fetch(`http://127.0.0.1:${port}/api${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        "Content-Type": "application/json",
        ...(cookie ? { cookie, "X-CSRF-Token": csrf } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const data = await response.json();
    if (response.headers.get("set-cookie"))
      cookie = response.headers.get("set-cookie").split(";")[0];
    if (data.csrf) csrf = data.csrf;
    assert.ok(response.ok, JSON.stringify(data));
    return data;
  }
  try {
    await start();
    await request("/setup", { email: "broker@tests.local", password });
    const s = await request("/state");
    const configuration = {
      name: "Crash recovery",
      workspaceId: s.workspaces[0].id,
      policyId: s.policies[0].id,
      datasetId: s.datasets[0].id,
    };
    const a = await request("/runs", {
      ...configuration,
      requestKey: "crash-one",
    });
    const b = await request("/runs", {
      ...configuration,
      requestKey: "crash-two",
    });
    const db = new DatabaseSync(dbPath);
    const original = db
      .prepare("SELECT deadline FROM execution_jobs WHERE run_id=?")
      .get(b.id).deadline;
    db.close();
    const exited = new Promise((r) => child.once("exit", r));
    child.kill("SIGKILL");
    await exited;
    await start();
    const failed = await request("/runs/" + a.id);
    assert.equal(failed.status, "FAILED");
    await wait(
      async () => (await request("/runs/" + b.id)).status === "COMPLETED",
      12000,
    );
    const final = new DatabaseSync(dbPath);
    assert.equal(
      final
        .prepare("SELECT deadline FROM execution_jobs WHERE run_id=?")
        .get(b.id).deadline,
      original,
    );
    assert.equal(
      final.prepare("SELECT count(*) n FROM execution_jobs").get().n,
      2,
    );
    final.close();
    assert.equal(
      (await request("/runs", { ...configuration, requestKey: "crash-one" }))
        .id,
      a.id,
    );
  } finally {
    if (child?.exitCode === null) {
      const exit = new Promise((r) => child.once("exit", r));
      child.kill("SIGTERM");
      await exit;
    }
    rmSync(dir, { recursive: true, force: true });
  }
});
