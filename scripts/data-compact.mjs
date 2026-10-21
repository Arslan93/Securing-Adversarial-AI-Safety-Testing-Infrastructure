import { DatabaseSync } from "node:sqlite";
import { loadLocalEnv, storagePaths } from "../server/config.mjs";
import { acquireBrokerLock } from "../server/execution/lock.mjs";
loadLocalEnv();
const config = storagePaths();
if (config.dbPath === ":memory:")
  throw Error("Compaction requires a persistent database.");
const unlock = acquireBrokerLock(config.dbPath);
let db;
try {
  db = new DatabaseSync(config.dbPath);
  db.exec(
    "PRAGMA busy_timeout=5000; PRAGMA secure_delete=ON; PRAGMA wal_checkpoint(TRUNCATE); VACUUM; PRAGMA wal_checkpoint(TRUNCATE);",
  );
  if (db.prepare("PRAGMA integrity_check").get().integrity_check !== "ok")
    throw Error("Integrity check failed.");
  console.log(
    "Stopped database compacted and WAL checkpointed. Backups, storage snapshots and downloaded copies are managed separately; physical media erasure is not established.",
  );
} finally {
  db?.close();
  unlock();
}
