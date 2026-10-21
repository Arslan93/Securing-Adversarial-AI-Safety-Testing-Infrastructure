import { createPilotStore } from "./pilot-store.mjs";
import { createQueue } from "./execution/queue.mjs";
import { createIdentity } from "./identity.mjs";
import { createAccess } from "./access.mjs";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, chmodSync } from "node:fs";
import { dirname } from "node:path";
import { seedDataset } from "./datasets.mjs";
import { chainEvent, digest } from "./core.mjs";
export function createStore(path) {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  if (path !== ":memory:") chmodSync(path, 0o600);
  db.exec(
    "PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY, json TEXT NOT NULL)",
  );
  const seed = {
    workspaces: [
      {
        id: "ws-research",
        name: "Research workspace",
        purpose: "Controlled synthetic model evaluation",
        ttl: 30,
        classification: "Synthetic",
        network: "Deny all egress",
      },
    ],
    policies: [
      {
        id: "pol-1",
        version: 1,
        name: "Default safety policy",
        rules: [
          "Block instruction overrides",
          "Protect private context",
          "Reject role impersonation",
        ],
        createdAt: new Date().toISOString(),
      },
    ],
    runs: [],
    events: [],
  };
  const state = JSON.parse(
    db.prepare("SELECT json FROM state WHERE id=1").get()?.json ||
      JSON.stringify(seed),
  );
  state.reviews ??= [];
  state.datasets ??= [seedDataset()];
  db.exec(`CREATE TABLE IF NOT EXISTS audit_entries(stream TEXT NOT NULL,sequence INTEGER NOT NULL,hash TEXT NOT NULL,json TEXT NOT NULL,PRIMARY KEY(stream,sequence));
    CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit_entries BEGIN SELECT RAISE(ABORT,'audit entries are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit_entries BEGIN SELECT RAISE(ABORT,'audit entries are append-only'); END;`);
  function streams() {
    return [
      ["legacy", state.events || []],
      ...Object.entries(state.scopedEvents || {}).map(([id, events]) => [
        "org:" + id,
        events,
      ]),
      ...Object.entries(state.runEvents || {}).map(([id, events]) => [
        "run:" + id,
        events,
      ]),
    ];
  }
  const queue = createQueue(db);
  const save = () => {
    db.exec("BEGIN IMMEDIATE");
    try {
      for (const run of state.runs)
        queue.reserve(run, run.execution?.reservationLimit || 2);
      for (const [stream, events] of streams()) {
        let previous = "0".repeat(64);
        for (const event of events) {
          const { hash, ...unsigned } = event;
          if (event.previousHash !== previous || digest(unsigned) !== hash)
            throw Error("Audit event content failed its integrity check.");
          previous = hash;
        }

        const existing = db
          .prepare(
            "SELECT sequence,hash FROM audit_entries WHERE stream=? ORDER BY sequence",
          )
          .all(stream);
        if (
          existing.length > events.length ||
          existing.some(
            (entry, index) =>
              entry.sequence !== index + 1 ||
              events[index]?.hash !== entry.hash,
          )
        )
          throw Error("Persisted audit history was changed or truncated.");
        for (let index = existing.length; index < events.length; index++)
          db.prepare("INSERT INTO audit_entries VALUES(?,?,?,?)").run(
            stream,
            events[index].sequence,
            events[index].hash,
            JSON.stringify(events[index]),
          );
      }
      const known = new Set(streams().map(([name]) => name));
      if (
        db
          .prepare("SELECT DISTINCT stream FROM audit_entries")
          .all()
          .some((row) => !known.has(row.stream))
      )
        throw Error("An audit stream is missing from persisted state.");
      db.prepare("INSERT OR REPLACE INTO state VALUES(1,?)").run(
        JSON.stringify(state),
      );
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  };
  const identity = createIdentity(db);
  const pilot = createPilotStore(db);
  const access = createAccess(state, save);
  state.scopedEvents ??= {};
  state.runEvents ??= {};
  const audit = (type, data) => {
    const subject = access.current();
    const run = data.runId && state.runs.find((r) => r.id === data.runId);
    const orgId = run?.orgId || subject?.orgId;
    const eventData = {
      ...data,
      ...(subject ? { actorId: subject.userId } : {}),
    };
    if (orgId) {
      const events = (state.scopedEvents[orgId] ??= []);
      events.push(chainEvent(events, type, eventData));
      if (run && (type === "run.created" || state.runEvents[run.id])) {
        const events = (state.runEvents[run.id] ??= []);
        events.push(chainEvent(events, type, eventData));
      }
    } else state.events.push(chainEvent(state.events, type, data));
    save();
  };
  if (!state.events.length)
    audit("workspace.created", {
      workspace: "ws-research",
      mode: "synthetic-demo",
    });

  save();
  return {
    queue,
    pilot,
    state: access.state,
    allState: state,
    identity,
    access,
    save,
    audit,
    ready: () => db.prepare("SELECT 1").get()["1"] === 1,
    close: () => db.close(),
  };
}
