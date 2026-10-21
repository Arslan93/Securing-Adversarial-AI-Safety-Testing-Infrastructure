import { randomUUID } from "node:crypto";
import {
  digest,
  cases,
  evaluate,
  evidenceResults,
  evidenceAttempts,
} from "./core.mjs";
import { listModels, evaluateOllama } from "./ollama.mjs";
import { ACTIVE_STATUSES } from "./lifecycle.mjs";
export function createOrchestrator({
  state,
  audit,
  config,
  runtime,
  adapters = { listModels, evaluateOllama },
}) {
  let closing = false;
  const jobs = new Set();
  const timers = new Set();
  const controllers = new Map();
  const active = ACTIVE_STATUSES;
  for (const run of state.runs)
    if (active.has(run.status)) {
      run.status = "FAILED";
      run.validity = "UNVERIFIED";
      run.error =
        "The API server restarted before this run finished. Start a new evaluation; the previous record is preserved.";
      run.cleanup =
        run.snapshot.mode === "ollama"
          ? "Application work interrupted; the shared model service may still be running. No per-run containers were allocated."
          : "Fixture execution interrupted; no runtime resources were allocated.";
      audit("run.interrupted", {
        runId: run.id,
        verdict: run.validity,
        resultsHash: digest(evidenceResults(run.results)),
        attemptsHash: digest(evidenceAttempts(run.attempts)),
      });
    }
  let recovered = false;
  const recovery = (async () => {
    if (runtime)
      for (const run of state.runs.filter(
        (r) =>
          r.snapshot?.runtime?.kind === "container" &&
          r.runtimeReport?.cleanup?.status !== "REMOVED",
      )) {
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
            ? "Restart recovery removed per-run containers and checked their absence."
            : "Restart cleanup failed. Retry cleanup before starting more work.";
        audit("runtime.reported", {
          runId: run.id,
          runtimeHash: digest(run.runtimeReport),
        });
      }
    recovered = true;
  })();
  function progress(id, index = 0) {
    const stages = [
      "QUEUED",
      "PROVISIONING",
      "RUNNING",
      "EVALUATING",
      "FINALIZING",
      "COMPLETED",
    ];
    const timer = setTimeout(async () => {
      timers.delete(timer);
      const run = state.runs.find((r) => r.id === id);
      if (!run || !active.has(run.status)) return;
      run.status = stages[index];
      run.timeline.push({ status: run.status, time: new Date().toISOString() });
      if (run.status === "EVALUATING") run.results = evaluate(run.snapshot);
      if (run.status === "COMPLETED") {
        run.finishedAt = new Date().toISOString();
        run.cleanup =
          "Demo cleanup complete: no containers or credentials allocated";
        run.validity = "DEMO_ONLY";
      }
      await audit("run." + run.status.toLowerCase(), {
        runId: id,
        ...(run.status === "COMPLETED"
          ? {
              verdict: run.validity,
              resultsHash: digest(evidenceResults(run.results)),
              attemptsHash: digest(evidenceAttempts(run.attempts)),
            }
          : {}),
      });
      if (index < stages.length - 1) progress(id, index + 1);
      else config.onWorkerDone?.();
    }, config.syntheticStepMs);
    timers.add(timer);
  }
  async function executeLive(id) {
    await recovery;
    const run = state.runs.find((r) => r.id === id),
      isolated = run.snapshot.runtime?.kind === "container";
    const controller = new AbortController();
    controllers.set(id, controller);
    if (closing) controller.abort(Error("Server shutting down"));
    const deadline = setTimeout(
      () => controller.abort(Error("Workspace TTL exceeded")),
      Math.max(
        1,
        (run.execution?.deadline ||
          Date.now() + run.snapshot.workspace.ttl * 60000) - Date.now(),
      ),
    );
    let lease, error;
    const report = async (value) => {
      run.runtimeReport = value;
      await audit("runtime.reported", {
        runId: id,
        runtimeHash: digest(value),
      });
    };
    const setStage = async (status) => {
      if (!active.has(run.status)) throw Error("Run is no longer active");
      run.status = status;
      run.timeline.push({ status, time: new Date().toISOString() });
      await audit("run." + status.toLowerCase(), { runId: id });
    };
    try {
      controller.signal.throwIfAborted();
      await setStage("QUEUED");
      await setStage("PROVISIONING");
      if (isolated) {
        if (!runtime) throw Error("Container runtime is unavailable.");
        run.runtimeReport = {
          status: "PROVISIONING",
          cleanup: { status: "PENDING" },
        };
        lease = await runtime.provision(run, {
          signal: controller.signal,
          onResources: async (resources) => {
            run.runtimeResources = resources;
            await audit("runtime.allocating", {
              runId: id,
              roles: resources.map((r) => r.role),
            });
          },
          onReport: report,
        });
      } else {
        const models = await adapters.listModels({
          origin: config.ollamaOrigin,
        });
        if (
          !models.some(
            (m) =>
              m.id === run.snapshot.model &&
              m.digest === run.snapshot.modelDigest,
          )
        )
          throw Error("Model revision changed after configuration was frozen");
      }
      await setStage("RUNNING");
      await adapters.evaluateOllama(lease?.snapshot || run.snapshot, {
        signal: controller.signal,
        origin: isolated ? "http://127.0.0.1:11434" : config.ollamaOrigin,
        ...(lease ? { fetcher: lease.fetcher } : {}),
        corpus: lease?.corpus || run.snapshot.dataset?.cases || cases,
        onCanary: (canaryHash) =>
          audit("probe.created", { runId: id, canaryHash }),
        onAttemptStarted: async (attempt) => {
          run.inFlightAttempt = attempt;
          run.execution &&
            (run.execution.callsStarted =
              (run.execution.callsStarted || 0) + 1);
          await audit("attempt.started", { runId: id, ...attempt });
        },
        onAttempt: async (attempt) => {
          if (!active.has(run.status)) return;
          run.inFlightAttempt = null;
          run.attempts ??= [];
          run.attempts.push(attempt);
          await audit("attempt.completed", {
            runId: id,
            attemptId: attempt.id,
            caseId: attempt.caseId,
            arm: attempt.arm,
            status: attempt.status,
            outputHash: attempt.outputHash || null,
          });
        },
        runId: id,
        onResult: async (result) => {
          if (!active.has(run.status)) throw Error("Run stopped");
          run.results.push(result);
          await audit("attempt.paired", {
            runId: id,
            caseId: result.id,
            correlationId: randomUUID(),
            outputHashes: result.outputHashes,
          });
        },
      });
      await setStage("EVALUATING");
      await setStage("FINALIZING");
      if (run.attempts?.some((a) => a.status !== "COMPLETED"))
        error = Error(
          "One or more model attempts failed. Inspect partial attempts; failed pairs have no model-safety conclusion.",
        );
    } catch (e) {
      error = e;
    } finally {
      // Revoke gateway capabilities and remove containers before a successful terminal result.
      if (lease) {
        try {
          await lease.dispose();
        } catch {
          error ??= Error("Runtime teardown failed.");
          run.runtimeReport = {
            ...run.runtimeReport,
            status: "CLEANUP_FAILED",
            cleanup: { status: "FAILED" },
          };
          await report(run.runtimeReport);
        }
      }
      clearTimeout(deadline);
      controllers.delete(id);
      if (isolated) {
        if (
          !lease &&
          !["PROVISIONING_FAILED", "CLEANUP_FAILED"].includes(
            run.runtimeReport?.status,
          )
        )
          await report({
            profile: run.snapshot.runtime.profile,
            status: "PROVISIONING_FAILED",
            error: error?.message,
            cleanup: run.runtimeResources?.length
              ? await runtime.cleanup(id, run.runtimeResources)
              : { status: "REMOVED", resources: [] },
          });
        if (run.runtimeReport?.cleanup?.status !== "REMOVED")
          error ??= Error("Container cleanup could not be verified.");
        run.cleanup =
          run.runtimeReport?.cleanup?.status === "REMOVED"
            ? "Per-run containers removed and absence checked."
            : "Container cleanup failed. Retry cleanup before starting more work.";
      } else
        run.cleanup = error
          ? "Pending model requests aborted. Shared model runtime remains active."
          : "Requests ended. No per-run containers allocated; shared model runtime remains running.";
      if (active.has(run.status)) {
        run.status = error ? "FAILED" : "COMPLETED";
        run.validity = "UNVERIFIED";
        if (error) run.error = error.message;
        run.finishedAt = new Date().toISOString();
        run.timeline.push({ status: run.status, time: run.finishedAt });
        await audit(error ? "run.failed" : "run.completed", {
          runId: id,
          ...(error ? { reason: error.message } : {}),
          verdict: run.validity,
          resultsHash: digest(evidenceResults(run.results)),
          attemptsHash: digest(evidenceAttempts(run.attempts)),
        });
      } else if (isolated)
        await audit("runtime.finalized", {
          runId: id,
          runtimeHash: digest(run.runtimeReport || null),
        });
    }
  }

  return {
    recovery,
    recoveryReady: () => recovered,
    progress,
    liveProgress(id) {
      const job = executeLive(id);
      jobs.add(job);
      job.then(
        () => jobs.delete(job),
        () => jobs.delete(job),
      );
      return job;
    },
    controllers,
    async close() {
      closing = true;
      for (const timer of timers) clearTimeout(timer);
      for (const controller of controllers.values())
        controller.abort(Error("Server shutting down"));
      await recovery;
      await Promise.allSettled([...jobs]);
    },
  };
}
