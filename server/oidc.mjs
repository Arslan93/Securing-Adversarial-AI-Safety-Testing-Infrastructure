import * as oidc from "openid-client";
import { randomBytes } from "node:crypto";
import { json } from "./http.mjs";
export function createOidc({ config, identity, auth, audit, access }) {
  const pending = new Map();
  let configuration;
  const enabled = !!config.oidcIssuer;
  async function client() {
    if (!enabled) throw Error("OIDC is not configured.");
    configuration ??= oidc
      .discovery(
        new URL(config.oidcIssuer),
        config.oidcClientId,
        config.oidcClientSecret || undefined,
        undefined,
        {
          timeout: 5,
          ...(config.oidcAllowHttp
            ? { execute: [oidc.allowInsecureRequests] }
            : {}),
        },
      )
      .catch((e) => {
        configuration = undefined;
        throw e;
      });
    return configuration;
  }
  async function begin(res, current) {
    if (!enabled) return json(res, 503, { error: "OIDC is not configured." });
    for (const [key, value] of pending)
      if (value.expires < Date.now()) pending.delete(key);
    if (pending.size >= 1000)
      return json(res, 429, { error: "Sign-in is busy. Retry shortly." });
    const c = await client(),
      verifier = oidc.randomPKCECodeVerifier(),
      state = oidc.randomState(),
      nonce = oidc.randomNonce(),
      binding = randomBytes(32).toString("hex");
    pending.set(binding, {
      state,
      nonce,
      verifier,
      expires: Date.now() + 300000,
      linkUserId: current?.userId,
      linkSession: current?.token,
    });
    const url = oidc.buildAuthorizationUrl(c, {
      redirect_uri: config.oidcRedirectUri,
      scope: "openid profile email",
      state,
      nonce,
      code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
      code_challenge_method: "S256",
      ...(config.oidcRequireMfa
        ? config.oidcAcrValues
          ? { acr_values: config.oidcAcrValues }
          : {}
        : {}),
    });
    res.setHeader(
      "Set-Cookie",
      `bayora_oidc=${binding}; HttpOnly; SameSite=Lax; Path=/api/oidc; Max-Age=300${config.environment === "production" ? "; Secure" : ""}`,
    );
    return json(res, 200, { url: url.href });
  }
  async function callback(req, res, url) {
    const binding = req.headers.cookie
        ?.split(";")
        .map((v) => v.trim())
        .find((v) => v.startsWith("bayora_oidc="))
        ?.slice(12),
      entry = pending.get(binding);
    pending.delete(binding);
    res.setHeader(
      "Set-Cookie",
      `bayora_oidc=; HttpOnly; SameSite=Lax; Path=/api/oidc; Max-Age=0${config.environment === "production" ? "; Secure" : ""}`,
    );
    if (!entry || entry.expires < Date.now())
      return json(res, 400, {
        error: "OIDC flow expired or was already used. Start sign-in again.",
      });
    try {
      const tokens = await oidc.authorizationCodeGrant(
        await client(),
        new URL(url.pathname + url.search, config.oidcRedirectUri),
        {
          pkceCodeVerifier: entry.verifier,
          expectedState: entry.state,
          expectedNonce: entry.nonce,
          idTokenExpected: true,
        },
      );
      const claims = tokens.claims();
      if (
        typeof claims?.sub !== "string" ||
        !claims.sub ||
        claims.sub.length > 255 ||
        claims.iss !== config.oidcIssuer
      )
        throw Error("claims");
      if (
        config.oidcRequireMfa &&
        !claims.amr?.some((method) => ["mfa", "otp", "hwk"].includes(method))
      )
        throw Error("MFA requirement");
      let uid = identity.security.oidcUser(claims.iss, claims.sub);
      if (entry.linkUserId) {
        const session = identity.session(entry.linkSession),
          user = identity.user(entry.linkUserId);
        if (
          !session ||
          session.user_id !== entry.linkUserId ||
          !user ||
          user.disabled ||
          (uid && uid !== user.id)
        )
          throw Error("link account");
        if (!uid) {
          identity.security.linkOidc(claims.iss, claims.sub, user.id);
          uid = user.id;
        }
      }
      if (!uid)
        return json(res, 403, {
          error:
            "This identity is not linked. Sign in with your existing account and connect your identity provider from Account settings.",
        });
      const user = identity.user(uid),
        org = identity.orgs(uid)[0];
      if (!user || user.disabled || !org) throw Error("membership");
      // All application roles come from current memberships, never from IdP role/email claims.
      if (
        auth.mfa.enabled(uid) &&
        !config.oidcRequireMfa &&
        !claims.amr?.some((m) => ["mfa", "otp", "hwk"].includes(m))
      )
        return json(res, 403, {
          error:
            "This account requires MFA. Use password plus authenticator, or configure IdP MFA.",
        });
      return access.enter(
        {
          userId: user.id,
          orgId: org.id,
          membership: identity.membership(user.id, org.id),
        },
        () =>
          auth.issue(res, user, org.id, {}, true, {
            method: "oidc",
            mfa: !!claims.amr?.some((m) => ["mfa", "otp", "hwk"].includes(m)),
            issuer: claims.iss,
          }),
      );
    } catch {
      return json(res, 400, {
        error:
          "OIDC response could not be validated. Check the issuer, state, nonce, PKCE and MFA configuration.",
      });
    }
  }
  return { enabled, begin, callback };
}
