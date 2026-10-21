import { createMfa } from "./mfa.mjs";
import { createAccountRoutes } from "./routes/accounts.mjs";
import { randomBytes } from "node:crypto";
import { json } from "./http.mjs";
import {
  ROLES,
  credentials,
  hashPassword,
  checkPassword,
  fingerprint,
} from "./identity.mjs";
export { ROLES } from "./identity.mjs";
export function createAuth({
  config,
  audit,
  identity,
  access,
  allState,
  save,
}) {
  const mfa = createMfa({ identity, config }),
    challenges = new Map();
  let setupBusy = false,
    hashing = 0;
  const failures = new Map();
  const publicUser = (user) => ({
    id: user.id,
    email: user.email,
    name: user.name,
  });
  function session(req) {
    if (!config.demoAuth && !config.oidcIssuer) return null;
    const token = req.headers.cookie
      ?.split(";")
      .map((x) => x.trim())
      .find((x) => x.startsWith("bayora_session="))
      ?.slice(15);
    if (!token || token.length !== 64) return null;
    const entry = identity.session(token);
    if (!entry) return null;
    if (
      config.environment === "production" &&
      !config.demoAuth &&
      (entry.auth_method !== "oidc" ||
        entry.issuer !== config.oidcIssuer ||
        (config.oidcRequireMfa && entry.mfa !== 1))
    )
      return null;
    const user = identity.user(entry.user_id),
      membership = identity.membership(entry.user_id, entry.org_id);
    if (!user || user.disabled || !membership) return null;
    return {
      token,
      assurance: {
        method: entry.auth_method,
        mfa: entry.mfa === 1,
        issuer: entry.issuer,
      },
      userId: user.id,
      orgId: entry.org_id,
      role: membership.role,
      membership,
      user: publicUser(user),
      csrf: entry.csrf,
    };
  }
  function revalidate(current) {
    const member = identity.membership(current.userId, current.orgId);
    if (
      !identity.session(current.token) ||
      !member ||
      member.role !== current.role
    )
      throw Object.assign(Error("Your access changed. Sign in again."), {
        status: 401,
      });
  }
  function permit(role, allowed) {
    if (!allowed.includes(role)) {
      audit("authorization.denied", { role, action: "restricted operation" });
      throw Object.assign(Error("Access denied for your account role."), {
        status: 403,
      });
    }
  }
  function issue(
    res,
    user,
    orgId,
    extra = {},
    redirect = false,
    assurance = access.current()?.assurance || {},
  ) {
    identity.prune();
    const token = randomBytes(32).toString("hex"),
      csrf = randomBytes(32).toString("hex");
    identity.putSession(
      token,
      user.id,
      orgId,
      Date.now() + config.sessionTtlMs,
      csrf,
      assurance,
    );
    res.setHeader(
      "Set-Cookie",
      `bayora_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${config.sessionTtlMs / 1000}${config.environment === "production" ? "; Secure" : ""}`,
    );
    access.enter(
      {
        userId: user.id,
        orgId,
        role: identity.membership(user.id, orgId).role,
        membership: identity.membership(user.id, orgId),
      },
      () =>
        audit("session.created", {
          userId: user.id,
          mode: assurance.method || "local",
        }),
    );
    if (redirect) {
      res.writeHead(302, { Location: config.publicOrigin || "/" });
      res.end();
      return true;
    }
    return json(res, 200, {
      user: publicUser(user),
      csrf,
      role: identity.membership(user.id, orgId).role,
      ...extra,
    });
  }
  async function boundedHash(fn) {
    if (hashing >= 4)
      throw Object.assign(Error("Sign-in is busy. Retry shortly."), {
        status: 429,
      });
    hashing++;
    try {
      return await fn();
    } finally {
      hashing--;
    }
  }
  async function login(res, body, req) {
    if (!config.demoAuth)
      return json(res, 503, {
        error: "Local account authentication is disabled.",
      });
    const input = credentials(body);
    const key = fingerprint(
      `${req.clientAddress || req.socket.remoteAddress}:${input.email}`,
    );
    const now = Date.now();
    for (const [k, v] of failures) if (v.until <= now) failures.delete(k);
    const attempts = failures.get(key) || { count: 0, until: now + 15 * 60000 };
    if (attempts.count >= 8 || failures.size >= 10000)
      return json(res, 429, {
        error: "Too many sign-in attempts. Retry in 15 minutes.",
      });
    attempts.count++;
    failures.set(key, attempts);
    const user = identity.byEmail(input.email);
    const valid = await boundedHash(() =>
      checkPassword(
        input.password,
        user?.password || `${"00".repeat(16)}:${"00".repeat(64)}`,
      ),
    );
    if (!user || user.disabled || !valid)
      return json(res, 401, { error: "Email or password is incorrect." });
    const org = identity.orgs(user.id)[0];
    if (!org)
      return json(res, 403, { error: "No active organization membership." });
    failures.delete(key);
    if (mfa.enabled(user.id)) {
      for (const [id, c] of challenges)
        if (c.expires < Date.now()) challenges.delete(id);
      if (challenges.size >= 1000)
        return json(res, 429, { error: "Sign-in is busy. Retry shortly." });
      const challenge = randomBytes(32).toString("hex");
      challenges.set(challenge, {
        uid: user.id,
        password: user.password,
        orgId: org.id,
        expires: Date.now() + 300000,
        attempts: 0,
      });
      return json(res, 200, { mfaRequired: true, challenge });
    }
    return issue(res, user, org.id);
  }
  async function registerInvitation(res, body) {
    if (!config.demoAuth)
      return json(res, 503, {
        error: "Local account registration is disabled.",
      });
    if (typeof body.token !== "string" || body.token.length !== 64)
      throw Error("Invitation token is invalid.");
    const input = credentials(body);
    const invite = identity.security.invitation(fingerprint(body.token));
    if (
      !invite ||
      invite.email !== input.email ||
      identity.membership(invite.created_by, invite.org_id)?.role !== "Admin"
    )
      return json(res, 404, { error: "Invitation is invalid or expired." });
    if (identity.byEmail(input.email))
      return json(res, 409, {
        error:
          "This account exists. Sign in and accept the invitation from Account settings.",
      });
    const spaces = JSON.parse(invite.workspaces);
    if (
      spaces.some(
        (id) =>
          !allState.workspaces.some(
            (w) => w.id === id && w.orgId === invite.org_id,
          ),
      )
    )
      throw Error("Invitation workspace is no longer available.");
    const hash = await boundedHash(() => hashPassword(input.password));
    if (
      !identity.security.invitation(fingerprint(body.token)) ||
      identity.membership(invite.created_by, invite.org_id)?.role !== "Admin" ||
      identity.byEmail(input.email)
    )
      return json(res, 409, {
        error:
          "Invitation or account changed. Retry sign-in or ask for a fresh invitation.",
      });
    const user = identity.transaction(() => {
      if (!identity.security.consumeInvite(invite.id))
        throw Error("Invitation was already used.");
      const user = identity.addUser({ ...input, name: body.name }, hash);
      identity.setMembership(user.id, invite.org_id, invite.role, spaces);
      return user;
    });
    return issue(res, user, invite.org_id);
  }
  async function verifyMfa(res, body) {
    const c = challenges.get(body.challenge);
    if (!c || c.expires < Date.now() || c.attempts >= 5)
      return json(res, 401, { error: "MFA challenge expired. Sign in again." });
    c.attempts++;
    const user = identity.user(c.uid);
    if (
      !user ||
      user.disabled ||
      user.password !== c.password ||
      !identity.membership(c.uid, c.orgId) ||
      !mfa.verify(c.uid, body.code)
    )
      return json(res, 401, {
        error: "MFA code is incorrect or was already used.",
      });
    challenges.delete(body.challenge);
    return issue(res, user, c.orgId);
  }
  async function securityRoutes({ url, req, res, body, current }) {
    if (url.pathname === "/api/account/security" && req.method === "GET")
      return json(res, 200, {
        mfaEnabled: mfa.enabled(current.userId),
        oidcConfigured: !!config.oidcIssuer,
        oidcLinks: identity.security.oidcLinks(current.userId),
      });
    if (
      ["/api/account/mfa/enroll", "/api/account/mfa/disable"].includes(
        url.pathname,
      ) &&
      req.method === "POST"
    ) {
      if (
        typeof body.password !== "string" ||
        body.password.length > 128 ||
        !(await boundedHash(() =>
          checkPassword(body.password, identity.user(current.userId).password),
        ))
      )
        return json(res, 403, { error: "Current password is incorrect." });
      revalidate(current);
      if (url.pathname.endsWith("disable")) {
        if (!mfa.verify(current.userId, body.code))
          return json(res, 403, {
            error: "A fresh authenticator or recovery code is required.",
          });
        mfa.disable(current.userId);
        audit("account.mfa.disabled", { userId: current.userId });
        return logout(res, current);
      }
      return json(res, 200, mfa.begin(current.userId));
    }
    if (url.pathname === "/api/account/mfa/confirm" && req.method === "POST") {
      const result = mfa.confirm(current.userId, body.code);
      audit("account.mfa.enabled", { userId: current.userId });
      return issue(res, identity.user(current.userId), current.orgId, result);
    }
    return false;
  }
  async function reauthenticate(current, body) {
    if (
      typeof body.password !== "string" ||
      body.password.length > 128 ||
      !(await boundedHash(() =>
        checkPassword(body.password, identity.user(current.userId).password),
      ))
    )
      throw Object.assign(Error("Current password is required."), {
        status: 403,
      });
    revalidate(current);
    if (mfa.enabled(current.userId) && !mfa.verify(current.userId, body.code))
      throw Object.assign(Error("A fresh MFA or recovery code is required."), {
        status: 403,
      });
  }
  async function setup(res, body) {
    if (!config.demoAuth)
      return json(res, 503, {
        error: "Local account authentication is disabled.",
      });
    if (identity.count() || setupBusy)
      return json(res, 409, {
        error: "Setup is already complete or in progress. Sign in.",
      });
    const input = credentials(body);
    setupBusy = true;
    try {
      const hash = await boundedHash(() => hashPassword(input.password));
      const user = identity.addUser({ ...input, name: body.name }, hash),
        org = identity.addOrg(body.organization);
      identity.setMembership(user.id, org.id, "Admin", []);
      access.stampLegacy(org.id, user.id);
      return issue(res, user, org.id);
    } finally {
      setupBusy = false;
    }
  }
  function logout(res, current) {
    identity.deleteSession(current.token);
    access.enter(current, () =>
      audit("session.revoked", { userId: current.userId }),
    );
    res.setHeader(
      "Set-Cookie",
      "bayora_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0",
    );
    return json(res, 200, { ok: true });
  }
  const accountRoutes = createAccountRoutes({
    identity,
    access,
    allState,
    save,
    audit,
    permit,
    issue,
    logout,
    boundedHash,
    revalidate,
    publicUser,
  });

  return {
    session,
    revalidate,
    permit,
    login,
    verifyMfa,
    registerInvitation,
    reauthenticate,
    securityRoutes,
    issue,
    mfa,
    setup,
    logout,
    accountRoutes,
    publicUser,
    close: () => {
      failures.clear();
      challenges.clear();
    },
  };
}
