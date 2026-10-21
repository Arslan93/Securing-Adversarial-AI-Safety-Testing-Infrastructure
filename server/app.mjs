import { inspectAcceptance } from "./pilot-acceptance.mjs";
import {
  secureHeaders,
  requirePilotTransport,
  createRequestLimiter,
} from "./hardening.mjs";
import { createPilotRoutes } from "./routes/pilot.mjs";
import { createCollaborationRoutes } from "./routes/collaboration.mjs";
import { createDraftRoutes } from "./routes/drafts.mjs";
import { createOidc } from "./oidc.mjs";
import { createEvidenceClient } from "./evidence/client.mjs";
import { createContainerRuntime } from "./runtime/docker.mjs";
import http from "node:http";
import { createStore } from "./store.mjs";
import { createAuth } from "./auth.mjs";
import { createExecutionBroker } from "./execution/broker.mjs";
import { acquireBrokerLock } from "./execution/lock.mjs";
import { createDatasetRoutes } from "./routes/datasets.mjs";
import { createRegistryRoutes } from "./routes/registry.mjs";
import { createRunsRoutes } from "./routes/runs.mjs";
import { readBody, json, serveStatic } from "./http.mjs";
import { publicConfig } from "./config.mjs";
export function createApplication(config) {
  const releaseLock = acquireBrokerLock(config.dbPath);
  let store, evidence, auth, oidc, runtime, orchestrator;
  try {
    store = createStore(config.dbPath);
    evidence = createEvidenceClient(config);
    auth = createAuth({ ...store, config });
    oidc = createOidc({ ...store, config, auth });
    runtime = createContainerRuntime({ ...store, config });
    orchestrator = createExecutionBroker({ ...store, config, runtime });
  } catch (error) {
    auth?.close();
    store?.close();
    releaseLock();
    throw error;
  }
  const deps = {
    ...store,
    ...auth,
    ...orchestrator,
    config,
    runtime,
    evidence,
  };
  const routes = [
    createPilotRoutes(deps),
    createDraftRoutes(deps),
    createCollaborationRoutes(deps),
    createDatasetRoutes(deps),
    createRegistryRoutes(deps),
    createRunsRoutes(deps),
  ];
  let closing = false;
  const admit = createRequestLimiter();
  const server = http.createServer(async (req, res) => {
    try {
      secureHeaders(res, config);
      if (!config.hosts.includes(req.headers.host))
        return json(res, 403, { error: "Host denied" });
      const url = new URL(req.url, "http://localhost");
      req.clientAddress = requirePilotTransport(req, url, config);
      if (
        url.pathname.startsWith("/api/") &&
        !url.pathname.startsWith("/api/health/") &&
        !admit(req.clientAddress)
      ) {
        res.setHeader("Retry-After", "60");
        return json(res, 429, {
          error: "Request limit reached. Retry in a minute.",
        });
      }
      if (!url.pathname.startsWith("/api/"))
        return serveStatic(req, res, url, config);
      if (
        req.method !== "GET" &&
        req.headers.origin &&
        !config.origins.includes(req.headers.origin)
      )
        return json(res, 403, { error: "Origin denied" });
      if (url.pathname === "/api/health/live" && req.method === "GET")
        return json(res, closing ? 503 : 200, {
          status: closing ? "stopping" : "alive",
        });
      if (url.pathname === "/api/health/ready" && req.method === "GET") {
        let storage = false;
        try {
          storage = store.ready();
        } catch {}
        let signingReady = true;
        if (config.requireSignedEvidence) {
          try {
            signingReady = (await evidence.status()).ready;
          } catch {
            signingReady = false;
          }
        }
        let acceptanceReady = true;
        if (config.pilotMode) {
          try {
            acceptanceReady = inspectAcceptance(
              config.pilotAcceptanceFile,
              config.publicOrigin,
            ).ready;
          } catch {
            acceptanceReady = false;
          }
        }
        const ready =
          !closing &&
          acceptanceReady &&
          storage &&
          (config.demoAuth || oidc.enabled) &&
          orchestrator.recoveryReady() &&
          signingReady;
        return json(res, ready ? 200 : 503, {
          status: ready ? "ready" : "not-ready",
          checks: {
            storage,
            authentication: config.demoAuth || oidc.enabled,
            runtimeRecovery: orchestrator.recoveryReady(),
            evidenceSigner: signingReady,
            ...(config.pilotMode ? { pilotAcceptance: acceptanceReady } : {}),
          },
          modelProvider: "checked-separately",
          isolation: "unverified",
        });
      }
      if (url.pathname === "/api/config" && req.method === "GET")
        return json(res, 200, publicConfig(config));
      if (url.pathname === "/api/session" && req.method === "GET") {
        const current = auth.session(req);
        return json(res, 200, {
          authenticated: !!current,
          role: current?.role || null,
          csrf: current?.csrf,
          setupRequired: !store.identity.count(),
          user: current?.user,
        });
      }
      if (closing)
        return json(res, 503, {
          error: "The API is shutting down. Retry after it restarts.",
        });
      if (url.pathname === "/api/oidc/callback" && req.method === "GET")
        return await oidc.callback(req, res, url);
      const body = await readBody(req);
      if (url.pathname === "/api/oidc/start" && req.method === "POST")
        return await oidc.begin(res, null);
      if (url.pathname === "/api/login" && req.method === "POST")
        return await auth.login(res, body, req);
      if (url.pathname === "/api/invitations/register" && req.method === "POST")
        return await auth.registerInvitation(res, body);
      if (url.pathname === "/api/login/mfa" && req.method === "POST")
        return await auth.verifyMfa(res, body);
      if (url.pathname === "/api/setup" && req.method === "POST")
        return await auth.setup(res, body);
      const current = auth.session(req);
      if (!current)
        return json(res, 401, {
          error: "Your session has expired. Sign in again to continue.",
          code: "SESSION_EXPIRED",
        });
      if (req.method !== "GET" && req.headers["x-csrf-token"] !== current.csrf)
        return json(res, 403, {
          error: "Session security token is missing. Reload and try again.",
        });
      if (url.pathname === "/api/logout" && req.method === "POST")
        return auth.logout(res, current);
      await store.access.enter(current, async () => {
        if (
          url.pathname === "/api/account/oidc/connect" &&
          req.method === "POST"
        ) {
          await auth.reauthenticate(current, body);
          return await oidc.begin(res, current);
        }
        if (await auth.securityRoutes({ url, req, res, body, current })) return;
        if (await auth.accountRoutes({ url, req, res, body, current })) return;
        const selected =
          body.workspaceId ||
          url.searchParams.get("workspaceId") ||
          store.state.workspaces[0]?.id;
        if (selected) store.access.assertWorkspace(selected);
        current.workspaceId = selected;
        for (const route of routes)
          if (await route({ url, req, res, body, role: current.role, current }))
            return;
        json(res, 404, { error: "Endpoint not found" });
      });
    } catch (e) {
      json(res, e.status || 400, { error: e.message });
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 5000;
  server.keepAliveTimeout = 5000;
  server.maxRequestsPerSocket = 100;
  let closePromise;
  function close() {
    return (closePromise ??= (async () => {
      closing = true;
      await orchestrator.close();
      auth.close();
      if (server.listening)
        await new Promise((resolve, reject) =>
          server.close((e) => (e ? reject(e) : resolve())),
        );
      store.close();
      releaseLock();
    })());
  }

  return { server, close };
}
