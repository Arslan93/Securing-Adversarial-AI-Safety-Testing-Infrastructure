import { checkExecutionPolicy } from "../pilot.mjs";
import { interruptAttempt } from "./attempts.mjs";
import { fork, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { digest, evidenceResults, evidenceAttempts } from "../core.mjs";
import { ACTIVE_STATUSES as active } from "../lifecycle.mjs";
const workerPath = fileURLToPath(new URL("./worker.mjs", import.meta.url));
export function createExecutionBroker({
  allState: state,
  queue,
  audit,
  config,
  runtime,
  ready: storageReady,
  pilot,
}) {
  const settling = new Set();
  const children = new Map(),
    controllers = new Map();
  let closing = false,
    recovered = false,
    pumping = false;
  const leaseMs = config.workerLeaseMs || 5000;
  function finalEvent(run, reason) {
    if (!active.has(run.status)) return;
    interruptAttempt(run);
    run.status = "FAILED";
    run.validity = run.snapshot.mode === "ollama" ? "UNVERIFIED" : "DEMO_ONLY";
    run.error = reason;
    run.finishedAt = new Date().toISOString();
    run.timeline.push({ status: "FAILED", time: run.finishedAt });
    audit("run.failed", {
      runId: run.id,
      reason,
      verdict: run.validity,
      resultsHash: digest(evidenceResults(run.results)),
      attemptsHash: digest(evidenceAttempts(run.attempts)),
    });
  }
  async function cleanup(run) {
    if (run.snapshot.runtime?.kind !== "container") return true;
    const receipt = run.runtimeResources?.length
      ? await runtime.cleanup(run.id, run.runtimeResources)
      : { status: "REMOVED", resources: [] };
    run.runtimeReport = {
      ...run.runtimeReport,
      status: receipt.status === "REMOVED" ? "CLEANED" : "CLEANUP_FAILED",
      cleanup: receipt,
    };
    run.cleanup =
      receipt.status === "REMOVED"
        ? "Recovery removed per-run containers and checked absence."
        : "Cleanup failed. Retry container cleanup before more work.";
    audit("runtime.reported", {
      runId: run.id,
      runtimeHash: digest(run.runtimeReport),
    });
    return receipt.status === "REMOVED";
  }
  async function settle(run) {
    const clean =
      run.snapshot.runtime?.kind !== "container" ||
      run.runtimeReport?.cleanup?.status === "REMOVED" ||
      (await cleanup(run));
    queue.finish(run.id, clean ? "DONE" : "CLEANUP");
  }
  const recovery = (async () => {
    for (const job of queue.all()) {
      const run = state.runs.find((r) => r.id === job.run_id);
      if (!run) throw Error("Queue references a missing run.");
      if (job.state === "RUNNING" && job.worker_pid) {
        // Never signal an unrelated process if the OS has reused a persisted PID.
        try {
          const command = execFileSync(
            "ps",
            ["-p", String(job.worker_pid), "-o", "command="],
            { encoding: "utf8" },
          );
          if (
            command.includes(workerPath) &&
            command.includes("--bayora-job=" + run.id)
          )
            process.kill(-job.worker_pid, "SIGKILL");
        } catch {}
      }
      if (
        job.state === "READY" &&
        active.has(run.status) &&
        job.deadline > Date.now()
      )
        continue;
      if (["RESERVED", "RUNNING", "CLEANUP", "READY"].includes(job.state)) {
        finalEvent(
          run,
          job.deadline <= Date.now()
            ? "Persisted execution deadline exceeded."
            : "Execution interrupted before a terminal acknowledgement. Retry creates a new linked run.",
        );
        await settle(run);
      }
    }
    for (const run of state.runs.filter((r) => !queue.get(r.id))) {
      if (active.has(run.status))
        finalEvent(
          run,
          "Legacy in-process execution interrupted. Start a new evaluation.",
        );
      if (
        run.snapshot.runtime?.kind === "container" &&
        run.runtimeReport?.cleanup?.status !== "REMOVED"
      )
        await cleanup(run);
    }
    recovered = true;
  })();
  function failed(entry, reason) {
    if (entry.finished) return entry.completion;
    entry.finished = true;
    children.delete(entry.run.id);
    controllers.delete(entry.run.id);
    entry.completion = (async () => {
      finalEvent(entry.run, reason);
      await settle(entry.run);
      void pump();
    })();
    settling.add(entry.completion);
    entry.completion.then(
      () => settling.delete(entry.completion),
      () => settling.delete(entry.completion),
    );
    return entry.completion;
  }
  function killWorker(child, signal = "SIGKILL") {
    try {
      process.kill(-child.pid, signal);
    } catch {
      child.kill(signal);
    }
  }

  function spawnWorker(run, token) {
    const child = fork(workerPath, ["--bayora-job=" + run.id], {
      stdio: ["ignore", "ignore", "ignore", "ipc"],
      execArgv: [],
      detached: true,
      env: Object.fromEntries(
        Object.entries(process.env).filter(([key]) =>
          [
            "PATH",
            "HOME",
            "TMPDIR",
            "LANG",
            "DOCKER_HOST",
            "DOCKER_CONFIG",
          ].includes(key),
        ),
      ),
    });
    const entry = {
      run,
      child,
      token,
      finished: false,
      lastBeat: Date.now(),
      stoppingAt: null,
    };
    children.set(run.id, entry);
    queue.heartbeat(run.id, token, child.pid, leaseMs);
    controllers.set(run.id, {
      abort() {
        if (child.connected) child.send({ type: "stop" });
        entry.stoppingAt = Date.now();
      },
    });
    child.on("message", (message) => {
      if (entry.finished) return;
      const job = queue.get(run.id);
      if (
        job?.token !== token ||
        job.lease_until < Date.now() ||
        job.deadline <= Date.now()
      ) {
        killWorker(child);
        return;
      }
      try {
        checkExecutionPolicy({
          config,
          pilot,
          orgId: run.orgId,
          mode:
            run.snapshot.runtime?.kind === "container"
              ? "container-ollama"
              : run.snapshot.mode,
          model: { id: run.snapshot.model, digest: run.snapshot.modelDigest },
        });
      } catch (error) {
        killWorker(child);
        void failed(entry, error.message);
        return;
      }
      if (message.type === "heartbeat") {
        entry.lastBeat = Date.now();
        if (!queue.heartbeat(run.id, token, child.pid, leaseMs))
          killWorker(child);
        return;
      }
      if (message.type === "event") {
        try {
          if (
            typeof message.event !== "string" ||
            message.event.length > 100 ||
            message.run?.id !== run.id
          )
            throw Error("Invalid worker message.");
          const incoming = message.run;
          if (active.has(run.status)) {
            if (incoming.attempts?.length > run.execution.maxCalls)
              throw Error("Persisted model call budget exceeded.");
            if (message.event === "attempt.started") {
              const count = (run.execution.callsStarted || 0) + 1;
              if (count > run.execution.maxCalls)
                throw Error("Model call budget exhausted.");
              run.execution.callsStarted = count;
            }
            for (const field of [
              "status",
              "validity",
              "results",
              "attempts",
              "timeline",
              "error",
              "finishedAt",
              "cleanup",
              "runtimeReport",
              "runtimeResources",
              "inFlightAttempt",
            ])
              if (incoming[field] !== undefined) run[field] = incoming[field];
            audit(message.event, { ...message.data, runId: run.id });
          } else if (message.event.startsWith("runtime.")) {
            if (incoming.runtimeReport)
              run.runtimeReport = incoming.runtimeReport;
            if (incoming.cleanup) run.cleanup = incoming.cleanup;
            audit(message.event, { ...message.data, runId: run.id });
          }
          if (child.connected) child.send({ type: "ack", id: message.id });
        } catch (error) {
          if (child.connected)
            child.send({
              type: "ack",
              id: message.id,
              error: "Persistence rejected worker update.",
            });
          killWorker(child);
        }
      }
      if (message.type === "done") {
        child.disconnect();
        child.kill("SIGTERM");
        void failed(
          entry,
          active.has(run.status)
            ? "Worker stopped without a terminal result."
            : "Execution ended.",
        );
      }
    });
    child.once(
      "error",
      () => void failed(entry, "Execution worker could not start."),
    );
    child.once(
      "exit",
      () =>
        void failed(
          entry,
          "Worker exited before completion. Partial evidence was preserved.",
        ),
    );
    // Only execution settings reach the worker; no signing key, OIDC secret, session or MFA master key.
    const executionConfig = Object.fromEntries(
      Object.entries(config).filter(([key]) =>
        [
          "dbPath",
          "syntheticStepMs",
          "ollamaOrigin",
          "runtimeEnabled",
          "runtimeWorkerImage",
          "runtimeModelImage",
          "runtimeModelVolume",
          "runtimeModel",
          "runtimeModelDigest",
          "runtimeMemoryMb",
        ].includes(key),
      ),
    );
    child.send({
      type: "start",
      run: structuredClone(run),
      config: executionConfig,
    });
  }
  async function pump() {
    if (pumping || closing) return;
    pumping = true;
    try {
      await recovery;
      for (const job of queue.all()) {
        if (job.state !== "READY") continue;
        const run = state.runs.find((r) => r.id === job.run_id);
        if (!active.has(run.status)) {
          await settle(run);
          continue;
        }
        if (job.deadline <= Date.now()) {
          finalEvent(
            run,
            "Persisted execution deadline exceeded while queued.",
          );
          await settle(run);
          continue;
        }
        if (children.size >= (config.workerConcurrency || 1)) break;
        try {
          checkExecutionPolicy({
            config,
            pilot,
            orgId: run.orgId,
            mode:
              run.snapshot.runtime?.kind === "container"
                ? "container-ollama"
                : run.snapshot.mode,
            model: { id: run.snapshot.model, digest: run.snapshot.modelDigest },
          });
        } catch (error) {
          finalEvent(run, error.message);
          await settle(run);
          continue;
        }
        const token = queue.claim(run.id, leaseMs);
        if (token) spawnWorker(run, token);
      }
    } finally {
      pumping = false;
    }
  }
  const timer = setInterval(() => {
    for (const entry of children.values()) {
      if (
        Date.now() > entry.run.execution.deadline ||
        Date.now() - entry.lastBeat > leaseMs ||
        (entry.stoppingAt && Date.now() - entry.stoppingAt > 5000)
      ) {
        killWorker(entry.child);
        void failed(
          entry,
          Date.now() > entry.run.execution.deadline
            ? "Persisted execution deadline exceeded."
            : "Worker lease expired or cancellation exceeded its cleanup window.",
        );
      }
    }
    void pump();
  }, 250);
  timer.unref();
  function enqueue(id) {
    queue.ready(id);
    audit("execution.queued", { runId: id });
    void pump();
  }
  return {
    recovery,
    recoveryReady: () => recovered,
    controllers,
    progress: enqueue,
    liveProgress: enqueue,
    operations(orgId) {
      const jobs = queue.all().filter((j) => j.org_id === orgId),
        counts = {};
      for (const job of jobs) counts[job.state] = (counts[job.state] || 0) + 1;
      return {
        ready: recovered && storageReady(),
        checks: {
          queue: recovered,
          audit: storageReady(),
          workerLeases: jobs
            .filter((j) => j.state === "RUNNING")
            .every((j) => j.lease_until >= Date.now()),
        },
        mode: "durable-subprocess-workers",
        workerConcurrency: config.workerConcurrency || 1,
        leaseMs,
        counts,
        workers: jobs
          .filter((j) => j.state === "RUNNING")
          .map((j) => ({
            runId: j.run_id,
            heartbeat: j.heartbeat,
            leaseUntil: j.lease_until,
            deadline: j.deadline,
            maxCalls: j.max_calls,
          })),
        cleanupPending: state.runs.filter(
          (r) =>
            r.orgId === orgId &&
            r.runtimeResources?.length &&
            r.runtimeReport?.cleanup?.status !== "REMOVED",
        ).length,
      };
    },
    async close() {
      closing = true;
      clearInterval(timer);
      await recovery;
      for (const entry of children.values()) {
        killWorker(entry.child);
        await failed(
          entry,
          "Broker shutdown interrupted execution. Partial evidence was preserved.",
        );
      }
      await Promise.allSettled([...settling]);
    },
  };
}
