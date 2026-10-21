import { test } from "node:test";
import assert from "node:assert/strict";
import { readConfig, publicConfig } from "./config.mjs";
import { createApplication } from "./app.mjs";
import { Readable } from "node:stream";
test("configuration validates ports, loopback origins and authentication mode", () => {
  for (const env of [
    { PORT: "no" },
    { PORT: "0" },
    { PORT: "65536" },
    { BAYORA_HOST: "0.0.0.0" },
    { BAYORA_OLLAMA_ORIGIN: "https://example.com" },
    { BAYORA_OLLAMA_ORIGIN: "http://localhost:11434/private" },
    { BAYORA_DEMO_AUTH: "yes" },
    { NODE_ENV: "production" },
  ])
    assert.throws(() => readConfig(env));
  const config = readConfig({
    PORT: "3201",
    BAYORA_FRONTEND_PORT: "5201",
    BAYORA_OLLAMA_ORIGIN: "http://localhost:11434",
    BAYORA_SESSION_MINUTES: "5",
  });
  assert.ok(config.hosts.includes("127.0.0.1:3201"));
  assert.ok(config.origins.includes("http://localhost:5201"));
  assert.equal(config.sessionTtlMs, 300000);
  assert.equal(config.ollamaOrigin, "http://localhost:11434");
  assert.equal(publicConfig(config).dbPath, undefined);
});
function call(app, path, method = "GET", body) {
  return new Promise((resolve) => {
    const req = Readable.from(body ? [Buffer.from(JSON.stringify(body))] : []);
    Object.assign(req, {
      url: path,
      method,
      headers: { host: "127.0.0.1:3001" },
    });
    const res = {
      writeHead(status) {
        this.status = status;
      },
      setHeader() {},
      end(payload) {
        resolve({ status: this.status, body: JSON.parse(payload) });
      },
    };
    app.server.emit("request", req, res);
  });
}
test("production with demo disabled exposes health but refuses role sign-in", async () => {
  const app = createApplication(
    readConfig({
      NODE_ENV: "production",
      BAYORA_DEMO_AUTH: "false",
      BAYORA_DB: ":memory:",
    }),
  );
  try {
    assert.equal((await call(app, "/api/health/live")).status, 200);
    const ready = await call(app, "/api/health/ready");
    assert.equal(ready.status, 503);
    assert.equal(ready.body.checks.storage, true);
    assert.equal(ready.body.checks.authentication, false);
    assert.equal(
      (await call(app, "/api/login", "POST", { role: "Admin" })).status,
      503,
    );
    assert.equal((await call(app, "/api/state")).status, 401);
  } finally {
    await app.close();
  }
});

test("readiness is independent of the model provider and turns false during shutdown", async () => {
  const app = createApplication(
    readConfig({
      BAYORA_DB: ":memory:",
      BAYORA_OLLAMA_ORIGIN: "http://127.0.0.1:9",
    }),
  );
  assert.equal((await call(app, "/api/health/ready")).status, 200);
  await app.close();
  assert.equal((await call(app, "/api/health/live")).status, 503);
  const ready = await call(app, "/api/health/ready");
  assert.equal(ready.status, 503);
  assert.equal(ready.body.checks.storage, false);
});
