import { createSecurityStore } from "./security-store.mjs";
import {
  randomBytes,
  randomUUID,
  scrypt as derive,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import { promisify } from "node:util";
const scrypt = promisify(derive);
export const ROLES = ["Admin", "Red", "Blue", "Analyst", "Auditor"];
export const fingerprint = (value) =>
  createHash("sha256").update(value).digest("hex");
export function credentials(body) {
  const email = String(body.email || "")
    .trim()
    .toLowerCase();
  if (
    !/^[^\s@]{1,100}@[^\s@]{1,100}\.[^\s@]{1,50}$/.test(email) ||
    typeof body.password !== "string" ||
    body.password.length < 12 ||
    body.password.length > 128
  )
    throw Object.assign(
      Error("Use a valid email and a password of 12–128 characters."),
      { status: 400 },
    );
  return { email, password: body.password };
}
export async function hashPassword(
  password,
  salt = randomBytes(16).toString("hex"),
) {
  const key = await scrypt(password, salt, 64, {
    N: 32768,
    r: 8,
    p: 3,
    maxmem: 64 * 1024 * 1024,
  });
  return `${salt}:${key.toString("hex")}`;
}
export async function checkPassword(password, encoded) {
  const [salt, expected] = encoded.split(":");
  const actual = (await hashPassword(password, salt)).split(":")[1];
  return timingSafeEqual(
    Buffer.from(actual, "hex"),
    Buffer.from(expected, "hex"),
  );
}
export function createIdentity(db) {
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
    INSERT OR IGNORE INTO schema_migrations VALUES(3,datetime('now'));
    CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, password TEXT NOT NULL, name TEXT NOT NULL, disabled INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS organizations(id TEXT PRIMARY KEY, name TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS memberships(user_id TEXT NOT NULL REFERENCES users(id), org_id TEXT NOT NULL REFERENCES organizations(id), role TEXT NOT NULL, workspaces TEXT NOT NULL, PRIMARY KEY(user_id,org_id));
    CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),org_id TEXT NOT NULL,expires INTEGER NOT NULL,csrf TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);`);
  const sessionColumns = new Set(
    db
      .prepare("PRAGMA table_info(sessions)")
      .all()
      .map((c) => c.name),
  );
  for (const [name, type] of [
    ["auth_method", "TEXT NOT NULL DEFAULT 'local'"],
    ["mfa", "INTEGER NOT NULL DEFAULT 0"],
    ["issuer", "TEXT NOT NULL DEFAULT ''"],
  ])
    if (!sessionColumns.has(name))
      db.exec(`ALTER TABLE sessions ADD COLUMN ${name} ${type}`);
  db.prepare(
    "INSERT OR IGNORE INTO schema_migrations VALUES(8,datetime('now'))",
  ).run();
  const user = (id) => db.prepare("SELECT * FROM users WHERE id=?").get(id);
  const byEmail = (email) =>
    db.prepare("SELECT * FROM users WHERE email=?").get(email);
  const membership = (userId, orgId) => {
    const m = db
      .prepare("SELECT * FROM memberships WHERE user_id=? AND org_id=?")
      .get(userId, orgId);
    return m && { ...m, workspaces: JSON.parse(m.workspaces) };
  };
  function addUser(input, password) {
    const id = randomUUID();
    db.prepare("INSERT INTO users(id,email,password,name) VALUES(?,?,?,?)").run(
      id,
      input.email,
      password,
      String(input.name || input.email).slice(0, 80),
    );
    return user(id);
  }
  function addOrg(name) {
    const org = {
      id: randomUUID(),
      name: String(name || "My organization")
        .trim()
        .slice(0, 80),
    };
    db.prepare("INSERT INTO organizations VALUES(?,?)").run(org.id, org.name);
    return org;
  }
  const setMembership = (uid, oid, role, workspaces) =>
    db
      .prepare("INSERT OR REPLACE INTO memberships VALUES(?,?,?,?)")
      .run(uid, oid, role, JSON.stringify(workspaces));
  return {
    security: createSecurityStore(db),
    transaction(fn) {
      db.exec("BEGIN IMMEDIATE");
      try {
        const result = fn();
        db.exec("COMMIT");
        return result;
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    },
    user,
    byEmail,
    membership,
    addUser,
    addOrg,
    setMembership,
    count: () => db.prepare("SELECT count(*) AS count FROM users").get().count,
    org: (id) => db.prepare("SELECT * FROM organizations WHERE id=?").get(id),
    orgs: (uid) =>
      db
        .prepare(
          "SELECT o.* FROM organizations o JOIN memberships m ON o.id=m.org_id WHERE m.user_id=? ORDER BY o.rowid",
        )
        .all(uid),
    members: (oid) =>
      db
        .prepare(
          "SELECT u.id,u.email,u.name,u.disabled,m.role,m.workspaces FROM users u JOIN memberships m ON m.user_id=u.id WHERE m.org_id=?",
        )
        .all(oid)
        .map((m) => ({ ...m, workspaces: JSON.parse(m.workspaces) })),
    revoke: (uid) =>
      db.prepare("DELETE FROM sessions WHERE user_id=?").run(uid),
    changePassword: (uid, hash) => {
      db.prepare("UPDATE users SET password=? WHERE id=?").run(hash, uid);
      db.prepare("DELETE FROM sessions WHERE user_id=?").run(uid);
    },
    putSession: (token, uid, oid, expires, csrf, assurance = {}) =>
      db
        .prepare(
          "INSERT INTO sessions(token,user_id,org_id,expires,csrf,auth_method,mfa,issuer) VALUES(?,?,?,?,?,?,?,?)",
        )
        .run(
          fingerprint(token),
          uid,
          oid,
          expires,
          csrf,
          assurance.method || "local",
          assurance.mfa ? 1 : 0,
          assurance.issuer || "",
        ),
    session: (token) =>
      db
        .prepare("SELECT * FROM sessions WHERE token=? AND expires>?")
        .get(fingerprint(token), Date.now()),
    deleteSession: (token) =>
      db.prepare("DELETE FROM sessions WHERE token=?").run(fingerprint(token)),
    prune: () =>
      db.prepare("DELETE FROM sessions WHERE expires<=?").run(Date.now()),
  };
}
