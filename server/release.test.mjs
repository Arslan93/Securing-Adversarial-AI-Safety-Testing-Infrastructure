import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { seedDemo } from "../scripts/demo-seed.mjs";
import { createStore } from "./store.mjs";
test("isolated demo seed has five nondefault accounts, two policies and a reviewed corpus; backup/restore checks history", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bayora-demo-drill-")),
    demo = join(dir, "demo"),
    backup = join(dir, "backup"),
    restored = join(dir, "restored");
  try {
    await seedDemo(demo);
    const credentials = JSON.parse(
      readFileSync(join(demo, "credentials.json"), "utf8"),
    );
    assert.equal(credentials.length, 5);
    assert.equal(new Set(credentials.map((c) => c.password)).size, 5);
    assert.equal(statSync(join(demo, "credentials.json")).mode & 0o777, 0o600);
    await assert.rejects(() => seedDemo(demo), /already exists/);
    let store = createStore(join(demo, "bayora.db"));
    assert.equal(store.state.policies.length, 2);
    assert.equal(store.state.datasets.at(-1).cases.length, 3);
    assert.equal(store.identity.count(), 5);
    const hashes = store.state.events.map((e) => e.hash);
    store.close();
    execFileSync(process.execPath, ["scripts/data-backup.mjs", backup], {
      env: {
        ...process.env,
        BAYORA_DB: join(demo, "bayora.db"),
        NODE_ENV: "production",
        BAYORA_PILOT_MODE: "true",
        BAYORA_DEMO_AUTH: "true",
        BAYORA_AUTH_KEY: join(demo, "auth-master.key"),
      },
      stdio: "pipe",
    });
    execFileSync(
      process.execPath,
      ["scripts/data-restore.mjs", backup, restored],
      { stdio: "pipe" },
    );
    store = createStore(join(restored, "bayora.db"));
    assert.equal(store.identity.count(), 5);
    assert.deepEqual(
      store.state.events.map((e) => e.hash),
      hashes,
    );
    store.close();
    assert.throws(() =>
      execFileSync(
        process.execPath,
        ["scripts/data-restore.mjs", backup, restored],
        { stdio: "pipe" },
      ),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
