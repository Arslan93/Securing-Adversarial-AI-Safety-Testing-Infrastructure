import { inspectAcceptance } from "./pilot-acceptance.mjs";
import { secretValue } from "./secrets.mjs";
import { existsSync, lstatSync } from "node:fs";
import { resolve, dirname } from "node:path";
export function loadLocalEnv() {
  if (existsSync(".env")) process.loadEnvFile(".env");
}
export function storagePaths(env = process.env) {
  const dbPath = env.BAYORA_DB || ".data/bayora.db";
  return {
    dbPath,
    authKeyPath:
      dbPath === ":memory:"
        ? null
        : env.BAYORA_AUTH_KEY || resolve(dirname(dbPath), "auth-master.key"),
  };
}
function integer(value, fallback, name, min = 1, max = 65535) {
  const n = Number(value ?? fallback);
  if (!Number.isInteger(n) || n < min || n > max)
    throw Error(`${name} must be an integer between ${min} and ${max}.`);
  return n;
}
export function readConfig(env = process.env, { serving = true } = {}) {
  const environment = env.NODE_ENV || "development";
  for (const name of [
    "BAYORA_DEMO_AUTH",
    "BAYORA_PILOT_MODE",
    "BAYORA_CONTAINER_RUNTIME",
    "BAYORA_REQUIRE_SIGNED_EVIDENCE",
  ])
    if (env[name] && !["true", "false"].includes(env[name]))
      throw Error(`${name} must be true or false.`);
  const pilotMode = env.BAYORA_PILOT_MODE === "true",
    demoAuth = env.BAYORA_DEMO_AUTH !== "false",
    runtimeEnabled = env.BAYORA_CONTAINER_RUNTIME === "true";
  if (serving && environment === "production" && demoAuth)
    throw Error(
      "Local account authentication is disabled in production. Use NODE_ENV=development for the local prototype; configure OIDC for production identity.",
    );
  for (const name of ["BAYORA_WORKER_IMAGE", "BAYORA_MODEL_IMAGE"])
    if (env[name] && !/^sha256:[a-f0-9]{64}$/.test(env[name]))
      throw Error(`${name} must be a local immutable sha256 image ID.`);
  if (
    env.BAYORA_MODEL_VOLUME &&
    !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/.test(env.BAYORA_MODEL_VOLUME)
  )
    throw Error("BAYORA_MODEL_VOLUME must be a named volume, not a host path.");
  if (
    env.BAYORA_CONTAINER_MODEL &&
    (!/^[a-zA-Z0-9][a-zA-Z0-9_.:/-]{0,120}$/.test(env.BAYORA_CONTAINER_MODEL) ||
      env.BAYORA_CONTAINER_MODEL.includes(":cloud"))
  )
    throw Error("Select a bounded local container model name.");
  if (
    env.BAYORA_CONTAINER_MODEL_DIGEST &&
    !/^(sha256:)?[a-f0-9]{64}$/.test(env.BAYORA_CONTAINER_MODEL_DIGEST)
  )
    throw Error(
      "BAYORA_CONTAINER_MODEL_DIGEST must be a SHA-256 model revision.",
    );
  if (env.BAYORA_SIGNER_SOCKET && !env.BAYORA_EVIDENCE_PUBLIC_KEY)
    throw Error("A pinned evidence public key is required with the signer.");
  if (
    env.BAYORA_REQUIRE_SIGNED_EVIDENCE === "true" &&
    (!env.BAYORA_SIGNER_SOCKET || !env.BAYORA_EVIDENCE_PUBLIC_KEY)
  )
    throw Error(
      "Required signing needs a signer socket and a pinned public key.",
    );
  let oidcIssuer = "",
    publicOrigin = "";
  if (env.BAYORA_OIDC_ISSUER) {
    const issuer = new URL(env.BAYORA_OIDC_ISSUER),
      local = ["127.0.0.1", "localhost"].includes(issuer.hostname);
    if (
      issuer.username ||
      issuer.password ||
      issuer.search ||
      issuer.hash ||
      (issuer.protocol !== "https:" &&
        !(
          environment !== "production" &&
          local &&
          env.BAYORA_OIDC_ALLOW_HTTP === "true"
        ))
    )
      throw Error(
        "OIDC issuer must use HTTPS (explicit loopback HTTP is development-only).",
      );
    oidcIssuer = issuer.href.replace(/\/$/, "");
    if (!env.BAYORA_OIDC_CLIENT_ID || !env.BAYORA_PUBLIC_ORIGIN)
      throw Error("OIDC needs a client ID and public origin.");
  }
  if (env.BAYORA_PUBLIC_ORIGIN) {
    const origin = new URL(env.BAYORA_PUBLIC_ORIGIN);
    if (
      origin.origin !== env.BAYORA_PUBLIC_ORIGIN ||
      (environment === "production" && origin.protocol !== "https:")
    )
      throw Error(
        "BAYORA_PUBLIC_ORIGIN must be an origin; production requires HTTPS.",
      );
    publicOrigin = origin.origin;
  }
  if (
    environment === "production" &&
    oidcIssuer &&
    (env.BAYORA_OIDC_REQUIRE_MFA !== "true" ||
      env.BAYORA_REQUIRE_SIGNED_EVIDENCE !== "true")
  )
    throw Error("Production OIDC requires IdP MFA and signed evidence.");
  const oidcClientSecret = secretValue(env, "BAYORA_OIDC_CLIENT_SECRET", {
    requiredFile: pilotMode,
  });
  if (
    pilotMode &&
    (environment !== "production" ||
      demoAuth ||
      !oidcIssuer ||
      !publicOrigin ||
      env.BAYORA_OIDC_REQUIRE_MFA !== "true" ||
      env.BAYORA_REQUIRE_SIGNED_EVIDENCE !== "true" ||
      env.BAYORA_TRUST_PROXY !== "true" ||
      !runtimeEnabled ||
      !env.BAYORA_WORKER_IMAGE ||
      !env.BAYORA_MODEL_IMAGE ||
      !env.BAYORA_MODEL_VOLUME ||
      !env.BAYORA_CONTAINER_MODEL ||
      !env.BAYORA_CONTAINER_MODEL_DIGEST ||
      !env.BAYORA_AUTH_KEY)
  )
    throw Error(
      "Pilot mode requires production, external OIDC/MFA, HTTPS public origin, trusted loopback TLS proxy, private MFA key, required signing and pinned container runtime settings.",
    );
  let pilotAcceptance = null;
  if (pilotMode) {
    for (const name of [
      "BAYORA_AUTH_KEY",
      "BAYORA_SIGNER_TOKEN",
      "BAYORA_EVIDENCE_PUBLIC_KEY",
    ]) {
      try {
        const stat = lstatSync(env[name]);
        if (
          !stat.isFile() ||
          stat.isSymbolicLink() ||
          (name !== "BAYORA_EVIDENCE_PUBLIC_KEY" && stat.mode & 0o077)
        )
          throw Error("invalid");
      } catch {
        throw Error(
          `${name} must reference an existing appropriately protected regular file in pilot mode.`,
        );
      }
    }
    if (env.BAYORA_SIGNER_PRIVATE_KEY || env.BAYORA_SIGNER_DB)
      throw Error(
        "Do not give the API service signer private-key/ledger settings. Run the signer separately.",
      );
    pilotAcceptance = inspectAcceptance(
      env.BAYORA_PILOT_ACCEPTANCE_FILE,
      publicOrigin,
    );
    if (!pilotAcceptance.ready)
      throw Error(
        "Pilot acceptance gates remain: " + pilotAcceptance.missing.join(", "),
      );
  }
  const host = env.BAYORA_HOST || "127.0.0.1";
  if (!["127.0.0.1", "localhost"].includes(host))
    throw Error("The prototype must bind to a loopback host.");
  const port = integer(env.PORT, 3001, "PORT"),
    frontendPort = integer(
      env.BAYORA_FRONTEND_PORT,
      5173,
      "BAYORA_FRONTEND_PORT",
    );
  const ollama = new URL(env.BAYORA_OLLAMA_ORIGIN || "http://127.0.0.1:11434");
  if (
    ollama.protocol !== "http:" ||
    !["127.0.0.1", "localhost"].includes(ollama.hostname) ||
    ollama.username ||
    ollama.password ||
    ollama.pathname !== "/" ||
    ollama.search ||
    ollama.hash
  )
    throw Error(
      "BAYORA_OLLAMA_ORIGIN must be an HTTP loopback origin without credentials or a path.",
    );
  const origins = [port, frontendPort].flatMap((p) => [
    `http://127.0.0.1:${p}`,
    `http://localhost:${p}`,
  ]);
  return Object.freeze({
    environment,
    demoAuth,
    pilotMode,
    pilotAcceptance,
    pilotAcceptanceFile: env.BAYORA_PILOT_ACCEPTANCE_FILE || "",
    trustProxy: env.BAYORA_TRUST_PROXY === "true",
    publicOrigin,
    oidcIssuer,
    oidcClientId: env.BAYORA_OIDC_CLIENT_ID || "",
    oidcClientSecret,
    oidcAllowHttp:
      env.BAYORA_OIDC_ALLOW_HTTP === "true" && environment !== "production",
    oidcRequireMfa: env.BAYORA_OIDC_REQUIRE_MFA === "true",
    oidcAcrValues: env.BAYORA_OIDC_ACR_VALUES || "",
    oidcRedirectUri: publicOrigin ? publicOrigin + "/api/oidc/callback" : "",
    ...storagePaths(env),
    signerSocket: env.BAYORA_SIGNER_SOCKET || "",
    signerTokenPath: env.BAYORA_SIGNER_TOKEN || ".data/signing/client-token",
    evidencePublicKey: env.BAYORA_EVIDENCE_PUBLIC_KEY || "",
    requireSignedEvidence: env.BAYORA_REQUIRE_SIGNED_EVIDENCE === "true",
    runtimeEnabled,
    runtimeWorkerImage: env.BAYORA_WORKER_IMAGE || "",
    runtimeModelImage: env.BAYORA_MODEL_IMAGE || "",
    runtimeModelVolume: env.BAYORA_MODEL_VOLUME || "",
    runtimeModel: env.BAYORA_CONTAINER_MODEL || "",
    runtimeModelDigest: env.BAYORA_CONTAINER_MODEL_DIGEST || "",
    runtimeMemoryMb: integer(
      env.BAYORA_MODEL_MEMORY_MB,
      4096,
      "BAYORA_MODEL_MEMORY_MB",
      512,
      16384,
    ),
    host,
    port,
    frontendPort,
    origins: pilotMode
      ? [publicOrigin]
      : publicOrigin
        ? [...origins, publicOrigin]
        : origins,
    hosts: [
      ...new Set([
        ...origins.map((o) => new URL(o).host),
        ...(publicOrigin ? [new URL(publicOrigin).host] : []),
      ]),
    ],
    ollamaOrigin: ollama.origin,
    distPath: resolve("dist"),
    sessionTtlMs:
      integer(
        env.BAYORA_SESSION_MINUTES,
        60,
        "BAYORA_SESSION_MINUTES",
        1,
        1440,
      ) * 60000,
    maxActiveRuns: integer(
      env.BAYORA_MAX_ACTIVE_RUNS,
      2,
      "BAYORA_MAX_ACTIVE_RUNS",
      1,
      10,
    ),
    workerConcurrency: integer(
      env.BAYORA_WORKER_CONCURRENCY,
      1,
      "BAYORA_WORKER_CONCURRENCY",
      1,
      10,
    ),
    workerLeaseMs: integer(
      env.BAYORA_WORKER_LEASE_MS,
      5000,
      "BAYORA_WORKER_LEASE_MS",
      2000,
      60000,
    ),
    syntheticStepMs: 1000,
  });
}
export function publicConfig(config) {
  return {
    environment: config.environment,
    demoAuth: config.demoAuth,
    deployment: config.pilotMode ? "restricted-pilot" : "local-prototype",
    pilotMode: !!config.pilotMode,
    authentication: config.oidcIssuer ? "local-and-oidc" : "local-accounts",
    oidcEnabled: !!config.oidcIssuer,
    evidence: {
      signerConfigured: !!config.signerSocket,
      signatureRequired: !!config.requireSignedEvidence,
    },
    isolation: "unverified",
    limits: {
      maxActiveRuns: config.maxActiveRuns,
      sessionMinutes: config.sessionTtlMs / 60000,
    },
    adapters: ["synthetic-demo", "ollama", "container-ollama"],
    containerRuntime: {
      enabled: config.runtimeEnabled,
      profile: "bayora-container-v1",
      independentAttestation: false,
    },
  };
}
