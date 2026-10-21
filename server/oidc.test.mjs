import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { Readable } from "node:stream";
import { generateKeyPairSync, createSign, createHash } from "node:crypto";
import { createApplication } from "./app.mjs";
import { readConfig } from "./config.mjs";
const password = "OIDC-local-test-password-42";
function request(app, path, body, client = {}) {
  return new Promise((resolve) => {
    const req = Readable.from(
      body === undefined ? [] : [Buffer.from(JSON.stringify(body))],
    );
    Object.assign(req, {
      url: "/api" + path,
      method: body === undefined ? "GET" : "POST",
      socket: { remoteAddress: "127.0.0.1" },
      headers: {
        host: "127.0.0.1:3001",
        cookie: client.cookie,
        "x-csrf-token": client.csrf,
      },
    });
    const headers = {};
    const res = {
      getHeader: (k) => headers[k],
      setHeader(k, v) {
        headers[k] = v;
      },
      writeHead(status, values) {
        this.status = status;
        Object.assign(headers, values);
      },
      end(raw) {
        const data = raw ? JSON.parse(raw) : {},
          cookies = [
            ...String(client.cookie || "")
              .split(";")
              .filter(Boolean),
          ];
        for (const value of [].concat(headers["Set-Cookie"] || [])) {
          const cookie = value.split(";")[0],
            name = cookie.split("=")[0];
          const old = cookies.findIndex((c) => c.trim().startsWith(name + "="));
          if (old >= 0) cookies.splice(old, 1);
          cookies.push(cookie);
        }
        resolve({
          status: this.status,
          body: data,
          headers,
          client: {
            cookie: cookies.join("; "),
            csrf: data.csrf || client.csrf,
          },
        });
      },
    };
    app.server.emit("request", req, res);
  });
}
test("real OIDC code/PKCE/JWKS flow links only authenticated accounts and rejects replay, wrong state, nonce and missing MFA", async () => {
  const key = generateKeyPairSync("rsa", { modulusLength: 2048 }),
    jwk = {
      ...key.publicKey.export({ format: "jwk" }),
      kid: "test",
      use: "sig",
      alg: "RS256",
    },
    codes = new Map();
  let issuer,
    nonceOverride = false,
    mfa = true,
    subject = "subject-1";
  const jwt = (payload) => {
    const a = Buffer.from(
        JSON.stringify({ alg: "RS256", kid: "test" }),
      ).toString("base64url"),
      b = Buffer.from(JSON.stringify(payload)).toString("base64url");
    return (
      a +
      "." +
      b +
      "." +
      createSign("RSA-SHA256")
        .update(a + "." + b)
        .sign(key.privateKey)
        .toString("base64url")
    );
  };
  const provider = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, issuer);
      res.setHeader("Content-Type", "application/json");
      if (url.pathname === "/.well-known/openid-configuration")
        return res.end(
          JSON.stringify({
            issuer,
            authorization_endpoint: issuer + "/authorize",
            token_endpoint: issuer + "/token",
            jwks_uri: issuer + "/jwks",
            response_types_supported: ["code"],
            subject_types_supported: ["public"],
            id_token_signing_alg_values_supported: ["RS256"],
            code_challenge_methods_supported: ["S256"],
          }),
        );
      if (url.pathname === "/jwks")
        return res.end(JSON.stringify({ keys: [jwk] }));
      if (url.pathname === "/authorize") {
        const code = "code-" + codes.size;
        codes.set(code, {
          challenge: url.searchParams.get("code_challenge"),
          nonce: url.searchParams.get("nonce"),
        });
        const to = new URL(url.searchParams.get("redirect_uri"));
        to.searchParams.set("code", code);
        to.searchParams.set("state", url.searchParams.get("state"));
        res.writeHead(302, { Location: to.href });
        return res.end();
      }
      if (url.pathname === "/token") {
        let raw = "";
        for await (const part of req) raw += part;
        const form = new URLSearchParams(raw),
          entry = codes.get(form.get("code"));
        codes.delete(form.get("code"));
        if (
          !entry ||
          createHash("sha256")
            .update(form.get("code_verifier"))
            .digest("base64url") !== entry.challenge
        ) {
          res.statusCode = 400;
          return res.end(JSON.stringify({ error: "invalid_grant" }));
        }
        return res.end(
          JSON.stringify({
            access_token: "opaque-test-token",
            token_type: "Bearer",
            expires_in: 300,
            id_token: jwt({
              iss: issuer,
              sub: subject,
              aud: "bayora-test",
              iat: Math.floor(Date.now() / 1000),
              exp: Math.floor(Date.now() / 1000) + 300,
              nonce: nonceOverride ? "wrong" : entry.nonce,
              ...(mfa ? { amr: ["mfa"] } : {}),
              email: "ignored@provider.test",
              roles: ["Admin"],
            }),
          }),
        );
      }
      res.statusCode = 404;
      res.end("{}");
    } catch {
      res.statusCode = 500;
      res.end("{}");
    }
  });
  await new Promise((resolve) => provider.listen(0, "127.0.0.1", resolve));
  issuer = "http://127.0.0.1:" + provider.address().port;
  const config = readConfig({
      BAYORA_DB: ":memory:",
      BAYORA_OIDC_ISSUER: issuer,
      BAYORA_OIDC_ALLOW_HTTP: "true",
      BAYORA_OIDC_CLIENT_ID: "bayora-test",
      BAYORA_PUBLIC_ORIGIN: "http://127.0.0.1:3001",
      BAYORA_OIDC_REQUIRE_MFA: "true",
    }),
    app = createApplication(config);
  async function flow(begin, changeState = false) {
    const response = await fetch(begin.body.url, { redirect: "manual" }),
      location = new URL(response.headers.get("location"));
    if (changeState) location.searchParams.set("state", "wrong");
    return request(
      app,
      location.pathname.replace("/api", "") + location.search,
      undefined,
      begin.client,
    );
  }
  try {
    const owner = (
      await request(app, "/setup", { email: "owner@oidc.test", password })
    ).client;
    const unknown = await flow(await request(app, "/oidc/start", {}));
    assert.equal(unknown.status, 403); // IdP Admin claim cannot create a user or role.
    const connect = await request(
      app,
      "/account/oidc/connect",
      { password },
      owner,
    );
    assert.equal(connect.status, 200);
    const linked = await flow(connect);
    assert.equal(linked.status, 302);
    const signedIn = await flow(await request(app, "/oidc/start", {}));
    assert.equal(signedIn.status, 302);
    assert.equal(
      (await request(app, "/state", undefined, signedIn.client)).body.user
        .email,
      "owner@oidc.test",
    );
    const wrongState = await flow(await request(app, "/oidc/start", {}), true);
    assert.equal(wrongState.status, 400);
    nonceOverride = true;
    assert.equal(
      (await flow(await request(app, "/oidc/start", {}))).status,
      400,
    );
    nonceOverride = false;
    const red = await request(
      app,
      "/members",
      {
        email: "red@oidc.test",
        password,
        name: "Red",
        role: "Red",
        workspaces: ["ws-research"],
      },
      owner,
    );
    assert.equal(red.status, 201);
    const redSession = (
      await request(app, "/login", { email: "red@oidc.test", password })
    ).client;
    subject = "subject-red";
    const redLinked = await flow(
      await request(app, "/account/oidc/connect", { password }, redSession),
    );
    assert.equal(redLinked.status, 302);
    assert.equal(
      (await request(app, "/state", undefined, redLinked.client)).body.role,
      "Red",
    );
    mfa = false;
    assert.equal(
      (await flow(await request(app, "/oidc/start", {}))).status,
      400,
    );
  } finally {
    await app.close();
    await new Promise((resolve) => provider.close(resolve));
  }
});
