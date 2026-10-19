import http from "node:http";
import { DatabaseSync } from "node:sqlite";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, existsSync } from "node:fs";
import { resolve, extname } from "node:path";
import {
  digest,
  chainEvent,
  verifyEvidence,
  cases,
  evaluate,
  evidenceResults,
} from "./core.mjs";
import { listModels, evaluateOllama } from "./ollama.mjs";
mkdirSync(".data", { recursive: true });
const db = new DatabaseSync(process.env.BAYORA_DB || ".data/bayora.db");
db.exec(
  "PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY, json TEXT NOT NULL)",
);
const seed = {
  workspaces: [
    {
      id: "ws-research",
      name: "Research workspace",
      purpose: "Controlled synthetic model evaluation",
      ttl: 30,
      classification: "Synthetic",
      network: "Deny all egress",
    },
  ],
  policies: [
    {
      id: "pol-1",
      version: 1,
      name: "Default safety policy",
      rules: [
        "Block instruction overrides",
        "Protect private context",
        "Reject role impersonation",
      ],
      createdAt: new Date().toISOString(),
    },
  ],
  runs: [],
  events: [],
};
let state = JSON.parse(
  db.prepare("SELECT json FROM state WHERE id=1").get()?.json ||
    JSON.stringify(seed),
);
state.reviews ??= [];
const save = () =>
  db
    .prepare("INSERT OR REPLACE INTO state VALUES (1,?)")
    .run(JSON.stringify(state));
const audit = (type, data) => {
  state.events.push(chainEvent(state.events, type, data));
  save();
};
if (!state.events.length)
  audit("workspace.created", {
    workspace: "ws-research",
    mode: "synthetic-demo",
  });
const publicManifest = (snapshot) => ({
  ...snapshot,
  policy: {
    id: snapshot.policy.id,
    name: snapshot.policy.name,
    version: snapshot.policy.version,
    digest: digest(snapshot.policy),
  },
});
const sessions = new Map(),
  roles = ["Admin", "Red", "Blue", "Analyst", "Auditor"];
const controllers = new Map();
const active = new Set([
  "VALIDATING",
  "QUEUED",
  "PROVISIONING",
  "RUNNING",
  "EVALUATING",
  "FINALIZING",
]);
for (const run of state.runs)
  if (active.has(run.status)) {
    run.status = "FAILED";
    run.validity = "UNVERIFIED";
    run.cleanup = "No runtime resources allocated (demo)";
    audit("run.interrupted", {
      runId: run.id,
      verdict: run.validity,
      resultsHash: digest(evidenceResults(run.results)),
    });
  }
const json = (res, status, data) => {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(JSON.stringify(data));
};
function permit(role, allowed) {
  if (!allowed.includes(role)) {
    audit("authorization.denied", { role, action: "restricted operation" });
    throw Object.assign(
      Error(
        "Access denied: this resource belongs to a different test role or workspace.",
      ),
      { status: 403 },
    );
  }
}
function summary(run) {
  const { snapshot, results, ...rest } = run;
  return {
    ...rest,
    model: snapshot.model,
    policyVersion: snapshot.policy.version,
    total: 20,
    completed: results?.length || 0,
    baseline: results?.filter((r) => r.baseline === "Violation").length || 0,
    defended: results?.filter((r) => r.defended === "Violation").length || 0,
    manifestHash: digest(publicManifest(snapshot)),
    mode: snapshot.mode,
  };
}
function progress(id, index = 0) {
  const stages = [
    "QUEUED",
    "PROVISIONING",
    "RUNNING",
    "EVALUATING",
    "FINALIZING",
    "COMPLETED",
  ];
  setTimeout(() => {
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
    audit("run." + run.status.toLowerCase(), {
      runId: id,
      ...(run.status === "COMPLETED"
        ? {
            verdict: run.validity,
            resultsHash: digest(evidenceResults(run.results)),
          }
        : {}),
    });
    if (index < stages.length - 1) progress(id, index + 1);
  }, 1000);
}
async function liveProgress(id) {
  const run = state.runs.find((r) => r.id === id);
  const controller = new AbortController();
  controllers.set(id, controller);
  const deadline = setTimeout(
    () => controller.abort(Error("Workspace TTL exceeded")),
    run.snapshot.workspace.ttl * 60000,
  );
  const setStage = (status) => {
    if (!active.has(run.status)) throw Error("Run is no longer active");
    run.status = status;
    run.timeline.push({ status, time: new Date().toISOString() });
    audit("run." + status.toLowerCase(), { runId: id });
  };
  try {
    setStage("QUEUED");
    setStage("PROVISIONING");
    const models = await listModels();
    if (
      !models.some(
        (m) =>
          m.id === run.snapshot.model && m.digest === run.snapshot.modelDigest,
      )
    )
      throw Error("Model revision changed after configuration was frozen");
    setStage("RUNNING");
    await evaluateOllama(run.snapshot, {
      signal: AbortSignal.any([
        controller.signal,
        AbortSignal.timeout(60000 * run.snapshot.workspace.ttl),
      ]),
      corpus: cases,
      runId: id,
      onResult: (result) => {
        if (!active.has(run.status)) throw Error("Run stopped");
        run.results.push(result);
        audit("attempt.paired", {
          runId: id,
          caseId: result.id,
          correlationId: randomUUID(),
          outputHashes: result.outputHashes,
        });
      },
    });
    setStage("EVALUATING");
    setStage("FINALIZING");
    run.validity = "UNVERIFIED";
    run.status = "COMPLETED";
    run.finishedAt = new Date().toISOString();
    run.timeline.push({ status: "COMPLETED", time: run.finishedAt });
    run.cleanup =
      "Requests ended. No per-run containers allocated; shared model runtime remains running.";
    audit("run.completed", {
      runId: id,
      verdict: run.validity,
      resultsHash: digest(evidenceResults(run.results)),
    });
  } catch (e) {
    if (active.has(run.status)) {
      run.status = "FAILED";
      run.validity = "UNVERIFIED";
      run.error = e.message;
      run.cleanup =
        "Pending model requests aborted. No per-run containers allocated.";
      run.timeline.push({ status: "FAILED", time: new Date().toISOString() });
      audit("run.failed", {
        runId: id,
        reason: e.message,
        verdict: run.validity,
        resultsHash: digest(evidenceResults(run.results)),
      });
    }
  } finally {
    clearTimeout(deadline);
    controllers.delete(id);
  }
}
const server = http.createServer(async (req, res) => {
  try {
    if (
      ![
        "127.0.0.1:3001",
        "127.0.0.1:5173",
        "localhost:3001",
        "localhost:5173",
        `127.0.0.1:${process.env.PORT || 3001}`,
        `localhost:${process.env.PORT || 3001}`,
      ].includes(req.headers.host)
    )
      return json(res, 403, { error: "Host denied" });
    const url = new URL(req.url, "http://localhost");
    if (!url.pathname.startsWith("/api/")) {
      const path = resolve("dist", "." + decodeURIComponent(url.pathname));
      const root = resolve("dist");
      if (!path.startsWith(root + "/") && path !== root)
        return json(res, 403, { error: "Forbidden" });
      const file =
        existsSync(path) && extname(path) ? path : resolve("dist/index.html");
      if (!existsSync(file))
        return json(res, 404, {
          error: "Run npm run dev or npm run build first.",
        });
      res.setHeader(
        "Content-Type",
        {
          ".html": "text/html",
          ".js": "text/javascript",
          ".css": "text/css",
          ".svg": "image/svg+xml",
          ".png": "image/png",
        }[extname(file)] || "application/octet-stream",
      );
      return res.end(readFileSync(file));
    }
    if (
      req.method !== "GET" &&
      req.headers.origin &&
      ![
        "http://127.0.0.1:5173",
        "http://localhost:5173",
        "http://127.0.0.1:3001",
        "http://localhost:3001",
      ].includes(req.headers.origin)
    )
      return json(res, 403, { error: "Origin denied" });
    let body = {};
    if (req.method !== "GET") {
      let raw = "";
      for await (const chunk of req) {
        raw += chunk;
        if (raw.length > 1000000)
          throw Object.assign(Error("Request too large"), { status: 413 });
      }
      body = raw ? JSON.parse(raw) : {};
    }
    if (url.pathname === "/api/login" && req.method === "POST") {
      if (!roles.includes(body.role))
        return json(res, 400, { error: "Select a valid demo role" });
      const token = randomBytes(32).toString("hex");
      sessions.set(token, { role: body.role, expires: Date.now() + 3600000 });
      res.setHeader(
        "Set-Cookie",
        `bayora_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=3600`,
      );
      audit("session.created", { role: body.role, mode: "local-demo" });
      return json(res, 200, { role: body.role });
    }
    const token = req.headers.cookie
      ?.split("; ")
      .find((x) => x.startsWith("bayora_session="))
      ?.split("=")[1];
    const session = sessions.get(token);
    if (!session || session.expires < Date.now())
      return json(res, 401, {
        error: "Sign in to the local demo to continue.",
      });
    const role = session.role;
    if (url.pathname === "/api/logout") {
      sessions.delete(token);
      res.setHeader(
        "Set-Cookie",
        "bayora_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0",
      );
      return json(res, 200, { ok: true });
    }
    if (url.pathname === "/api/state" && req.method === "GET")
      return json(res, 200, {
        role,
        workspaces: state.workspaces,
        policies: state.policies.map(({ rules, ...p }) => ({
          ...p,
          digest: digest({ rules, ...p }),
          ...(role === "Admin" || role === "Blue" ? { rules } : {}),
        })),
        runs: state.runs.map(summary),
        events: state.events.slice(-12).reverse(),
        caseCount: cases.length,
      });
    if (url.pathname === "/api/models") {
      permit(role, ["Admin", "Analyst"]);
      try {
        return json(res, 200, { models: await listModels(), available: true });
      } catch {
        return json(res, 200, {
          models: [],
          available: false,
          message: "Local Ollama is not responding on 127.0.0.1:11434.",
        });
      }
    }
    if (url.pathname === "/api/cases") {
      permit(role, ["Admin", "Red"]);
      return json(res, 200, { cases });
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
      };
      state.policies.push(p);
      audit("policy.published", { policyId: p.id, digest: digest(p) });
      return json(res, 201, p);
    }
    if (url.pathname === "/api/runs" && req.method === "POST") {
      permit(role, ["Admin", "Analyst"]);
      if (
        typeof body.requestKey !== "string" ||
        body.requestKey.length < 4 ||
        body.requestKey.length > 100
      )
        throw Error("An idempotency key is required.");
      const previous = state.runs.find((r) => r.requestKey === body.requestKey);
      if (previous && body.requestKey) return json(res, 200, summary(previous));
      const ws = state.workspaces.find((w) => w.id === body.workspaceId),
        policy = state.policies.find((p) => p.id === body.policyId);
      if (!ws || !policy || !body.name?.trim())
        throw Error("Name, workspace and published policy are required.");
      if (state.runs.filter((r) => active.has(r.status)).length >= 2)
        throw Error(
          "Concurrency limit reached. Wait for an active run to finish.",
        );
      let model = null;
      if (body.mode === "ollama") {
        if (body.localConsent !== true)
          throw Error("Local inference consent is required.");
        model = (await listModels()).find((m) => m.id === body.model);
        if (!model) throw Error("Select an installed local model.");
      }
      const snapshot = structuredClone({
        workspace: ws,
        policy,
        datasetHash: digest(cases),
        model: model?.id || "Bayora synthetic adapter v1",
        modelDigest: model?.digest || digest("synthetic-v1"),
        evaluator: model ? "exact-canary-v1" : "fixture-rubric-v1",
        temperature: 0,
        seed: 42,
        maxTokens: 128,
        adapter: model ? "ollama-chat-v1" : "fixture-v1",
        mode: model ? "ollama" : "synthetic-demo",
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
        timeline: [{ status: "VALIDATING", time: new Date().toISOString() }],
        validity: "PENDING",
        parentId: body.parentId || null,
      };
      state.runs.unshift(run);
      audit("run.created", {
        runId: run.id,
        manifestHash: digest(publicManifest(snapshot)),
      });
      if (model) liveProgress(run.id);
      else progress(run.id);
      return json(res, 201, summary(run));
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
      /^\/api\/runs\/([^/]+)(?:\/(cancel|export))?$/,
    );
    if (match) {
      const run = state.runs.find((r) => r.id === match[1]);
      if (!run) return json(res, 404, { error: "Run not found" });
      if (match[2] === "cancel" && req.method === "POST") {
        permit(role, ["Admin", "Analyst"]);
        if (!active.has(run.status))
          throw Error("Terminal runs are immutable.");
        run.status = "CANCELLED";
        run.validity =
          run.snapshot.mode === "ollama" ? "UNVERIFIED" : "DEMO_ONLY";
        run.cleanup =
          run.snapshot.mode === "ollama"
            ? "Pending model requests cancelled. Shared runtime remains active."
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
        });
        return json(res, 200, summary(run));
      }
      if (match[2] === "export") {
        if (active.has(run.status))
          throw Error(
            "Evidence not finalized. Export is disabled until finalization.",
          );
        const pack = {
          format: "bayora-evidence-v1",
          runId: run.id,
          verdict: run.validity,
          resultsHash: digest(evidenceResults(run.results)),
          manifest: publicManifest(run.snapshot),
          manifestHash: digest(publicManifest(run.snapshot)),
          events: state.events,
          anchor: state.events.at(-1).hash,
          results: evidenceResults(run.results),
          qualification:
            "Local prototype. Hash consistency is not an independently anchored integrity proof.",
        };
        return json(res, 200, pack);
      }
      return json(res, 200, {
        ...summary(run),
        timeline: run.timeline,
        results: ["Admin", "Red", "Analyst"].includes(role)
          ? run.results
          : evidenceResults(run.results),
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
        return json(res, 200, verifyEvidence(body));
      } catch (e) {
        return json(res, 200, { valid: false, error: e.message });
      }
    }
    json(res, 404, { error: "Endpoint not found" });
  } catch (e) {
    json(res, e.status || 400, { error: e.message });
  }
});
server.listen(Number(process.env.PORT || 3001), "127.0.0.1", () =>
  console.log(
    "Bayora local API: http://127.0.0.1:" + (process.env.PORT || 3001),
  ),
);
