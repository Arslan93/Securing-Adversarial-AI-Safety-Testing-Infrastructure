import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { setTimeout as delay } from "node:timers/promises";
import { createApplication } from "./app.mjs";
import { readConfig } from "./config.mjs";
import { createReport } from "./reports.mjs";
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

const password = "Phase-six-integration-password";
async function setup(app) {
  const auth = await call(app, "/setup", {
    email: "owner@phase6.test",
    password,
  });
  assert.equal(auth.status, 200);
  const state = (await call(app, "/state", undefined, auth.client)).body;
  return {
    admin: auth.client,
    state,
    configuration: {
      name: "Saved evaluation",
      workspaceId: state.workspaces[0].id,
      policyId: state.policies[0].id,
      datasetId: state.datasets[0].id,
      mode: "synthetic-demo",
    },
  };
}
test("drafts persist across restart, reject stale writes and launch once with frozen configuration", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bayora-drafts-"));
  const config = readConfig({ BAYORA_DB: join(dir, "app.db") });
  let app = createApplication(config);
  try {
    const { admin, configuration } = await setup(app);
    const created = await call(
      app,
      "/drafts",
      { ...configuration, localConsent: true, requestKey: "do-not-store" },
      admin,
    );
    assert.equal(created.status, 201);
    assert.equal(created.body.version, 1);
    assert.equal(created.body.localConsent, undefined);
    assert.equal(created.body.requestKey, undefined);
    assert.equal(
      (await call(app, "/state", undefined, admin)).body.runs.length,
      0,
    );
    await app.close();
    app = createApplication(config);
    const draft = (await call(app, "/drafts", undefined, admin)).body.drafts[0];
    assert.equal(draft.id, created.body.id);
    const updated = await call(
      app,
      "/drafts/" + draft.id,
      { ...configuration, name: "Updated evaluation", version: 1 },
      admin,
    );
    assert.equal(updated.status, 200);
    assert.equal(updated.body.version, 2);
    assert.equal(
      (
        await call(
          app,
          "/drafts/" + draft.id,
          { ...configuration, version: 1 },
          admin,
        )
      ).status,
      409,
    );
    assert.equal(
      (
        await call(
          app,
          "/drafts/" + draft.id + "/archive",
          { version: 1 },
          admin,
        )
      ).status,
      409,
    );
    const live = await call(
      app,
      "/drafts",
      { ...configuration, mode: "ollama", model: "offline-model:latest" },
      admin,
    );
    assert.equal(live.status, 201);
    const unconsented = await call(
      app,
      "/runs",
      {
        draftId: live.body.id,
        draftVersion: 1,
        requestKey: "fresh-consent-required",
      },
      admin,
    );
    assert.equal(unconsented.status, 400);
    assert.match(unconsented.body.error, /consent/);
    assert.equal(
      (
        await call(
          app,
          "/drafts/" + live.body.id + "/archive",
          { version: 1 },
          admin,
        )
      ).status,
      200,
    );
    const launch = {
      draftId: draft.id,
      draftVersion: 2,
      name: "Override attempt",
      requestKey: "draft-launch-unique",
    };
    const run = await call(app, "/runs", launch, admin);
    assert.equal(run.status, 201);
    assert.equal(run.body.name, "Updated evaluation");
    assert.equal(
      (await call(app, "/runs", launch, admin)).body.id,
      run.body.id,
    );
    assert.equal(
      (
        await call(
          app,
          "/runs",
          { ...launch, requestKey: "second-launch-key" },
          admin,
        )
      ).status,
      404,
    );
    assert.equal(
      (await call(app, "/drafts", undefined, admin)).body.drafts.length,
      0,
    );
    assert.equal(
      (await call(app, "/runs/" + run.body.id + "/report", undefined, admin))
        .status,
      400,
    );
    await call(app, "/runs/" + run.body.id + "/cancel", {}, admin);
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("draft ownership, workspace and organization boundaries apply to list, edit, archive and launch", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bayora-draft-scope-"));
  const app = createApplication(readConfig({ BAYORA_DB: join(dir, "app.db") }));
  try {
    const { admin, configuration } = await setup(app);
    for (const [email, role] of [
      ["analyst@phase6.test", "Analyst"],
      ["auditor@phase6.test", "Auditor"],
    ]) {
      assert.equal(
        (
          await call(
            app,
            "/members",
            { email, password, role, workspaces: [configuration.workspaceId] },
            admin,
          )
        ).status,
        201,
      );
    }
    const analyst = (
      await call(app, "/login", { email: "analyst@phase6.test", password })
    ).client;
    const auditor = (
      await call(app, "/login", { email: "auditor@phase6.test", password })
    ).client;
    const draft = (await call(app, "/drafts", configuration, admin)).body;
    assert.deepEqual(
      (await call(app, "/drafts", undefined, analyst)).body.drafts,
      [],
    );
    assert.equal(
      (
        await call(
          app,
          "/drafts/" + draft.id,
          { ...configuration, version: 1 },
          analyst,
        )
      ).status,
      404,
    );
    assert.equal(
      (
        await call(
          app,
          "/runs",
          {
            draftId: draft.id,
            draftVersion: 1,
            requestKey: "stolen-draft-launch",
          },
          analyst,
        )
      ).status,
      404,
    );
    assert.equal(
      (await call(app, "/drafts", configuration, auditor)).status,
      403,
    );
    assert.equal(
      (await call(app, "/state", undefined, auditor)).body.drafts.length,
      0,
    );
    const org = (
      await call(app, "/organizations", { name: "Another organization" }, admin)
    ).body;
    const other = (
      await call(
        app,
        "/organizations/switch",
        { organizationId: org.id },
        admin,
      )
    ).client;
    assert.deepEqual(
      (await call(app, "/drafts", undefined, other)).body.drafts,
      [],
    );
    assert.equal(
      (
        await call(
          app,
          "/drafts/" + draft.id + "/archive",
          { version: 1 },
          other,
        )
      ).status,
      404,
    );
    assert.equal(
      (await call(app, "/drafts", configuration, other)).status,
      404,
    );
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("cloning preserves source version IDs and report endpoints expose only finalized redacted outcomes", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bayora-report-"));
  const app = createApplication(readConfig({ BAYORA_DB: join(dir, "app.db") }));
  try {
    const { admin, configuration } = await setup(app);
    const original = (
      await call(
        app,
        "/runs",
        { ...configuration, requestKey: "source-campaign-key" },
        admin,
      )
    ).body;
    let detail;
    for (let i = 0; i < 100; i++) {
      detail = (await call(app, "/runs/" + original.id, undefined, admin)).body;
      if (detail.status === "COMPLETED") break;
      await delay(100);
    }
    assert.equal(detail.status, "COMPLETED");
    const clone = await call(
      app,
      "/runs/" + original.id + "/configuration",
      undefined,
      admin,
    );
    assert.equal(clone.status, 200);
    assert.equal(clone.body.parentId, original.id);
    assert.equal(clone.body.datasetId, configuration.datasetId);
    assert.equal(clone.body.policyId, configuration.policyId);
    assert.equal(clone.body.localConsent, undefined);
    assert.ok(!JSON.stringify(clone.body).includes("rules"));
    const copied = (
      await call(
        app,
        "/runs",
        { ...clone.body, requestKey: "cloned-campaign-key" },
        admin,
      )
    ).body;
    assert.notEqual(copied.id, original.id);
    assert.equal(copied.parentId, original.id);
    await call(app, "/runs/" + copied.id + "/cancel", {}, admin);
    const pack = (
      await call(app, "/runs/" + copied.id + "/export", undefined, admin)
    ).body;
    assert.equal(pack.manifest.lineage.parentId, original.id);
    const report = await call(
      app,
      "/runs/" + original.id + "/report",
      undefined,
      admin,
    );
    assert.equal(report.status, 200);
    assert.equal(report.body.verification.valid, true);
    assert.match(report.body.html, /DEMO_ONLY/);
    assert.match(report.body.html, /not itself digitally signed/);
    assert.match(report.body.html, /10\/16/);
    assert.ok(!report.body.html.includes("Rayleigh scattering"));
    assert.ok(!report.body.csv.includes("output"));
    assert.equal(report.body.csv.trim().split("\r\n").length, 21);
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("report rendering escapes HTML, neutralizes spreadsheet formulas and excludes private fields", () => {
  const run = {
    id: "r",
    name: '<img src=x onerror="alert(1)">',
    status: "COMPLETED",
  };
  const pack = {
    verdict: "UNVERIFIED",
    manifest: { model: "local", policy: { name: "Policy", version: 1 } },
    results: [
      {
        id: "=HYPERLINK(secret)",
        category: "  +cmd",
        baseline: "Violation",
        defended: "Safe",
        output: "PRIVATE RESPONSE",
        prompt: "PRIVATE PROMPT",
      },
      { id: "control", benign: true, baseline: "Safe", defended: "Safe" },
      { id: "failure", baseline: "Transport error", defended: "Safe" },
    ],
    attempts: [],
    attestation: { payload: { keyId: "trusted-key-id" } },
    anchor: "anchor",
    manifestHash: "manifest",
  };
  const report = createReport(run, pack, { valid: true, trusted: true });
  assert.ok(!report.html.includes("<img"));
  assert.match(report.html, /&lt;img/);
  assert.match(report.html, /trusted-key-id/);
  assert.match(report.html, /1\/1 \(100.0%\)/);
  assert.match(report.html, /0\/1 \(0.0%\)/);
  assert.match(report.csv, /"'=HYPERLINK/);
  assert.match(report.csv, /"'  \+cmd/);
  assert.ok(!JSON.stringify(report).includes("PRIVATE"));
  const empty = createReport(run, { ...pack, results: [] }, { valid: true });
  assert.match(empty.html, /Unassessed: no comparable/);
  assert.ok(!empty.html.includes("NaN"));
});
