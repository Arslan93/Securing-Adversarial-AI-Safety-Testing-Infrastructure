import { DatabaseSync, backup } from "node:sqlite";
import {
  mkdirSync,
  existsSync,
  copyFileSync,
  chmodSync,
  writeFileSync,
} from "node:fs";
import { resolve, join, dirname } from "node:path";
import { loadLocalEnv, storagePaths } from "../server/config.mjs";
loadLocalEnv();
const config = storagePaths(),
  target = resolve(
    process.argv[2] ||
      ".data/backups/" + new Date().toISOString().replaceAll(":", "-"),
  );
if (config.dbPath === ":memory:" || !existsSync(config.dbPath))
  throw Error("No persistent database exists to back up.");
mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
mkdirSync(target, { recursive: false, mode: 0o700 });
const db = new DatabaseSync(config.dbPath, { readOnly: true });
try {
  await backup(db, join(target, "bayora.db"));
  chmodSync(join(target, "bayora.db"), 0o600);
} finally {
  db.close();
}
if (config.authKeyPath && existsSync(config.authKeyPath)) {
  copyFileSync(config.authKeyPath, join(target, "auth-master.key"));
  chmodSync(join(target, "auth-master.key"), 0o600);
}
writeFileSync(
  join(target, "RESTORE.txt"),
  "Private backup. Stop Bayora before restoring bayora.db and auth-master.key together. Restore the key at BAYORA_AUTH_KEY (or the database directory/auth-master.key). The signer ledger/private key are managed separately. Do not start two API processes on one database.\n",
  { mode: 0o600 },
);
console.log("Private database and MFA-key backup written to " + target);
