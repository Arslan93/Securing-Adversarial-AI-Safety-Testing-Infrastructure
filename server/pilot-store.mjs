import { randomUUID } from "node:crypto";
export function createPilotStore(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS model_approvals(id TEXT PRIMARY KEY,org_id TEXT NOT NULL,model TEXT NOT NULL,digest TEXT NOT NULL,reason TEXT NOT NULL,approved_by TEXT NOT NULL,created TEXT NOT NULL,revoked INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE IF NOT EXISTS pilot_controls(org_id TEXT PRIMARY KEY,paused INTEGER NOT NULL DEFAULT 0,reason TEXT NOT NULL,changed_by TEXT NOT NULL,changed_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS retention_holds(org_id TEXT NOT NULL,workspace_id TEXT NOT NULL,held INTEGER NOT NULL,reason TEXT NOT NULL,PRIMARY KEY(org_id,workspace_id));`);
  return {
    approvals: (org) =>
      db
        .prepare(
          "SELECT * FROM model_approvals WHERE org_id=? ORDER BY created DESC",
        )
        .all(org),
    approved: (org, model, digest) =>
      !!db
        .prepare(
          "SELECT 1 FROM model_approvals WHERE org_id=? AND model=? AND digest=? AND revoked=0",
        )
        .get(org, model, digest),
    approve(org, model, digest, reason, uid) {
      const id = randomUUID();
      db.prepare("INSERT INTO model_approvals VALUES(?,?,?,?,?,?,?,0)").run(
        id,
        org,
        model,
        digest,
        reason,
        uid,
        new Date().toISOString(),
      );
      return id;
    },
    revoke: (org, id) =>
      db
        .prepare("UPDATE model_approvals SET revoked=1 WHERE org_id=? AND id=?")
        .run(org, id).changes,
    control: (org) =>
      db.prepare("SELECT * FROM pilot_controls WHERE org_id=?").get(org) || {
        org_id: org,
        paused: 0,
      },
    pause(org, paused, reason, uid) {
      db.prepare("INSERT OR REPLACE INTO pilot_controls VALUES(?,?,?,?,?)").run(
        org,
        paused ? 1 : 0,
        reason,
        uid,
        new Date().toISOString(),
      );
    },
    hold: (org, ws) =>
      db
        .prepare(
          "SELECT * FROM retention_holds WHERE org_id=? AND workspace_id=?",
        )
        .get(org, ws),
    setHold(org, ws, held, reason) {
      db.prepare("INSERT OR REPLACE INTO retention_holds VALUES(?,?,?,?)").run(
        org,
        ws,
        held ? 1 : 0,
        reason,
      );
    },
  };
}
