import {
  copyFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { resolve, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createStore } from "../server/store.mjs";
const [sourceArg, targetArg] = process.argv.slice(2);
if (!sourceArg || !targetArg)
  throw Error(
    "Usage: npm run data:restore -- BACKUP_DIRECTORY NEW_RESTORE_DIRECTORY",
  );
const source = resolve(sourceArg),
  target = resolve(targetArg);
if (!existsSync(join(source, "bayora.db")))
  throw Error("Backup database is missing.");
mkdirSync(target, { recursive: false, mode: 0o700 });
copyFileSync(join(source, "bayora.db"), join(target, "bayora.db"));
chmodSync(join(target, "bayora.db"), 0o600);
if (existsSync(join(source, "auth-master.key"))) {
  copyFileSync(
    join(source, "auth-master.key"),
    join(target, "auth-master.key"),
  );
  chmodSync(join(target, "auth-master.key"), 0o600);
}
const db = new DatabaseSync(join(target, "bayora.db"));
try {
  if (db.prepare("PRAGMA integrity_check").get().integrity_check !== "ok")
    throw Error("SQLite integrity check failed.");
} finally {
  db.close();
}
const store = createStore(join(target, "bayora.db"));
store.close();
writeFileSync(
  join(target, "RESTORED.txt"),
  "Verified restore copy. Do not serve concurrently with the original workspace. Runtime ownership derives from the original database path; restore at that original path only after stopping Bayora and reconciling existing resources. Restore signer keys/ledger separately.\n",
  { mode: 0o600 },
);
console.log(
  "Database integrity and audit history verified in new restore directory: " +
    target,
);
