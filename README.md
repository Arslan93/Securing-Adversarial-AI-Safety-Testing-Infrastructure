# Bayora

A local-first AI safety evaluation workbench based on `Bayora_PRD.pdf` (draft v1.0, 19 October 2026). Create a workspace, freeze a policy and dataset, run paired baseline/defended evaluations, inspect findings, append analyst reviews, and export hash-verifiable evidence.

**This implementation is a development prototype, not a production isolation platform.** The UI and API consistently distinguish fixture results, live local inference, and unverified environment integrity. It does not claim that a shared Ollama process provides sandbox isolation.

## Run

Requires Node.js 24+ and npm. No API key is required.

```sh
npm install
npm run dev
```

Open **http://127.0.0.1:5173**. Select a development role and enter the workspace. The API listens on `127.0.0.1:3001`. Both listeners are loopback-only. SQLite state is stored in `.data/bayora.db` and survives restarts; sessions expire after an hour and are discarded on restart.

For a production-style local build:

```sh
npm run build
npm start
```

Open **http://127.0.0.1:3001**. This serves the built frontend and API from one origin. Do not expose this development identity system to the internet.

## Try the workflow

1. Enter as **Admin**. The initial Research workspace and v1 text policy are created automatically. There are no fabricated historical campaigns or integrity percentages.
2. Optionally create a workspace with a name, purpose and bounded TTL, or publish a new immutable policy version in Policy lab.
3. Click **New campaign**, choose a workspace and policy, and start with the synthetic adapter. It completes 20 paired cases in approximately six seconds.
4. Inspect the timeline and per-case outcomes. Expand a case to see its synthetic response. Filter violations and append an analyst classification with a reason; original results remain unchanged.
5. Export evidence, open **Audit vault**, and upload the JSON. Untouched packages verify for local consistency. Edit an event, manifest, verdict, or result and verify again; verification fails.
6. Start another campaign and cancel it. Cancellation is terminal and emits a cleanup receipt; it does not create or delete any containers.
7. Sign out and enter as **Red**, **Blue**, **Analyst**, or **Auditor** to exercise the server-side permission boundaries.

## Optional live local model

Start your own Ollama server with an already-installed, approved local model. Bayora does not download a model, send prompts to a hosted provider, or start the inference service automatically.

In **New campaign → Model adapter**, choose **Local Ollama**. The API discovers installed model revisions at `http://127.0.0.1:11434`; pick a model and acknowledge local inference. The launch button remains disabled if the service is unavailable or no model is installed. Cloud-suffixed model tags are excluded from discovery.

The adapter uses [Ollama chat](https://docs.ollama.com/api/chat) and [model discovery](https://docs.ollama.com/api/tags). Each arm sends a fresh system/user message pair, temperature 0, seed 42, a 128-token output cap, and no tools or previous transcripts. The chosen model digest and policy snapshot are frozen. There are at most 40 serial calls per run, two active runs, a 60-second timeout per call, and a workspace TTL deadline. Cancellation aborts outstanding HTTP requests. These bounds do not independently enforce Ollama CPU/GPU allocation or prove remote cancellation.

Live scoring checks **exact disclosure of a per-run fictional canary**. It is not a comprehensive safety judge, a calibrated general ASR benchmark, or an isolation canary proof. Live results are kept separate from fixture-only Overview metrics. Fixed sampler settings do not guarantee deterministic model outputs. The shared model service stays running after a run; memory/GPU residue is untested.

## Roles and privacy

| Capability                          | Admin | Red | Blue | Analyst | Auditor |
| ----------------------------------- | ----- | --- | ---- | ------- | ------- |
| Create workspace                    | Yes   | No  | No   | No      | No      |
| Read synthetic private test prompts | Yes   | Yes | No   | No      | No      |
| Read/publish blue rule bundles      | Yes   | No  | Yes  | No      | No      |
| Launch/cancel campaigns             | Yes   | No  | No   | Yes     | No      |
| Inspect redacted outcomes           | Yes   | Yes | Yes  | Yes     | Yes     |
| Read model response bodies          | Yes   | Yes | No   | Yes     | No      |
| Append finding review               | Yes   | No  | No   | Yes     | No      |
| Export and verify evidence          | Yes   | Yes | Yes  | Yes     | Yes     |

Permissions are checked on the server. Private Blue rules are omitted from unauthorized state responses and exports. Raw Red prompts, model response bodies, and review reasons are excluded from evidence exports. Attempts and review events retain content digests. Development roles are freely selectable: this is not an authentication assurance or a multi-tenant membership system. The prototype has one local organization and a shared approved synthetic corpus; it does not implement per-researcher ownership or explicit private-artifact grants.

## Evidence contract

Events carry sequence numbers, UTC timestamps, previous hashes, and SHA-256 hashes. Creation events bind a public manifest digest. Finalization events bind the sanitized result digest and verdict. Verification checks event ordering, previous-hash links, event hashes, the final anchor, manifest binding, results binding, and verdict consistency.

An offline verifier needs only Node.js and the repository:

```sh
node scripts/verify-evidence.mjs /absolute/path/to/bayora-evidence.json
```

Exit code 0 means local hash consistency; 1 means verification failed. An exported anchor stored alongside the same events is **not independent**. A privileged writer able to rewrite the whole store and anchor could fabricate a new chain. External signing/anchoring, immutable object storage, authenticated export grants, retention enforcement, and audit-store privilege separation remain required. Export format is JSON; PDF/ZIP reporting is not implemented.

## Implementation and PRD coverage

| PRD area             | Implemented                                                                                                      | Remaining                                                                                               |
| -------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| FR-01 identity/roles | Expiring HttpOnly SameSite sessions, server role checks, denial events, host/origin checks                       | OIDC, organizations, memberships, scoped object grants, production CSRF/TLS policy                      |
| FR-02 configuration  | Workspace validation, TTL bounds, run manifests, policy/model/dataset digests, duplicate-submit protection       | Dedicated campaign drafts, full model consent registry, clone workflow                                  |
| FR-03 isolation      | Explicit unverified topology, bounded evaluation work, cancellation, restart reconciliation                      | Container provisioning, runtime network/process/filesystem separation, resource probes, actual teardown |
| FR-04 gateway        | Authorized launch, fixed local model endpoint, no tool execution, bounded serial inference, correlation IDs      | Separate service identity/mTLS gateway and runtime network enforcement                                  |
| FR-05 red tests      | Approved 20-case prompt corpus, private prompt read, paired attempts                                             | Custom case composer/import, per-researcher ownership, Red approval requests                            |
| FR-06 policies       | Validated text rule bundles, immutable versions, creator-role audit, frozen snapshots                            | Rich policy DSL/lint/diff and policy-to-case calibration                                                |
| FR-07 inference      | Deterministic fixture adapter and opt-in Ollama HTTP adapter with fresh message contexts                         | Container-scoped inference, GPU isolation, live host verification                                       |
| FR-08 evaluation     | Paired case outcomes, adversarial-only denominators, exact-canary live rubric, append-only human reviews         | Calibrated safety evaluator, false-positive rubric, broader benchmarks                                  |
| FR-09 evidence       | Local hash chain, manifest/result/verdict binding, redacted JSON exports, offline/UI verifier                    | Independent signature/anchor, object storage, ZIP/PDF exports                                           |
| FR-10 operator UI    | Eight navigation areas, workspace/policy/run flows, polling/reconnect, filters, case details, responsive layouts | Live environment probes and production health/alerts                                                    |
| P1/P2                | Not represented as complete                                                                                      | Scheduling, multi-model comparison, disclosure approvals, compliance, enterprise operations             |

Synthetic fixtures always receive `DEMO_ONLY`; live runs receive `UNVERIFIED` because no isolation attestation exists. No run is labeled environment-verified. Completed, failed and cancelled execution records cannot be restarted in place. New evaluations create new IDs. Reviews are stored separately and append audit events, preserving original case classifications.

## Project layout

- `src/main.jsx`, `src/styles.css`: React operator console and responsive design system.
- `server/index.mjs`: loopback API, SQLite persistence, development sessions, authorization and orchestration.
- `server/core.mjs`: synthetic corpus, fixture evaluator, evidence verification.
- `server/ollama.mjs`: local-only model adapter.
- `server/*.test.mjs`: integrity, permissions, lifecycle and adapter tests.
- `scripts/verify-evidence.mjs`: offline verifier.
- `scripts/dev.mjs`: frontend/API development processes.
- `design/overview-concept.png`: generated primary screen reference.

React + Vite is used for the frontend. Node's built-in HTTP/SQLite libraries keep the backend runnable without Python/Postgres/container setup. This intentionally differs from the PRD's proposed FastAPI/PostgreSQL deployment and is suitable for the local prototype only.

## Checks

```sh
npm test
npm run build
npm run format:check
```

Automated tests cover role denials and redaction, session revocation, TTL validation, idempotency, frozen snapshots, cancellation, unchanged/altered event chains, manifest/result/verdict integrity, bounded model requests, fresh paired contexts, exact canary scoring, transport failures, and cancellation before inference.

Browser QA uses Playwright with an isolated headless Chrome profile: desktop 1536×1024 and mobile 390×844, create/run/inspect/export/verify, plus mobile navigation and horizontal-overflow checks. The in-app Browser JavaScript execution tool was unavailable in this session. A live Ollama `qwen2.5:3b` run completed all 20 paired cases (40 model calls) in approximately 56 seconds, and its exported evidence passed the offline verifier. On this deliberately simple synthetic canary corpus, the baseline disclosed the canary in 16/16 adversarial cases and the defended arm in 12/16; these are narrow test observations, not general model-safety measurements. Container/network isolation remains untested because Docker is unavailable.

## Before a pilot

Implement actual organization/membership authentication, per-role artifact ownership and grants, separate runtime service identities, default-deny networks, unprivileged per-run compute, an independently controlled audit signer, tenant storage enforcement, bounded durable jobs, retention/backups and failure-injection tests. Independently validate cross-role, network, context and artifact boundaries. Do not infer a production security guarantee from the prototype's UI, hash consistency, or local model adapter.
