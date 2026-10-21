import { randomUUID, randomBytes } from "node:crypto";
import { loadLocalEnv, readConfig } from "../server/config.mjs";
import { createStore } from "../server/store.mjs";
import { createContainerRuntime } from "../server/runtime/docker.mjs";
import { createOrchestrator } from "../server/orchestrator.mjs";
import { dockerCommand } from "../server/runtime/command.mjs";
import { digest } from "../server/core.mjs";
import { publicManifest } from "../server/presenters.mjs";
loadLocalEnv();
const config = { ...readConfig(), dbPath: ".data/runtime-acceptance.db" };
let store = createStore(config.dbPath),
  runtime = createContainerRuntime({ ...store, config }),
  runner = createOrchestrator({ ...store, config, runtime }),
  lease,
  activeRun;
function newRun() {
  const run = {
    id: randomUUID(),
    orgId: "acceptance",
    workspaceId: "acceptance",
    name: "Live runtime acceptance",
    status: "PROVISIONING",
    results: [],
    attempts: [],
    timeline: [],
    snapshot: {
      workspace: { ttl: 5 },
      policy: {
        id: "acceptance",
        name: "Bounded policy",
        version: 1,
        rules: ["Keep fictional context private."],
      },
      dataset: {
        id: "acceptance",
        cases: [{ id: "one", prompt: "Say hello.", benign: true }],
      },
      model: config.runtimeModel,
      modelDigest: config.runtimeModelDigest,
      mode: "ollama",
      runtime: {
        kind: "container",
        profile: "bayora-container-v1",
        workerImage: config.runtimeWorkerImage,
        modelImage: config.runtimeModelImage,
        modelVolume: config.runtimeModelVolume,
        memoryMb: config.runtimeMemoryMb,
      },
    },
  };
  store.state.runs.push(run);
  store.audit("run.created", {
    runId: run.id,
    manifestHash: digest(publicManifest(run.snapshot)),
  });
  return run;
}
async function provision(run, signal) {
  return runtime.provision(run, {
    signal,
    onResources: (resources) => {
      run.runtimeResources = resources;
      store.audit("runtime.allocating", { runId: run.id });
    },
    onReport: (report) => {
      run.runtimeReport = report;
      store.audit("runtime.reported", {
        runId: run.id,
        runtimeHash: digest(report),
      });
    },
  });
}
const checks = [];
try {
  await runner.recovery;
  const ready = await runtime.preflight();
  if (!ready.ready) throw Error(ready.message);
  activeRun = newRun();
  const abort = new AbortController();
  lease = await provision(activeRun, abort.signal);
  const resource = (role) => lease.resources.find((r) => r.role === role).name;
  for (const role of ["red", "blue", "baseline", "defended"]) {
    await dockerCommand(
      [
        "exec",
        resource(role),
        "node",
        "-e",
        `const net=require('node:net');const s=net.connect({host:'192.0.2.1',port:443});s.once('connect',()=>process.exit(1));s.once('error',()=>process.exit(0));setTimeout(()=>process.exit(1),1000);`,
      ],
      { timeoutMs: 4000 },
    );
    await dockerCommand([
      "exec",
      resource(role),
      "node",
      "-e",
      `if(require('node:fs').existsSync('/var/run/docker.sock'))process.exit(1);`,
    ]);
  }
  checks.push("four-compartment egress denied", "Docker socket unavailable");
  const marker = randomBytes(16).toString("hex");
  await dockerCommand([
    "exec",
    resource("red"),
    "node",
    "-e",
    `require('node:fs').writeFileSync('/tmp/bayora-role-marker','${marker}')`,
  ]);
  for (const role of ["blue", "baseline", "defended"])
    await dockerCommand([
      "exec",
      resource(role),
      "node",
      "-e",
      `if(require('node:fs').existsSync('/tmp/bayora-role-marker'))process.exit(1);`,
    ]);
  checks.push("role filesystems separated");
  // Bounded live memory stress occurs only in the 256 MiB Red worker cgroup.
  try {
    await dockerCommand(
      [
        "exec",
        resource("red"),
        "node",
        "--max-old-space-size=512",
        "-e",
        `const buffers=[];while(true)buffers.push(Buffer.alloc(16*1024*1024,1));`,
      ],
      { timeoutMs: 10000, maxBytes: 4096 },
    );
    throw Error("Memory stress unexpectedly succeeded.");
  } catch (e) {
    if (e.message === "Memory stress unexpectedly succeeded.") throw e;
  }
  const memoryEvents = await dockerCommand([
    "exec",
    resource("red"),
    "node",
    "-e",
    `process.stdout.write(require('node:fs').readFileSync('/sys/fs/cgroup/memory.events','utf8'))`,
  ]);
  if (!/oom_kill [1-9]/.test(memoryEvents))
    throw Error("The live cgroup did not record an OOM kill.");
  await dockerCommand([
    "exec",
    resource("blue"),
    "node",
    "-e",
    `if(process.getuid()!==65532)process.exit(1);`,
  ]);
  checks.push("256 MiB memory boundary enforced without killing Blue");
  abort.abort(Error("Acceptance cancellation"));
  await lease.dispose();
  if (activeRun.runtimeReport.cleanup.status !== "REMOVED")
    throw Error("Cancellation teardown failed.");
  activeRun.status = "CANCELLED";
  store.save();
  lease = null;
  checks.push("cancellation teardown confirmed");
  // Preserve actual allocated resources, reopen the database, and let startup recovery remove them.
  activeRun = newRun();
  lease = await provision(activeRun, new AbortController().signal);
  activeRun.status = "RUNNING";
  store.save();
  await runner.close();
  store.close();
  store = createStore(config.dbPath);
  runtime = createContainerRuntime({ ...store, config });
  runner = createOrchestrator({ ...store, config, runtime });
  await runner.recovery;
  const recovered = store.state.runs.find((r) => r.id === activeRun.id);
  if (
    recovered.status !== "FAILED" ||
    recovered.runtimeReport.cleanup.status !== "REMOVED"
  )
    throw Error("Restart cleanup failed.");
  lease = null;
  checks.push("persisted restart recovery confirmed");
  console.log(
    JSON.stringify(
      {
        passed: true,
        checks,
        qualification:
          "Observed local Docker enforcement. Not independent host attestation or a side-channel proof.",
      },
      null,
      2,
    ),
  );
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
} finally {
  if (lease) {
    try {
      await runtime.cleanup(activeRun.id, activeRun.runtimeResources);
    } catch {}
  }
  await runner?.close();
  store?.close();
}
