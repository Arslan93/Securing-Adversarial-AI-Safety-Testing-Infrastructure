import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createApplication } from "./app.mjs";
import { readConfig } from "./config.mjs";
import { createStore } from "./store.mjs";
import { chainEvent } from "./core.mjs";
const password = "Only-for-tests-password-42";
const temp = mkdtempSync(join(tmpdir(), "bayora-phase3-"));
let app;
const clients = {};
async function call(path, body, client = {}, extra = {}) {
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
      ...extra,
    },
  });
  return new Promise((resolve) => {
    const headers = {};
    const res = {
      setHeader(k, v) {
        headers[k.toLowerCase()] = v;
      },
      writeHead(status) {
        this.status = status;
      },
      end(raw) {
        const body = JSON.parse(raw);
        const next = { ...client };
        if (headers["set-cookie"])
          next.cookie = headers["set-cookie"].split(";")[0];
        if (body.csrf) next.csrf = body.csrf;
        resolve({ status: this.status, body, client: next });
      },
    };
    app.server.emit("request", req, res);
  });
}
async function login(name) {
  const result = await call("/login", {
    email: name + "@test.example",
    password,
  });
  assert.equal(result.status, 200);
  return result.client;
}
before(async () => {
  app = createApplication({
    ...readConfig({ BAYORA_DB: join(temp, "app.db") }),
    syntheticStepMs: 2,
  });
  clients.admin = (
    await call("/setup", {
      email: "admin@test.example",
      password,
      name: "Owner",
      organization: "Organization One",
    })
  ).client;
  for (const [name, role] of [
    ["red", "Red"],
    ["other", "Red"],
    ["blue", "Blue"],
    ["analyst", "Analyst"],
    ["auditor", "Auditor"],
  ]) {
    const result = await call(
      "/members",
      {
        email: name + "@test.example",
        password,
        name,
        role,
        workspaces: ["ws-research"],
      },
      clients.admin,
    );
    assert.equal(result.status, 201);
    clients[name] = await login(name);
  }
});
after(async () => {
  await app.close();
  rmSync(temp, { recursive: true, force: true });
});
test("role-only sign-in is rejected; setup cannot be claimed twice; CSRF is enforced", async () => {
  assert.equal((await call("/login", { role: "Admin" })).status, 400);
  assert.equal(
    (await call("/setup", { email: "takeover@test.example", password })).status,
    409,
  );
  assert.equal(
    (
      await call(
        "/policies",
        { name: "csrf", rules: ["x"] },
        { cookie: clients.admin.cookie },
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await call("/policies", { name: "origin", rules: ["x"] }, clients.admin, {
        origin: "https://evil.example",
      })
    ).status,
    403,
  );
});
test("private artifact ownership, explicit grants, expiry, revocation and role ceilings", async () => {
  const published = await call(
    "/datasets",
    {
      name: "Private Red corpus",
      workspaceId: "ws-research",
      cases: [
        {
          id: "case-1",
          name: "private",
          category: "Data privacy",
          prompt: "PRIVATE test prompt",
          benign: false,
        },
      ],
    },
    clients.red,
  );
  assert.equal(published.status, 201);
  const id = published.body.id;
  assert.equal(
    (await call("/datasets/" + id, undefined, clients.other)).status,
    403,
  );
  assert.equal(
    (await call("/datasets/" + id, undefined, clients.admin)).status,
    403,
  );
  assert.equal(
    (
      await call(
        "/datasets",
        {
          name: "stolen clone",
          workspaceId: "ws-research",
          baseDatasetId: id,
          cases: [
            {
              id: "c",
              name: "c",
              category: "Data privacy",
              prompt: "x",
              benign: false,
            },
          ],
        },
        clients.other,
      )
    ).status,
    403,
  );
  const members = (await call("/members", undefined, clients.admin)).body
    .members;
  const other = members.find((m) => m.name === "other"),
    blue = members.find((m) => m.name === "blue");
  const g = await call(
    "/grants",
    { resourceId: id, userId: other.id, minutes: 1 },
    clients.red,
  );
  assert.equal(g.status, 201);
  assert.equal(
    (await call("/datasets/" + id, undefined, clients.other)).status,
    200,
  );
  assert.equal(
    (await call("/grants/" + g.body.id + "/revoke", {}, clients.red)).status,
    200,
  );
  assert.equal(
    (await call("/datasets/" + id, undefined, clients.other)).status,
    403,
  );
  assert.equal(
    (
      await call(
        "/grants",
        { resourceId: id, userId: blue.id, minutes: 1 },
        clients.red,
      )
    ).status,
    201,
  );
  assert.equal(
    (await call("/datasets/" + id, undefined, clients.blue)).status,
    403,
  );
  // A grant is checked against time on every request, without waiting for a cleanup job.
  const store = createStore(join(temp, "expiry.db"));
  store.allState.datasets.push({
    id: "private",
    orgId: "o",
    workspaceId: "w",
    ownerId: "owner",
  });
  store.allState.workspaces.push({ id: "w", orgId: "o" });
  store.allState.grants.push({
    orgId: "o",
    resourceId: "private",
    userId: "recipient",
    expires: Date.now() - 1,
  });
  store.access.enter(
    {
      orgId: "o",
      userId: "recipient",
      membership: { role: "Red", workspaces: ["w"] },
    },
    () =>
      assert.equal(
        store.access.raw(store.state.datasets.find((d) => d.id === "private")),
        false,
      ),
  );
  store.close();
});
test("membership updates revoke existing sessions and unassigned members have no workspace artifacts", async () => {
  const other = (
    await call("/members", undefined, clients.admin)
  ).body.members.find((m) => m.name === "other");
  assert.equal(
    (
      await call(
        "/members/" + other.id,
        { role: "Red", workspaces: [] },
        clients.admin,
      )
    ).status,
    200,
  );
  assert.equal((await call("/state", undefined, clients.other)).status, 401);
  clients.other = await login("other");
  const state = (await call("/state", undefined, clients.other)).body;
  assert.equal(state.workspaces.length, 0);
  assert.equal(state.datasets.length, 0);
  assert.equal(state.policies.length, 0);
  assert.equal((await call("/cases", undefined, clients.other)).status, 404);
  assert.equal(
    (
      await call(
        "/members/" +
          (await call("/members", undefined, clients.admin)).body.members.find(
            (m) => m.name === "Owner",
          ).id,
        { role: "Red", workspaces: [] },
        clients.admin,
      )
    ).status,
    400,
  );
});
test("cross-organization guessed IDs, comparisons, idempotency and exports stay scoped", async () => {
  const s = (await call("/state", undefined, clients.admin)).body;
  const input = {
    name: "First organization run",
    workspaceId: "ws-research",
    policyId: s.policies[0].id,
    requestKey: "same-key-across-orgs",
  };
  const first = await call("/runs", input, clients.admin);
  assert.equal(first.status, 201);
  await call("/runs/" + first.body.id + "/cancel", {}, clients.admin);
  const org = await call(
    "/organizations",
    { name: "Organization Two" },
    clients.admin,
  );
  assert.equal(org.status, 201);
  const switched = await call(
    "/organizations/switch",
    { organizationId: org.body.id },
    clients.admin,
  );
  clients.second = switched.client;
  clients.admin = await login("admin");
  const other = (await call("/state", undefined, clients.second)).body;
  assert.equal(other.workspaces.length, 1);
  assert.ok(!JSON.stringify(other).includes("First organization run"));
  for (const suffix of ["", "/export"])
    assert.equal(
      (await call("/runs/" + first.body.id + suffix, undefined, clients.second))
        .status,
      404,
    );
  assert.equal(
    (await call("/runs/" + first.body.id + "/cancel", {}, clients.second))
      .status,
    404,
  );
  assert.equal(
    (await call("/datasets/" + s.datasets[0].id, undefined, clients.second))
      .status,
    404,
  );
  assert.equal(
    (
      await call(
        "/compare?left=" + first.body.id + "&right=" + first.body.id,
        undefined,
        clients.second,
      )
    ).status,
    404,
  );
  assert.equal((await call("/runs", input, clients.second)).status, 404);
  const second = await call(
    "/runs",
    {
      ...input,
      name: "Second organization run",
      workspaceId: other.workspaces[0].id,
      policyId: other.policies[0].id,
      datasetId: other.datasets[0].id,
    },
    clients.second,
  );
  assert.equal(second.status, 201);
  assert.notEqual(second.body.id, first.body.id);
  assert.equal(
    (await call("/runs/" + first.body.id + "/cleanup", {}, clients.second))
      .status,
    404,
  );
  await call("/runs/" + second.body.id + "/cancel", {}, clients.second);
  const pack = (
    await call("/runs/" + second.body.id + "/export", undefined, clients.second)
  ).body;
  assert.ok(pack.events.every((e) => e.data.runId === second.body.id));
  assert.ok(!JSON.stringify(pack).includes(first.body.id));
  assert.equal((await call("/verify", pack, clients.second)).body.valid, true);
});
test("workspace allowlists prevent guessed run and dataset reads inside an organization", async () => {
  const ws = await call(
    "/workspaces",
    { name: "Admin only workspace", ttl: 10 },
    clients.admin,
  );
  assert.equal(ws.status, 201);
  const dataset = await call(
    "/datasets",
    {
      name: "Hidden workspace data",
      workspaceId: ws.body.id,
      cases: [
        {
          id: "x",
          name: "x",
          category: "Data privacy",
          prompt: "x",
          benign: false,
        },
      ],
    },
    clients.admin,
  );
  assert.equal(
    (await call("/datasets/" + dataset.body.id, undefined, clients.red)).status,
    404,
  );
  const s = (await call("/state", undefined, clients.red)).body;
  assert.ok(!s.workspaces.some((w) => w.id === ws.body.id));
  assert.ok(!s.datasets.some((d) => d.id === dataset.body.id));
});
test("sessions persist across restart; password changes invalidate every session", async () => {
  const old = await login("red");
  await app.close();
  app = createApplication({
    ...readConfig({ BAYORA_DB: join(temp, "app.db") }),
    syntheticStepMs: 2,
  });
  assert.equal(
    (await call("/session", undefined, old)).body.authenticated,
    true,
  );
  const change = await call(
    "/account/password",
    { currentPassword: password, password: "Changed-test-password-84" },
    old,
  );
  assert.equal(change.status, 200);
  assert.equal((await call("/state", undefined, clients.red)).status, 401);
  assert.equal(
    (await call("/login", { email: "red@test.example", password })).status,
    401,
  );
  assert.equal(
    (
      await call("/login", {
        email: "red@test.example",
        password: "Changed-test-password-84",
      })
    ).status,
    200,
  );
});
test("passwords and session bearer tokens are not stored as plaintext", () => {
  const db = new DatabaseSync(join(temp, "app.db"));
  const users = db.prepare("SELECT * FROM users").all(),
    sessions = db.prepare("SELECT * FROM sessions").all();
  assert.ok(
    users.every(
      (u) =>
        !u.password.includes(password) &&
        /^[a-f0-9]{32}:[a-f0-9]{128}$/.test(u.password),
    ),
  );
  assert.ok(
    sessions.every(
      (s) => !Object.values(clients).some((c) => c.cookie?.endsWith(s.token)),
    ),
  );
  db.close();
});
test("legacy state migration preserves event bytes and claims private artifact ownership", () => {
  const path = join(temp, "legacy.db"),
    db = new DatabaseSync(path),
    event = chainEvent([], "legacy.event", { runId: "old" });
  db.exec("CREATE TABLE state(id INTEGER PRIMARY KEY,json TEXT NOT NULL)");
  db.prepare("INSERT INTO state VALUES(1,?)").run(
    JSON.stringify({
      workspaces: [{ id: "old-ws" }],
      policies: [{ id: "old-policy" }],
      datasets: [{ id: "old-data", cases: [] }],
      runs: [],
      reviews: [],
      events: [event],
    }),
  );
  db.close();
  let store = createStore(path);
  store.access.stampLegacy("claimed-org", "owner");
  assert.deepEqual(store.allState.events, [event]);
  assert.equal(store.allState.datasets[0].ownerId, "owner");
  store.close();
  store = createStore(path);
  assert.deepEqual(store.allState.events, [event]);
  assert.equal(store.allState.workspaces[0].orgId, "claimed-org");
  store.close();
});

test("private policy grants also constrain model response visibility", async () => {
  const policy = await call(
    "/policies",
    {
      name: "Private Blue policy",
      workspaceId: "ws-research",
      rules: ["Private Blue defensive rule"],
    },
    clients.blue,
  );
  assert.equal(policy.status, 201);
  const created = await call(
    "/runs",
    {
      name: "Private policy response check",
      workspaceId: "ws-research",
      policyId: policy.body.id,
      requestKey: "private-policy-output",
    },
    clients.analyst,
  );
  assert.equal(created.status, 201);
  await new Promise((resolve) => setTimeout(resolve, 100));
  const before = (
    await call("/runs/" + created.body.id, undefined, clients.analyst)
  ).body;
  assert.equal(before.rawAccess, false);
  assert.ok(before.results.every((r) => !r.output && !r.baselineOutput));
  const analyst = (
    await call("/members", undefined, clients.admin)
  ).body.members.find((m) => m.name === "analyst");
  assert.equal(
    (
      await call(
        "/grants",
        { resourceId: policy.body.id, userId: analyst.id, minutes: 60 },
        clients.blue,
      )
    ).status,
    201,
  );
  assert.equal(
    (await call("/runs/" + created.body.id, undefined, clients.analyst)).body
      .rawAccess,
    true,
  );
  assert.equal(
    (await call("/runs/" + created.body.id, undefined, clients.blue)).body
      .rawAccess,
    false,
  );
});

test("repeated invalid credentials are throttled without issuing a session", async () => {
  for (let i = 0; i < 8; i++) {
    const failed = await call("/login", {
      email: "unknown@test.example",
      password,
    });
    assert.equal(failed.status, 401);
    assert.equal(failed.client.cookie, undefined);
  }
  assert.equal(
    (await call("/login", { email: "unknown@test.example", password })).status,
    429,
  );
});
