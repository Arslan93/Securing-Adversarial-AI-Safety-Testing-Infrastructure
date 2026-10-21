import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, randomBytes, createHash } from "node:crypto";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Readable } from "node:stream";
import { createSigner } from "./evidence/signer.mjs";
import { createEvidenceClient } from "./evidence/client.mjs";
import { verifyPackage } from "./evidence/signatures.mjs";
import { chainEvent, digest } from "./core.mjs";
import { createStore } from "./store.mjs";
import { createApplication } from "./app.mjs";
import { readConfig } from "./config.mjs";
import { totp, base32, acceptedStep } from "./mfa.mjs";
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
function pack() {
  const manifest = {
      workspace: { id: "ws" },
      policy: { id: "p", digest: "x" },
      mode: "synthetic-demo",
    },
    events = [];
  events.push(
    chainEvent(events, "run.created", {
      runId: "r",
      manifestHash: digest(manifest),
    }),
  );
  events.push(
    chainEvent(events, "run.completed", {
      runId: "r",
      verdict: "DEMO_ONLY",
      resultsHash: digest([]),
      attemptsHash: digest([]),
    }),
  );
  return {
    format: "bayora-evidence-v2",
    runId: "r",
    manifest,
    manifestHash: digest(manifest),
    events,
    anchor: events.at(-1).hash,
    results: [],
    resultsHash: digest([]),
    attempts: [],
    attemptsHash: digest([]),
    verdict: "DEMO_ONLY",
  };
}
function register(s, p) {
  s.register({
    runId: p.runId,
    orgId: "org",
    workspaceId: "ws",
    manifestHash: p.manifestHash,
    event: p.events[0],
  });
}
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
const password = "Phase-five-integration-password";
test("TOTP matches RFC 6238 vectors and refuses reuse or expired codes", () => {
  const secret = base32(Buffer.from("12345678901234567890"));
  assert.equal(totp(secret, 1, 8), "94287082");
  assert.equal(totp(secret, Math.floor(1111111109 / 30), 8), "07081804");
  const now = 59000,
    code = totp(secret, 1);
  assert.equal(acceptedStep(secret, code, now), 1);
  assert.equal(acceptedStep(secret, code, now, 1), null);
  assert.equal(acceptedStep(secret, code, now + 120000), null);
});
test("signatures require independent pinned keys and reject edits, unsigned evidence and unregistered runs", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bayora-sign-")),
    options = keys(dir),
    signer = createSigner(options),
    publicKey = readFileSync(join(dir, "public.pem"), "utf8");
  try {
    const p = pack();
    assert.throws(() => signer.seal(p), /registered/);
    register(signer, p);
    const signed = { ...p, attestation: signer.seal(p) };
    assert.equal(
      verifyPackage(signed, {
        trustedKeys: [publicKey],
        requireSignature: true,
      }).trusted,
      true,
    );
    assert.equal(verifyPackage(signed).trusted, false);
    assert.throws(
      () =>
        verifyPackage(p, { trustedKeys: [publicKey], requireSignature: true }),
      /signature/,
    );
    const wrong = generateKeyPairSync("ed25519").publicKey.export({
      type: "spki",
      format: "pem",
    });
    assert.throws(
      () =>
        verifyPackage(signed, { trustedKeys: [wrong], requireSignature: true }),
      /trusted key/,
    );
    const edited = structuredClone(signed);
    edited.qualification = "altered package";
    assert.throws(
      () => verifyPackage(edited, { trustedKeys: [publicKey] }),
      /does not match/,
    );
    const forged = structuredClone(signed);
    forged.attestation.signature = "A".repeat(86);
    assert.throws(
      () => verifyPackage(forged, { trustedKeys: [publicKey] }),
      /verification failed/,
    );
    const later = structuredClone(p);
    later.events.push(
      chainEvent(later.events, "finding.reviewed", { runId: "r" }),
    );
    later.anchor = later.events.at(-1).hash;
    signer.seal(later);
    assert.throws(() => signer.seal(p), /rollback or fork/);
    const db = new DatabaseSync(options.dbPath);
    assert.throws(() => db.exec("DELETE FROM checkpoints"), /append-only/);
    assert.throws(
      () =>
        db.prepare("UPDATE registrations SET manifest_hash=?").run("changed"),
      /immutable/,
    );
    db.close();
  } finally {
    await signer.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("append-only audit ledger detects state rollback and refuses update/delete", () => {
  const dir = mkdtempSync(join(tmpdir(), "bayora-audit-")),
    path = join(dir, "app.db");
  let store = createStore(path);
  store.audit("test.event", { value: "unchanged" });
  store.close();
  const db = new DatabaseSync(path);
  assert.throws(() => db.exec("DELETE FROM audit_entries"), /append-only/);
  assert.throws(
    () => db.prepare("UPDATE audit_entries SET hash=?").run("changed"),
    /append-only/,
  );
  const row = JSON.parse(
    db.prepare("SELECT json FROM state WHERE id=1").get().json,
  );
  row.events.pop();
  db.prepare("UPDATE state SET json=? WHERE id=1").run(JSON.stringify(row));
  db.close();
  assert.throws(() => createStore(path), /changed or truncated/);
  rmSync(dir, { recursive: true, force: true });
});
test("real signer IPC registers runs before execution and produces trusted API exports", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bayora-ipc-")),
    options = keys(dir),
    signer = createSigner(options),
    socket = join(dir, "signer.sock");
  await signer.listen(socket);
  const config = {
      ...readConfig({ BAYORA_DB: join(dir, "app.db") }),
      signerSocket: socket,
      signerTokenPath: options.tokenPath,
      evidencePublicKey: join(dir, "public.pem"),
      requireSignedEvidence: true,
      syntheticStepMs: 1,
    },
    app = createApplication(config);
  try {
    const admin = (
        await call(app, "/setup", { email: "owner@phase5.test", password })
      ).client,
      s = (await call(app, "/state", undefined, admin)).body;
    const created = await call(
      app,
      "/runs",
      {
        name: "Signed fixture",
        workspaceId: s.workspaces[0].id,
        policyId: s.policies[0].id,
        requestKey: "signed-fixture",
      },
      admin,
    );
    assert.equal(created.status, 201);
    await new Promise((resolve) => setTimeout(resolve, 100));
    const exported = await call(
      app,
      "/runs/" + created.body.id + "/export",
      undefined,
      admin,
    );
    assert.equal(exported.status, 200);
    assert.ok(exported.body.attestation);
    assert.equal(
      (await call(app, "/verify", exported.body, admin)).body.trusted,
      true,
    );
    await signer.close();
    const failed = await call(
      app,
      "/runs",
      {
        name: "Signer unavailable",
        workspaceId: s.workspaces[0].id,
        policyId: s.policies[0].id,
        requestKey: "failed-signing-run",
      },
      admin,
    );
    assert.equal(failed.status, 503);
    const details = await call(
      app,
      "/runs/" + failed.body.runId,
      undefined,
      admin,
    );
    assert.equal(details.body.status, "FAILED");
    assert.equal(details.body.attempts.length, 0);
  } finally {
    await app.close();
    if (signer.server.listening) await signer.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("MFA enrollment encrypts the secret, rotates sessions and consumes recovery codes once", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bayora-mfa-")),
    path = join(dir, "app.db"),
    app = createApplication(readConfig({ BAYORA_DB: path }));
  try {
    const initial = await call(app, "/setup", {
        email: "mfa@phase5.test",
        password,
      }),
      admin = initial.client;
    const enrollment = await call(
      app,
      "/account/mfa/enroll",
      { password },
      admin,
    );
    assert.equal(enrollment.status, 200);
    const secret = enrollment.body.secret,
      code = totp(secret, Math.floor(Date.now() / 30000));
    const confirmed = await call(app, "/account/mfa/confirm", { code }, admin);
    assert.equal(confirmed.status, 200);
    assert.equal(confirmed.body.recoveryCodes.length, 10);
    assert.equal((await call(app, "/state", undefined, admin)).status, 401);
    assert.equal(
      (await call(app, "/state", undefined, confirmed.client)).status,
      200,
    );
    const db = new DatabaseSync(path);
    assert.ok(
      !db
        .prepare("SELECT secret FROM user_factors")
        .get()
        .secret.includes(secret),
    );
    db.close();
    const login = await call(app, "/login", {
      email: "mfa@phase5.test",
      password,
    });
    assert.equal(login.body.mfaRequired, true);
    assert.equal(login.client.cookie, undefined);
    assert.equal(
      (await call(app, "/login/mfa", { challenge: login.body.challenge, code }))
        .status,
      401,
    );
    const recovery = confirmed.body.recoveryCodes[0],
      verified = await call(app, "/login/mfa", {
        challenge: login.body.challenge,
        code: recovery,
      });
    assert.equal(verified.status, 200);
    assert.equal(
      (
        await call(app, "/login/mfa", {
          challenge: login.body.challenge,
          code: recovery,
        })
      ).status,
      401,
    );
    const next = await call(app, "/login", {
      email: "mfa@phase5.test",
      password,
    });
    assert.equal(
      (
        await call(app, "/login/mfa", {
          challenge: next.body.challenge,
          code: recovery,
        })
      ).status,
      401,
    );
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("invitations bind email, expiry, current inviter authority and single use; grants require recorded decisions", async () => {
  const app = createApplication(readConfig({ BAYORA_DB: ":memory:" }));
  try {
    const owner = (
      await call(app, "/setup", { email: "owner@collab.test", password })
    ).client;
    const s = (await call(app, "/state", undefined, owner)).body,
      ws = s.workspaces[0].id;
    const invite = await call(
      app,
      "/invitations",
      { email: "red@collab.test", role: "Red", workspaces: [ws], hours: 1 },
      owner,
    );
    assert.equal(invite.status, 201, JSON.stringify(invite.body));
    const invited = await call(app, "/invitations/register", {
      token: invite.body.token,
      email: "red@collab.test",
      password,
      name: "Red",
    });
    assert.equal(invited.status, 200);
    assert.equal(
      (
        await call(app, "/invitations/register", {
          token: invite.body.token,
          email: "red@collab.test",
          password,
        })
      ).status,
      404,
    );
    const dataset = await call(
      app,
      "/datasets",
      {
        name: "Owner-private",
        workspaceId: ws,
        cases: [
          {
            id: "x",
            name: "x",
            category: "Data privacy",
            prompt: "private",
            benign: false,
          },
        ],
      },
      owner,
    );
    assert.equal(
      (
        await call(
          app,
          "/datasets/" + dataset.body.id,
          undefined,
          invited.client,
        )
      ).status,
      403,
    );
    const request = await call(
      app,
      "/access-requests",
      { resourceId: dataset.body.id, reason: "Research access needed" },
      invited.client,
    );
    assert.equal(request.status, 201);
    const decision = await call(
      app,
      "/access-requests/" + request.body.id + "/decide",
      {
        decision: "APPROVE",
        minutes: 1,
        reason: "Approved for this evaluation",
      },
      owner,
    );
    assert.equal(decision.status, 200);
    assert.equal(
      (
        await call(
          app,
          "/datasets/" + dataset.body.id,
          undefined,
          invited.client,
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await call(
          app,
          "/access-requests/" + request.body.id + "/decide",
          { decision: "DENY", reason: "Replay must fail" },
          owner,
        )
      ).status,
      400,
    );
    const bad = await call(
      app,
      "/invitations",
      { email: "other@collab.test", role: "Red", workspaces: [ws], hours: 1 },
      owner,
    );
    assert.equal(
      (
        await call(app, "/invitations/register", {
          token: bad.body.token,
          email: "wrong@collab.test",
          password,
        })
      ).status,
      404,
    );
    const org = await call(
      app,
      "/organizations",
      { name: "Second organization" },
      owner,
    );
    const second = (
      await call(
        app,
        "/organizations/switch",
        { organizationId: org.body.id },
        owner,
      )
    ).client;
    const spaces = (await call(app, "/state", undefined, second)).body
      .workspaces;
    const existingInvite = await call(
      app,
      "/invitations",
      {
        email: "red@collab.test",
        role: "Auditor",
        workspaces: [spaces[0].id],
        hours: 1,
      },
      second,
    );
    assert.equal(
      (
        await call(
          app,
          "/invitations/accept",
          { token: existingInvite.body.token },
          invited.client,
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await call(
          app,
          "/invitations/accept",
          { token: existingInvite.body.token },
          invited.client,
        )
      ).status,
      404,
    );
    const switched = (
      await call(
        app,
        "/organizations/switch",
        { organizationId: org.body.id },
        invited.client,
      )
    ).client;
    const scoped = (await call(app, "/state", undefined, switched)).body;
    assert.equal(scoped.role, "Auditor");
    assert.ok(!scoped.datasets.some((d) => d.id === dataset.body.id));
    assert.equal((await call(app, "/cases", undefined, switched)).status, 403);
  } finally {
    await app.close();
  }
});
