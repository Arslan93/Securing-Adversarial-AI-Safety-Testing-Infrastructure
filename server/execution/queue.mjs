import { randomUUID } from "node:crypto";
export function createQueue(db) {
  db.exec(`PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS execution_jobs(
      run_id TEXT PRIMARY KEY, org_id TEXT NOT NULL, user_id TEXT NOT NULL, workspace_id TEXT NOT NULL,
      request_key TEXT NOT NULL, state TEXT NOT NULL, deadline INTEGER NOT NULL, max_calls INTEGER NOT NULL,
      token TEXT, worker_pid INTEGER, lease_until INTEGER, heartbeat INTEGER, created INTEGER NOT NULL,
      UNIQUE(org_id,user_id,workspace_id,request_key));`);
  return {
    reserve(run, limit) {
      if (
        !run.execution ||
        db.prepare("SELECT 1 FROM execution_jobs WHERE run_id=?").get(run.id)
      )
        return;
      if (
        db
          .prepare(
            "SELECT count(*) n FROM execution_jobs WHERE state IN ('RESERVED','READY','RUNNING','CLEANUP')",
          )
          .get().n >= limit
      )
        throw Error(
          "Concurrency limit reached: durable reservations are full.",
        );
      db.prepare(
        "INSERT INTO execution_jobs(run_id,org_id,user_id,workspace_id,request_key,state,deadline,max_calls,created) VALUES(?,?,?,?,?,?,?,?,?)",
      ).run(
        run.id,
        run.orgId,
        run.ownerId,
        run.workspaceId,
        run.requestKey,
        "RESERVED",
        run.execution.deadline,
        run.execution.maxCalls,
        Date.now(),
      );
    },
    get: (id) =>
      db.prepare("SELECT * FROM execution_jobs WHERE run_id=?").get(id),
    all: () =>
      db.prepare("SELECT * FROM execution_jobs ORDER BY created,run_id").all(),
    ready(id) {
      db.prepare(
        "UPDATE execution_jobs SET state='READY' WHERE run_id=? AND state='RESERVED'",
      ).run(id);
    },
    claim(id, leaseMs) {
      const token = randomUUID();
      const result = db
        .prepare(
          "UPDATE execution_jobs SET state='RUNNING',token=?,lease_until=?,heartbeat=? WHERE run_id=? AND state='READY' AND deadline>?",
        )
        .run(token, Date.now() + leaseMs, Date.now(), id, Date.now());
      return result.changes ? token : null;
    },
    heartbeat(id, token, pid, leaseMs) {
      return (
        db
          .prepare(
            "UPDATE execution_jobs SET heartbeat=?,lease_until=?,worker_pid=? WHERE run_id=? AND token=? AND state='RUNNING' AND lease_until>=?",
          )
          .run(Date.now(), Date.now() + leaseMs, pid, id, token, Date.now())
          .changes === 1
      );
    },
    finish(id, state = "DONE") {
      db.prepare(
        "UPDATE execution_jobs SET state=?,token=NULL,worker_pid=NULL,lease_until=NULL WHERE run_id=?",
      ).run(state, id);
    },
  };
}
