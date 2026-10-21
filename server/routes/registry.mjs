import { randomUUID } from "node:crypto";
import { digest, cases } from "../core.mjs";
import { summary } from "../presenters.mjs";
import { listModels } from "../ollama.mjs";
import { datasetMetadata, SEED_DATASET_ID } from "../datasets.mjs";
import { json } from "../http.mjs";
export function createRegistryRoutes({
  state,
  audit,
  permit,
  config,
  access,
  identity,
  runtime,
  evidence,
  operations,
}) {
  return async function ({ url, req, res, body, role, current }) {
    if (url.pathname === "/api/state" && req.method === "GET")
      return json(res, 200, {
        role,
        evidence: {
          configured: evidence.enabled,
          required: evidence.requireSignature,
        },
        user: current.user,
        organization: identity.org(current.orgId),
        organizations: identity.orgs(current.userId),
        activeWorkspaceId: current.workspaceId,
        workspaces: state.workspaces,
        policies: state.policies.map(({ rules, ...p }) => ({
          ...p,
          digest: digest({ rules, ...p }),
          ...((role === "Admin" || role === "Blue") && access.raw(p)
            ? { rules }
            : {}),
        })),
        runs: state.runs.map(summary),
        drafts: ["Admin", "Analyst"].includes(role)
          ? state.drafts.filter((d) => d.status === "DRAFT")
          : [],
        events: (state.scopedEvents[current.orgId] || [])
          .filter((e) => {
            const run = state.runs.find((r) => r.id === e.data.runId);
            return e.data.runId
              ? !!run
              : role === "Admin" || e.data.actorId === current.userId;
          })
          .slice(-12)
          .reverse(),
        caseCount: cases.length,
        datasets: state.datasets.map(datasetMetadata),
      });
    if (url.pathname === "/api/operations" && req.method === "GET") {
      permit(role, ["Admin"]);
      return json(res, 200, operations(current.orgId));
    }
    if (url.pathname === "/api/evidence/status" && req.method === "GET") {
      try {
        return json(res, 200, await evidence.status());
      } catch {
        return json(res, 200, { enabled: evidence.enabled, ready: false });
      }
    }
    if (url.pathname === "/api/runtime" && req.method === "GET") {
      permit(role, ["Admin", "Analyst"]);
      return json(res, 200, await runtime.preflight());
    }
    if (url.pathname === "/api/models" && req.method === "GET") {
      permit(role, ["Admin", "Analyst"]);
      if (url.searchParams.get("runtime") === "container")
        return json(res, 200, await runtime.models());
      try {
        return json(res, 200, {
          models: await listModels({ origin: config.ollamaOrigin }),
          available: true,
        });
      } catch {
        return json(res, 200, {
          models: [],
          available: false,
          message:
            "Local Ollama is not responding on the configured loopback address.",
        });
      }
    }
    if (url.pathname === "/api/cases" && req.method === "GET") {
      permit(role, ["Admin", "Red"]);
      const dataset = state.datasets.find(
        (d) =>
          d.id === (url.searchParams.get("datasetId") || state.datasets[0]?.id),
      );
      if (!dataset) return json(res, 404, { error: "Dataset not found" });
      access.requireRaw(dataset);
      return json(res, 200, {
        cases: dataset.cases,
        dataset: datasetMetadata(dataset),
      });
    }
    if (url.pathname === "/api/workspaces" && req.method === "POST") {
      permit(role, ["Admin"]);
      if (
        !body.name?.trim() ||
        !Number.isInteger(body.ttl) ||
        body.ttl < 1 ||
        body.ttl > 120
      )
        throw Error("Workspace name and TTL (1–120 minutes) are required.");
      const ws = {
        id: randomUUID(),
        name: body.name.trim().slice(0, 80),
        purpose: String(body.purpose || "").slice(0, 300),
        ttl: body.ttl,
        classification: "Synthetic",
        network: "Deny all egress",
      };
      state.workspaces.push(ws);
      audit("workspace.created", { workspace: ws.id });
      return json(res, 201, ws);
    }
    if (url.pathname === "/api/policies" && req.method === "POST") {
      if (state.workspaces.find((w) => w.id === current.workspaceId)?.retired)
        throw Error("Workspace is retired.");
      permit(role, ["Admin", "Blue"]);
      if (
        !body.name?.trim() ||
        !Array.isArray(body.rules) ||
        !body.rules.length ||
        body.rules.length > 20 ||
        body.rules.some((r) => typeof r !== "string" || r.length > 300)
      )
        throw Error("A name and 1–20 bounded text rules are required.");
      const p = {
        id: randomUUID(),
        name: body.name.slice(0, 80),
        version: state.policies.length + 1,
        rules: body.rules,
        createdAt: new Date().toISOString(),
        parentId: body.basePolicyId || null,
      };
      if (
        body.basePolicyId &&
        !state.policies.some((p) => p.id === body.basePolicyId)
      )
        throw Error("Base policy not found.");
      if (body.basePolicyId)
        access.requireRaw(
          state.policies.find((p) => p.id === body.basePolicyId),
        );
      state.policies.push(p);
      audit("policy.published", { policyId: p.id, digest: digest(p) });
      return json(res, 201, p);
    }

    return false;
  };
}
