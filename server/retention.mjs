import { randomUUID } from "node:crypto";
import { digest, evidenceResults, evidenceAttempts } from "./core.mjs";
import { publicManifest } from "./presenters.mjs";
import { ACTIVE_STATUSES } from "./lifecycle.mjs";
export function retentionScope(state, orgId, workspaceId) {
  const workspace = state.workspaces.find(
    (w) => w.orgId === orgId && w.id === workspaceId,
  );
  if (!workspace)
    throw Object.assign(Error("Workspace not found."), { status: 404 });
  const runs = state.runs.filter(
    (r) => r.orgId === orgId && r.workspaceId === workspaceId,
  );
  const datasets = state.datasets.filter(
    (d) => d.orgId === orgId && d.workspaceId === workspaceId,
  );
  const policies = state.policies.filter(
    (p) => p.orgId === orgId && p.workspaceId === workspaceId,
  );
  const fingerprint = digest({
    workspace,
    runs: runs.map((r) => ({
      id: r.id,
      status: r.status,
      events: state.runEvents[r.id]?.at(-1)?.hash,
    })),
    datasets,
    policies,
    drafts: state.drafts.filter(
      (d) => d.orgId === orgId && d.workspaceId === workspaceId,
    ),
  });
  return { workspace, runs, datasets, policies, fingerprint };
}
function allowed(scope, pilot, queue) {
  if (pilot.hold(scope.workspace.orgId, scope.workspace.id)?.held)
    throw Object.assign(Error("Retention hold prevents removal."), {
      status: 409,
    });
  if (scope.workspace.retired)
    throw Object.assign(Error("Workspace is already retired."), {
      status: 409,
    });
  if (
    scope.runs.some(
      (r) =>
        ACTIVE_STATUSES.has(r.status) ||
        ["RESERVED", "READY", "RUNNING", "CLEANUP"].includes(
          queue.get(r.id)?.state,
        ) ||
        (r.runtimeResources?.length &&
          r.runtimeReport?.cleanup?.status !== "REMOVED"),
    )
  )
    throw Object.assign(
      Error("Finish executions and verify cleanup before removal."),
      { status: 409 },
    );
}
export function planRetention({
  state,
  pilot,
  queue,
  orgId,
  userId,
  workspaceId,
}) {
  const scope = retentionScope(state, orgId, workspaceId);
  allowed(scope, pilot, queue);
  const plan = {
    id: randomUUID(),
    orgId,
    userId,
    workspaceId,
    fingerprint: scope.fingerprint,
    expires: Date.now() + 15 * 60000,
    consumed: false,
    counts: {
      runs: scope.runs.length,
      datasets: scope.datasets.length,
      policies: scope.policies.length,
    },
    confirmation: scope.workspace.name,
  };
  state.retentionPlans ??= [];
  state.retentionPlans = state.retentionPlans.filter(
    (p) => !p.consumed && p.expires > Date.now(),
  );
  state.retentionPlans.push(plan);
  return plan;
}
export function applyRetention({
  state,
  pilot,
  queue,
  orgId,
  userId,
  planId,
  confirmation,
}) {
  const plan = state.retentionPlans?.find(
    (p) =>
      p.id === planId &&
      p.orgId === orgId &&
      p.userId === userId &&
      !p.consumed &&
      p.expires > Date.now(),
  );
  if (!plan)
    throw Object.assign(
      Error("Removal plan expired or unavailable. Create a new plan."),
      { status: 409 },
    );
  const scope = retentionScope(state, orgId, plan.workspaceId);
  allowed(scope, pilot, queue);
  if (
    confirmation !== scope.workspace.name ||
    scope.fingerprint !== plan.fingerprint
  )
    throw Object.assign(
      Error(
        "Workspace changed or confirmation does not match. Review a new removal plan.",
      ),
      { status: 409 },
    );
  const now = new Date().toISOString(),
    artifactIds = new Set(
      [...scope.datasets, ...scope.policies].map((v) => v.id),
    );
  for (const run of scope.runs) {
    const manifest = structuredClone(publicManifest(run.snapshot));
    run.snapshot = {
      ...manifest,
      policy: {
        id: manifest.policy.id,
        name: manifest.policy.name,
        version: manifest.policy.version,
        rules: [],
      },
      ...(manifest.dataset
        ? { dataset: { ...manifest.dataset, cases: [] } }
        : {}),
      evidenceManifest: manifest,
    };
    run.results = evidenceResults(run.results);
    run.attempts = evidenceAttempts(run.attempts);
    run.contentPurgedAt = now;
  }
  for (const review of state.reviews.filter((r) =>
    scope.runs.some((run) => run.id === r.runId),
  )) {
    delete review.reason;
    review.reasonRedacted = true;
  }
  for (const kind of ["datasets", "policies", "drafts"])
    state[kind] = state[kind].filter(
      (v) => v.orgId !== orgId || v.workspaceId !== scope.workspace.id,
    );
  state.grants = state.grants.filter(
    (g) => g.orgId !== orgId || !artifactIds.has(g.resourceId),
  );
  state.accessRequests = (state.accessRequests || []).filter(
    (r) => r.orgId !== orgId || !artifactIds.has(r.resourceId),
  );
  scope.workspace.retired = true;
  scope.workspace.retiredAt = now;
  plan.consumed = true;
  return {
    workspaceId: scope.workspace.id,
    retiredAt: now,
    counts: plan.counts,
    qualification:
      "Private content removed from application state. Public manifests/audit metadata, organization-shared artifacts and operator-managed backups remain.",
  };
}
