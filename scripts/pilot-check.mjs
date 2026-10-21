import { readFileSync, lstatSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { loadLocalEnv, readConfig } from "../server/config.mjs";
loadLocalEnv();
const checks = {};
let config;
try {
  config = readConfig();
  checks.strictPilot = config.pilotMode;
  checks.configuration = true;
} catch (error) {
  console.log(
    JSON.stringify(
      {
        ready: false,
        error: error.message,
        qualification: "No deployment or external review was performed.",
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
}
if (config) {
  checks.operatorAcceptance = !!config.pilotAcceptance?.ready;
  let db;
  try {
    db = new DatabaseSync(config.dbPath, { readOnly: true });
    checks.databaseIntegrity =
      db.prepare("PRAGMA integrity_check").get().integrity_check === "ok";
    checks.linkedAdministrator =
      db
        .prepare(
          "SELECT count(*) n FROM oidc_links l JOIN users u ON u.id=l.user_id JOIN memberships m ON m.user_id=u.id WHERE l.issuer=? AND m.role='Admin' AND u.disabled=0",
        )
        .get(config.oidcIssuer).n > 0;
    checks.modelApproval =
      db
        .prepare(
          "SELECT count(*) n FROM model_approvals a JOIN memberships m ON m.org_id=a.org_id JOIN oidc_links l ON l.user_id=m.user_id JOIN users u ON u.id=m.user_id WHERE a.model=? AND a.digest=? AND a.revoked=0 AND m.role='Admin' AND l.issuer=? AND u.disabled=0",
        )
        .get(config.runtimeModel, config.runtimeModelDigest, config.oidcIssuer)
        .n > 0;
    checks.noPendingCleanup =
      db
        .prepare("SELECT count(*) n FROM execution_jobs WHERE state='CLEANUP'")
        .get().n === 0;
  } catch {
    checks.databaseIntegrity = false;
  } finally {
    db?.close();
  }
  for (const [name, path] of [
    ["privateMfaKey", config.authKeyPath],
    ["privateSignerToken", config.signerTokenPath],
  ])
    try {
      const st = lstatSync(path);
      checks[name] =
        st.isFile() && !st.isSymbolicLink() && (st.mode & 0o077) === 0;
    } catch {
      checks[name] = false;
    }
  try {
    const origin = `http://${config.host}:${config.port}`;
    const response = await fetch(origin + "/api/health/ready", {
      signal: AbortSignal.timeout(5000),
    });
    checks.runningApi = response.ok;
  } catch {
    checks.runningApi = false;
  }
  const ready = Object.values(checks).every(Boolean);
  console.log(
    JSON.stringify(
      {
        ready,
        checks,
        qualification:
          "Local preflight plus operator-recorded acceptance only. Validate actual IdP, TLS, signer ownership, host controls, restore and load acceptance independently.",
      },
      null,
      2,
    ),
  );
  if (!ready) process.exitCode = 1;
}
