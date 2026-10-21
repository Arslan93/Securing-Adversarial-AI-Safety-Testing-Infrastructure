export function createSecurityStore(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS user_factors(user_id TEXT PRIMARY KEY REFERENCES users(id),secret TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 0,last_step INTEGER NOT NULL DEFAULT -1,recovery TEXT NOT NULL DEFAULT '[]',expires INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS oidc_links(issuer TEXT NOT NULL,subject TEXT NOT NULL,user_id TEXT NOT NULL REFERENCES users(id),PRIMARY KEY(issuer,subject),UNIQUE(issuer,user_id));
 CREATE TABLE IF NOT EXISTS invitations(id TEXT PRIMARY KEY,token_hash TEXT UNIQUE NOT NULL,org_id TEXT NOT NULL,email TEXT NOT NULL,role TEXT NOT NULL,workspaces TEXT NOT NULL,expires INTEGER NOT NULL,created_by TEXT NOT NULL,consumed INTEGER NOT NULL DEFAULT 0);`);
  return {
    factor: (uid) =>
      db.prepare("SELECT * FROM user_factors WHERE user_id=?").get(uid),
    factorCount: () =>
      db.prepare("SELECT count(*) AS n FROM user_factors").get().n,
    setFactor: (uid, secret, expires) =>
      db
        .prepare(
          "INSERT OR REPLACE INTO user_factors(user_id,secret,expires) VALUES(?,?,?)",
        )
        .run(uid, secret, expires),
    enableFactor: (uid, step, codes) =>
      db
        .prepare(
          "UPDATE user_factors SET enabled=1,last_step=?,recovery=? WHERE user_id=?",
        )
        .run(step, JSON.stringify(codes), uid),
    consumeStep: (uid, step) =>
      db
        .prepare(
          "UPDATE user_factors SET last_step=? WHERE user_id=? AND last_step<?",
        )
        .run(step, uid, step).changes === 1,
    consumeRecovery(uid, digest) {
      const row = db
        .prepare("SELECT recovery FROM user_factors WHERE user_id=?")
        .get(uid);
      const codes = JSON.parse(row?.recovery || "[]"),
        index = codes.indexOf(digest);
      if (index < 0) return false;
      codes.splice(index, 1);
      db.prepare("UPDATE user_factors SET recovery=? WHERE user_id=?").run(
        JSON.stringify(codes),
        uid,
      );
      return true;
    },
    removeFactor: (uid) =>
      db.prepare("DELETE FROM user_factors WHERE user_id=?").run(uid),
    oidcUser: (issuer, subject) =>
      db
        .prepare("SELECT user_id FROM oidc_links WHERE issuer=? AND subject=?")
        .get(issuer, subject)?.user_id,
    linkOidc: (issuer, subject, uid) =>
      db
        .prepare("INSERT INTO oidc_links VALUES(?,?,?)")
        .run(issuer, subject, uid),
    oidcLinks: (uid) =>
      db
        .prepare("SELECT issuer,subject FROM oidc_links WHERE user_id=?")
        .all(uid),
    invite: (value) =>
      db
        .prepare("INSERT INTO invitations VALUES(?,?,?,?,?,?,?,?,0)")
        .run(
          value.id,
          value.hash,
          value.orgId,
          value.email,
          value.role,
          JSON.stringify(value.workspaces),
          value.expires,
          value.createdBy,
        ),
    invitations: (org) =>
      db
        .prepare(
          "SELECT id,email,role,workspaces,expires,consumed FROM invitations WHERE org_id=?",
        )
        .all(org)
        .map((i) => ({ ...i, workspaces: JSON.parse(i.workspaces) })),
    invitation: (hash) =>
      db
        .prepare(
          "SELECT * FROM invitations WHERE token_hash=? AND consumed=0 AND expires>?",
        )
        .get(hash, Date.now()),
    consumeInvite: (id) =>
      db
        .prepare("UPDATE invitations SET consumed=1 WHERE id=? AND consumed=0")
        .run(id).changes === 1,
    revokeInvite: (id, org) =>
      db
        .prepare("UPDATE invitations SET consumed=1 WHERE id=? AND org_id=?")
        .run(id, org),
  };
}
