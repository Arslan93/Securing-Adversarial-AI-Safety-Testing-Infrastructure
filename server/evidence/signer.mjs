import http from "node:http";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, mkdirSync, chmodSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { createPrivateKey, timingSafeEqual } from "node:crypto";
import { attest, sha, keyId } from "./signatures.mjs";
import { digest, verifyEvidence } from "../core.mjs";
import { readBody, json } from "../http.mjs";
export function createSigner({ dbPath, keyPath, tokenPath }) {
  const key = createPrivateKey(readFileSync(keyPath));
  if (key.asymmetricKeyType !== "ed25519")
    throw Error("Signer requires an Ed25519 key.");
  const token = readFileSync(tokenPath, "utf8").trim();
  if (!/^[a-f0-9]{64}$/.test(token))
    throw Error("Signer token must be 32 random bytes in hex.");
  const tokenHash = sha(token);
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  chmodSync(dbPath, 0o600);
  db.exec(`PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS registrations(run_id TEXT PRIMARY KEY, org_id TEXT NOT NULL, workspace_id TEXT NOT NULL, manifest_hash TEXT NOT NULL, start_hash TEXT NOT NULL, registered_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS checkpoints(id INTEGER PRIMARY KEY AUTOINCREMENT,run_id TEXT NOT NULL,sequence INTEGER NOT NULL,anchor TEXT NOT NULL,evidence_hash TEXT NOT NULL,envelope TEXT NOT NULL,checkpoint_hash TEXT NOT NULL UNIQUE);
  CREATE TRIGGER IF NOT EXISTS registration_no_update BEFORE UPDATE ON registrations BEGIN SELECT RAISE(ABORT,'registrations are immutable'); END;
  CREATE TRIGGER IF NOT EXISTS registration_no_delete BEFORE DELETE ON registrations BEGIN SELECT RAISE(ABORT,'registrations are immutable'); END;
  CREATE TRIGGER IF NOT EXISTS checkpoint_no_update BEFORE UPDATE ON checkpoints BEGIN SELECT RAISE(ABORT,'checkpoints are append-only'); END;
  CREATE TRIGGER IF NOT EXISTS checkpoint_no_delete BEFORE DELETE ON checkpoints BEGIN SELECT RAISE(ABORT,'checkpoints are append-only'); END;`);
  function register({ runId, orgId, workspaceId, manifestHash, event }) {
    if (
      ![runId, orgId, workspaceId, manifestHash].every(
        (v) => typeof v === "string" && v.length > 0 && v.length <= 150,
      ) ||
      !event
    )
      throw Error("Invalid run registration.");
    const { hash, ...unsigned } = event;
    if (
      event.sequence !== 1 ||
      event.previousHash !== "0".repeat(64) ||
      event.type !== "run.created" ||
      event.data?.runId !== runId ||
      event.data.manifestHash !== manifestHash ||
      digest(unsigned) !== hash
    )
      throw Error("Invalid initial run event.");
    const old = db
      .prepare("SELECT * FROM registrations WHERE run_id=?")
      .get(runId);
    if (old) {
      if (
        old.org_id !== orgId ||
        old.workspace_id !== workspaceId ||
        old.manifest_hash !== manifestHash ||
        old.start_hash !== hash
      )
        throw Error("Run registration conflicts with the existing checkpoint.");
      return { registered: true };
    }
    db.prepare("INSERT INTO registrations VALUES(?,?,?,?,?,?)").run(
      runId,
      orgId,
      workspaceId,
      manifestHash,
      hash,
      new Date().toISOString(),
    );
    return { registered: true };
  }
  function seal(pack) {
    verifyEvidence(pack);
    const registration = db
      .prepare("SELECT * FROM registrations WHERE run_id=?")
      .get(pack.runId);
    if (
      !registration ||
      pack.manifestHash !== registration.manifest_hash ||
      pack.events[0].hash !== registration.start_hash
    )
      throw Error("Run was not registered with this signer before execution.");
    const last = db
      .prepare(
        "SELECT * FROM checkpoints WHERE run_id=? ORDER BY id DESC LIMIT 1",
      )
      .get(pack.runId);
    if (
      last &&
      (pack.events.length < last.sequence ||
        pack.events[last.sequence - 1]?.hash !== last.anchor)
    )
      throw Error("Signer refuses a rollback or fork of a sealed run.");
    const previous =
      db
        .prepare(
          "SELECT checkpoint_hash FROM checkpoints ORDER BY id DESC LIMIT 1",
        )
        .get()?.checkpoint_hash || null;
    const envelope = attest(pack, key, {
      orgId: registration.org_id,
      workspaceId: registration.workspace_id,
      previousCheckpoint: previous,
    });
    db.prepare(
      "INSERT INTO checkpoints(run_id,sequence,anchor,evidence_hash,envelope,checkpoint_hash) VALUES(?,?,?,?,?,?)",
    ).run(
      pack.runId,
      pack.events.length,
      pack.anchor,
      envelope.payload.evidenceHash,
      JSON.stringify(envelope),
      sha(envelope),
    );
    return envelope;
  }
  const server = http.createServer(async (req, res) => {
    try {
      const supplied = sha(
        req.headers.authorization?.replace(/^Bearer /, "") || "",
      );
      if (!timingSafeEqual(Buffer.from(supplied), Buffer.from(tokenHash)))
        return json(res, 401, {
          error: "Signer client authentication failed.",
        });
      if (req.method === "GET" && req.url === "/status")
        return json(res, 200, { ready: true, keyId: keyId(key) });
      const body = await readBody(req);
      if (req.method === "POST" && req.url === "/register")
        return json(res, 200, register(body));
      if (req.method === "POST" && req.url === "/sign")
        return json(res, 200, { attestation: seal(body) });
      return json(res, 404, { error: "Signer operation not found." });
    } catch (e) {
      return json(res, 400, { error: e.message });
    }
  });
  return {
    server,
    register,
    seal,
    keyId: keyId(key),
    async listen(socket, mode = 0o600) {
      if (![0o600, 0o660].includes(mode))
        throw Error("Signer socket mode must be 0600 or 0660.");
      if (existsSync(socket))
        throw Error(
          "Signer socket already exists. Check for a running signer before removing a stale socket.",
        );
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(socket, resolve);
      });
      chmodSync(socket, mode);
    },
    async close() {
      if (server.listening)
        await new Promise((resolve) => server.close(resolve));
      db.close();
    },
  };
}
