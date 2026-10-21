import { checkExecutionPolicy } from "../pilot.mjs";
import { interruptAttempt } from "../execution/attempts.mjs";
import { randomUUID } from "node:crypto";
import {
  digest,
  cases,
  evidenceResults,
  evidenceAttempts,
  verifyEvidence,
} from "../core.mjs";
import { summary, publicManifest } from "../presenters.mjs";
import { listModels } from "../ollama.mjs";
import { ACTIVE_STATUSES as active } from "../lifecycle.mjs";
import { datasetMetadata, SEED_DATASET_ID } from "../datasets.mjs";
import { json } from "../http.mjs";
import { campaignConfiguration, editableDraft } from "../drafts.mjs";
import { createReport } from "../reports.mjs";
export function createRunsRoutes({
  state,
  allState,
  audit,
  permit,
  config,
  progress,
  liveProgress,
  controllers,
  access,
  revalidate,
  runtime,
  recovery,
  evidence,
  queue,
  pilot,
}) {
  return async function ({ url, req, res, body, role, current }) {
    if (url.pathname === "/api/runs" && req.method === "POST") {
      permit(role, ["Admin", "Analyst"]);
      await recovery;
      if (
        typeof body.requestKey !== "string" ||
        body.requestKey.length < 4 ||
        body.requestKey.length > 100
      )
        throw Error("An idempotency key is required.");
      const previous = state.runs.find(
        (r) =>
          r.requestKey === body.requestKey &&
          r.ownerId === current.userId &&
          r.workspaceId ===
            (body.workspaceId ||
              state.drafts.find((d) => d.id === body.draftId)?.workspaceId),
      );
      if (previous && body.requestKey) return json(res, 200, summary(previous));
      let draft;
      if (body.draftId) {
        draft = editableDraft(state, body.draftId, body.draftVersion);
        body = { ...body, ...campaignConfiguration(draft, state) };
      }
      const ws = state.workspaces.find((w) => w.id === body.workspaceId),
        policy = state.policies.find((p) => p.id === body.policyId);
      if (
        !ws ||
        ws.retired ||
        !policy ||
        (policy.workspaceId && policy.workspaceId !== ws.id) ||
        !body.name?.trim()
      )
        throw Error("Name, workspace and published policy are required.");
      if (
        allState.runs.filter(
          (r) =>
            active.has(r.status) ||
            (r.runtimeResources?.length &&
              r.runtimeReport?.cleanup?.status !== "REMOVED"),
        ).length >= config.maxActiveRuns
      )
        throw Error(
          "Concurrency limit reached. Wait for an active run to finish.",
        );
      if (
        body.mode &&
        !["ollama", "synthetic-demo", "container-ollama"].includes(body.mode)
      )
        throw Error("Unsupported model adapter.");
      checkExecutionPolicy({
        config,
        pilot,
        orgId: current.orgId,
        mode: body.mode,
      });
      let model = null;
      const isolated = body.mode === "container-ollama";
      if (body.mode === "ollama" || isolated) {
        if (body.localConsent !== true)
          throw Error("Local inference consent is required.");
        const available = isolated
          ? (await runtime.models()).models
          : await listModels({ origin: config.ollamaOrigin });
        model = available.find((m) => m.id === body.model);
        if (!model)
          throw Error(
            isolated
              ? "Container runtime is unavailable or its approved model is not configured. Check Administration → Runtime readiness."
              : "Select an installed local model.",
          );
      }
      revalidate(current);
      checkExecutionPolicy({
        config,
        pilot,
        orgId: current.orgId,
        mode: body.mode,
        model,
      });
      // Model discovery yields: re-check duplicate submissions and capacity before reserving a run.
      const existing = state.runs.find(
        (r) =>
          r.requestKey === body.requestKey &&
          r.ownerId === current.userId &&
          r.workspaceId ===
            (body.workspaceId ||
              state.drafts.find((d) => d.id === body.draftId)?.workspaceId),
      );
      if (existing) return json(res, 200, summary(existing));
      if (draft) editableDraft(state, draft.id, body.draftVersion);
      if (
        allState.runs.filter(
          (r) =>
            active.has(r.status) ||
            (r.runtimeResources?.length &&
              r.runtimeReport?.cleanup?.status !== "REMOVED"),
        ).length >= config.maxActiveRuns
      )
        throw Error("Concurrency limit reached.");
      const dataset = state.datasets.find(
        (d) => d.id === (body.datasetId || state.datasets[0]?.id),
      );
      if (!dataset || (dataset.workspaceId && dataset.workspaceId !== ws.id))
        throw Error("Select a dataset available in this workspace.");
      if (
        body.parentId &&
        !state.runs.some(
          (r) => r.id === body.parentId && r.workspaceId === ws.id,
        )
      )
        throw Error("Parent run unavailable.");
      const execution = {
        deadline: Date.now() + ws.ttl * 60000,
        maxCalls: model ? dataset.cases.length * 2 : 0,
        reservationLimit: config.maxActiveRuns,
        attemptNumber: body.parentId
          ? (state.runs.find((r) => r.id === body.parentId)?.execution
              ?.attemptNumber || 1) + 1
          : 1,
      };
      const snapshot = structuredClone({
        workspace: ws,
        execution: {
          deadline: execution.deadline,
          maxCalls: execution.maxCalls,
          attemptNumber: execution.attemptNumber,
        },
        policy,
        datasetHash: dataset.digest,
        dataset: { ...datasetMetadata(dataset), cases: dataset.cases },
        model: model?.id || "Bayora synthetic adapter v1",
        modelDigest: model?.digest || digest("synthetic-v1"),
        evaluator: model ? "random-canary-utility-v2" : "fixture-rubric-v2",
        temperature: 0,
        seed: 42,
        maxTokens: 128,
        adapter: isolated
          ? "docker-ollama-v1"
          : model
            ? "ollama-chat-v2"
            : "fixture-v2",
        ...(isolated
          ? {
              runtime: {
                kind: "container",
                profile: "bayora-container-v1",
                workerImage: config.runtimeWorkerImage,
                modelImage: config.runtimeModelImage,
                modelVolume: config.runtimeModelVolume,
                memoryMb: config.runtimeMemoryMb,
                network: "none",
                user: "65532:65532",
              },
            }
          : {}),
        mode: model ? "ollama" : "synthetic-demo",
        ...(body.parentId ? { lineage: { parentId: body.parentId } } : {}),
      });
      const run = {
        id: randomUUID(),
        name: body.name.trim().slice(0, 100),
        workspaceId: ws.id,
        requestKey: body.requestKey,
        status: "VALIDATING",
        createdAt: new Date().toISOString(),
        snapshot,
        results: [],
        attempts: [],
        timeline: [{ status: "VALIDATING", time: new Date().toISOString() }],
        validity: "PENDING",
        parentId: body.parentId || null,
        execution,
      };
      state.runs.unshift(run);
      audit("run.created", {
        runId: run.id,
        manifestHash: digest(publicManifest(snapshot)),
      });
      if (draft) {
        draft.status = "LAUNCHED";
        draft.runId = run.id;
        draft.version++;
        draft.updatedAt = new Date().toISOString();
        audit("draft.launched", {
          draftId: draft.id,
          launchedRunId: run.id,
          workspaceId: ws.id,
          version: draft.version,
        });
      }
      if (evidence.enabled || evidence.requireSignature) {
        try {
          await evidence.register({
            runId: run.id,
            orgId: run.orgId,
            workspaceId: run.workspaceId,
            manifestHash: digest(publicManifest(snapshot)),
            event: state.runEvents[run.id][0],
          });
        } catch {
          run.status = "FAILED";
          run.validity = model ? "UNVERIFIED" : "DEMO_ONLY";
          run.error =
            "Evidence signer registration failed; execution did not start.";
          audit("run.failed", {
            runId: run.id,
            verdict: run.validity,
            resultsHash: digest([]),
            attemptsHash: digest([]),
          });
          queue.finish(run.id);
          return json(res, 503, { error: run.error, runId: run.id });
        }
      }
      if (model) liveProgress(run.id);
      else progress(run.id);
      return json(res, 201, summary(run));
    }
    const cleanupMatch = url.pathname.match(/^\/api\/runs\/([^/]+)\/cleanup$/);
    if (cleanupMatch && req.method === "POST") {
      permit(role, ["Admin", "Analyst"]);
      const run = state.runs.find((r) => r.id === cleanupMatch[1]);
      if (!run) return json(res, 404, { error: "Run not found" });
      if (
        active.has(run.status) ||
        !run.runtimeResources?.length ||
        run.runtimeReport?.status === "PROVISIONING" ||
        run.runtimeReport?.status === "PROFILE_CHECKED"
      )
        throw Error("Wait for the run and its initial cleanup to finish.");
      const receipt = await runtime.cleanup(run.id, run.runtimeResources);
      run.runtimeReport = {
        ...run.runtimeReport,
        status: receipt.status === "REMOVED" ? "CLEANED" : "CLEANUP_FAILED",
        cleanup: receipt,
      };
      run.cleanup =
        receipt.status === "REMOVED"
          ? "Per-run containers removed and absence checked."
          : "Container cleanup failed. Retry cleanup before starting more work.";
      audit("runtime.reported", {
        runId: run.id,
        runtimeHash: digest(run.runtimeReport),
      });
      if (receipt.status === "REMOVED") queue.finish(run.id);
      return json(res, 200, summary(run));
    }
    const reviewMatch = url.pathname.match(/^\/api\/runs\/([^/]+)\/reviews$/);
    if (reviewMatch && req.method === "POST") {
      permit(role, ["Admin", "Analyst"]);
      const run = state.runs.find((r) => r.id === reviewMatch[1]);
      if (!run) return json(res, 404, { error: "Run not found" });
      if (active.has(run.status))
        throw Error("Wait for run finalization before reviewing.");
      if (
        !run.results.some((r) => r.id === body.caseId) ||
        !["Safe", "Violation"].includes(body.outcome) ||
        typeof body.reason !== "string" ||
        body.reason.trim().length < 5 ||
        body.reason.length > 1000
      )
        throw Error(
          "A case, valid outcome and review reason (5–1000 characters) are required.",
        );
      const review = {
        id: randomUUID(),
        runId: run.id,
        caseId: body.caseId,
        outcome: body.outcome,
        reason: body.reason.trim(),
        role,
        time: new Date().toISOString(),
      };
      state.reviews.push(review);
      audit("finding.reviewed", {
        runId: run.id,
        caseId: body.caseId,
        outcome: body.outcome,
        reasonHash: digest(review.reason),
        reviewId: review.id,
      });
      return json(res, 201, review);
    }
    const match = url.pathname.match(
      /^\/api\/runs\/([^/]+)(?:\/(cancel|export|report))?$/,
    );
    if (match) {
      const run = state.runs.find((r) => r.id === match[1]);
      if (!run) return json(res, 404, { error: "Run not found" });
      if (match[2] === "cancel" && req.method === "POST") {
        permit(role, ["Admin", "Analyst"]);
        if (!active.has(run.status))
          throw Error("Terminal runs are immutable.");
        interruptAttempt(run);
        run.status = "CANCELLED";
        run.validity =
          run.snapshot.mode === "ollama" ? "UNVERIFIED" : "DEMO_ONLY";
        run.cleanup =
          run.snapshot.mode === "ollama"
            ? run.snapshot.runtime?.kind === "container"
              ? "Container teardown requested; waiting for absence checks."
              : "Pending model requests cancelled. Shared runtime remains active."
            : "Demo cleanup complete: no resources allocated";
        run.timeline.push({
          status: "CANCELLED",
          time: new Date().toISOString(),
        });
        controllers.get(run.id)?.abort(Error("Cancelled by operator"));
        audit("run.cancelled", {
          runId: run.id,
          verdict: run.validity,
          resultsHash: digest(evidenceResults(run.results)),
          attemptsHash: digest(evidenceAttempts(run.attempts)),
        });
        return json(res, 200, summary(run));
      }
      if (["export", "report"].includes(match[2]) && req.method === "GET") {
        await recovery;
        if (active.has(run.status))
          throw Error(
            "Evidence not finalized. Export is disabled until finalization.",
          );
        if (
          run.snapshot.runtime?.kind === "container" &&
          !["CLEANED", "CLEANUP_FAILED", "PROVISIONING_FAILED"].includes(
            run.runtimeReport?.status,
          )
        )
          throw Error(
            "Runtime cleanup is still in progress. Evidence is not finalized.",
          );
        const events =
          state.runEvents[run.id] || (role === "Admin" ? state.events : null);
        if (!events)
          return json(res, 403, {
            error:
              "Legacy global evidence archive is restricted to administrators.",
          });
        const pack = {
          format:
            run.snapshot.runtime?.kind === "container"
              ? "bayora-evidence-v3"
              : run.snapshot.dataset
                ? "bayora-evidence-v2"
                : "bayora-evidence-v1",
          ...(run.snapshot.runtime?.kind === "container"
            ? {
                runtimeReport: run.runtimeReport || null,
                runtimeHash: digest(run.runtimeReport || null),
              }
            : {}),
          attempts: evidenceAttempts(run.attempts),
          runId: run.id,
          verdict: run.validity,
          resultsHash: digest(evidenceResults(run.results)),
          attemptsHash: digest(evidenceAttempts(run.attempts)),
          manifest: publicManifest(run.snapshot),
          manifestHash: digest(publicManifest(run.snapshot)),
          events,
          anchor: events.at(-1).hash,
          results: evidenceResults(run.results),
          qualification:
            "Local prototype. Hash consistency is not an independently anchored integrity proof.",
        };
        const sealed = await evidence.seal(pack);
        return json(
          res,
          200,
          match[2] === "report"
            ? createReport(run, sealed, evidence.verify(sealed))
            : sealed,
        );
      }
      if (match[2] || req.method !== "GET")
        return json(res, 405, { error: "Method not allowed" });
      const artifactFallback = {
        orgId: run.orgId,
        workspaceId: run.workspaceId,
        ownerId: run.ownerId,
      };
      const rawAllowed =
        !run.contentPurgedAt &&
        ["Admin", "Red", "Analyst"].includes(role) &&
        access.raw(
          state.datasets.find((d) => d.id === run.snapshot.dataset?.id) ||
            artifactFallback,
        ) &&
        access.raw(
          state.policies.find((p) => p.id === run.snapshot.policy.id) ||
            artifactFallback,
        );
      return json(res, 200, {
        ...summary(run),
        timeline: run.timeline,
        rawAccess: rawAllowed,
        attempts: rawAllowed
          ? run.attempts || []
          : evidenceAttempts(run.attempts),
        results: rawAllowed ? run.results : evidenceResults(run.results),
        error: run.error,
        reviews: state.reviews
          .filter((r) => r.runId === run.id)
          .map(({ reason, ...r }) => ({
            ...r,
            ...(["Admin", "Analyst"].includes(role) ? { reason } : {}),
          })),
        snapshot: {
          model: run.snapshot.model,
          datasetHash: run.snapshot.datasetHash,
          policyHash: digest(run.snapshot.policy),
          evaluator: run.snapshot.evaluator,
        },
        cleanup: run.cleanup,
      });
    }
    if (url.pathname === "/api/verify" && req.method === "POST") {
      try {
        return json(res, 200, evidence.verify(body));
      } catch (e) {
        return json(res, 200, { valid: false, error: e.message });
      }
    }

    return false;
  };
}
