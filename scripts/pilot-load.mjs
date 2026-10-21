import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir, cpus, totalmem } from "node:os";
import { join, resolve } from "node:path";
import { randomBytes, createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { createApplication } from "../server/app.mjs";
import { readConfig } from "../server/config.mjs";
const root = mkdtempSync(join(tmpdir(), "bayora-load-")),
  port = process.env.BAYORA_LOAD_PORT || "3087",
  config = readConfig({
    PORT: port,
    BAYORA_DB: join(root, "app.db"),
    BAYORA_MAX_ACTIVE_RUNS: "2",
  }),
  app = createApplication(config),
  origin = `http://127.0.0.1:${port}`;
let cookie = "",
  csrf = "";
async function request(path, body) {
  const response = await fetch(origin + "/api" + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { cookie, "X-CSRF-Token": csrf } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await response.json();
  if (response.headers.get("set-cookie"))
    cookie = response.headers.get("set-cookie").split(";")[0];
  if (data.csrf) csrf = data.csrf;
  return { status: response.status, body: data };
}
async function batch(count, concurrency, fn) {
  let index = 0;
  const results = [];
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (index < count) {
        const item = index++,
          start = performance.now(),
          result = await fn(item);
        results.push({ ...result, ms: performance.now() - start });
      }
    }),
  );
  return results;
}
try {
  await new Promise((resolve, reject) => {
    app.server.once("error", reject);
    app.server.listen(config.port, config.host, resolve);
  });
  assert.equal(
    (
      await request("/setup", {
        email: "load@acceptance.local",
        password: randomBytes(18).toString("hex"),
      })
    ).status,
    200,
  );
  const s = (await request("/state")).body,
    body = {
      name: "Load admission fixture",
      workspaceId: s.workspaces[0].id,
      policyId: s.policies[0].id,
      datasetId: s.datasets[0].id,
      requestKey: "duplicate-admission",
    };
  const duplicates = await batch(24, 12, () => request("/runs", body));
  assert.equal(duplicates.filter((r) => r.status === 201).length, 1);
  assert.equal(new Set(duplicates.map((r) => r.body.id)).size, 1);
  const unique = await batch(16, 8, (i) =>
    request("/runs", { ...body, requestKey: "unique-" + i }),
  );
  assert.equal(unique.filter((r) => r.status === 201).length, 1);
  const health = await batch(400, 16, () => request("/health/live"));
  assert.ok(health.every((r) => r.status === 200));
  const traffic = await batch(320, 16, () => request("/state"));
  assert.ok(traffic.some((r) => r.status === 429));
  assert.ok(traffic.every((r) => [200, 429].includes(r.status)));
  const timings = health.map((r) => r.ms).sort((a, b) => a - b),
    p95 = timings[Math.ceil(timings.length * 0.95) - 1],
    threshold = Number(process.env.BAYORA_LOAD_P95_MS || 250);
  assert.ok(Number.isFinite(threshold) && threshold > 0);
  assert.ok(
    p95 <= threshold,
    `Loopback health p95 ${p95.toFixed(2)} ms exceeded ${threshold} ms`,
  );
  const result = {
    passed: true,
    measuredAt: new Date().toISOString(),
    scope:
      "isolated loopback synthetic admission/API load; no live model or production throughput claim",
    requests: 24 + 16 + 400 + 320,
    health: {
      requests: 400,
      concurrency: 16,
      p95Ms: Number(p95.toFixed(2)),
      acceptanceP95Ms: threshold,
    },
    duplicateRunIds: 1,
    admittedUniqueAdditionalRuns: 1,
    rateLimited: traffic.filter((r) => r.status === 429).length,
    environment: {
      node: process.version,
      cpuCount: cpus().length,
      memoryGiB: Number((totalmem() / 2 ** 30).toFixed(1)),
    },
  };
  mkdirSync(".data/acceptance", { recursive: true, mode: 0o700 });
  const path = resolve(".data/acceptance/pilot-load.json");
  writeFileSync(path, JSON.stringify(result, null, 2), { mode: 0o600 });
  console.log(
    JSON.stringify(
      {
        ...result,
        report: path,
        sha256: createHash("sha256")
          .update(JSON.stringify(result, null, 2))
          .digest("hex"),
      },
      null,
      2,
    ),
  );
} finally {
  await app.close();
}
