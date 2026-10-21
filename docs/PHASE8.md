# Phase 8 — restricted pilot hardening

Local hardening and operator tooling are implemented. **A production or sensitive-data pilot is not approved by these code changes.** The original phase requires independent review and real operational acceptance; the deployment template deliberately leaves those gates unapproved.

## Implemented controls

| Area                     | Implementation                                                                                                                                                                                                                        |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Strict pilot profile     | `BAYORA_PILOT_MODE=true` requires production mode, external HTTPS OIDC/MFA, file-based client secret, protected MFA/token files, trusted local TLS proxy, required evidence signing and pinned container/model settings.              |
| Session assurance        | Persisted sessions record authentication method, issuer and MFA assurance. Production rejects development/password sessions, foreign issuers and missing required MFA. Membership/role revocation remains enforced.                   |
| Approved model revisions | Admins approve/revoke an exact model ID and SHA-256 digest per organization, with recorded reasons. Pilot launches, queue dispatch and worker checks require current approval. Shared Ollama and fixtures are rejected in pilot mode. |
| Incident containment     | Organization pause blocks launches and stops active workers at their next broker check. Partial/unknown attempts and cleanup remain recorded. Explicit reasoned resume is audited.                                                    |
| HTTP controls            | Security headers/CSP, no external font requests, bounded request rate/memory, 1 MB JSON limit, header/body/keepalive timeouts, trusted forwarding checks and static symlink containment.                                              |
| Retention                | Workspace retention holds, expiring reviewed removal plans, current-state fingerprints, exact-name confirmation and single-use apply. Active execution or unverified cleanup blocks removal.                                          |
| Evidence after retention | Run snapshots retain the original public manifest and redacted outcomes so manifest/results bindings and signed verification still work after private content removal.                                                                |
| Deployment/operations    | Separate API/signer account templates, HTTPS proxy template, private secret-file configuration, pilot preflight, backup/restore/compaction procedures, incident runbook and immutable CI Action references.                           |
| Verification             | Security integration tests, operator browser regression, bounded synthetic load, dependency audit and actual Docker worker-failure/cleanup/retry acceptance.                                                                          |

## Supported scope and trust boundary

The enabled pilot profile is limited to **prompt-only synthetic evaluation** using approved local containers. It does not execute uploaded code. The API broker and Docker daemon remain trusted. API/worker processes share the API account; they are not independent trust principals. The local development signer still shares your OS account. Deployment templates separate the signer account, but those Linux permissions have not been installed or verified on this Mac.

SQLite stores domain payloads in a JSON record; identity, sessions, audit/checkpoints, queue and pilot controls have separate tables. Tenant boundaries remain application-enforced, not PostgreSQL RLS. Raw domain content is not application-encrypted; the pilot operator must review encrypted storage, access controls and backups. No hostile-kernel, GPU/side-channel, independent-host-attestation or general model-safety claim is made.

## Pilot acceptance gates

Copy `deploy/pilot-acceptance.example.json` outside the repository and record actual reviewer/owner identities, report SHA-256 hashes, scope/origin and an expiry within 90 days. It starts with every gate **false**. Do not mark reports reviewed merely because unit tests pass.

Required gates cover identity, signer administration, secrets/storage, independent security review, recovery, load, isolation, retention and incident handling. Named operations/security/data owners are required. Pilot startup rejects incomplete, expired or wrong-origin records. Readiness and running workers recheck the file. Operator assertions/report hashes are recorded inputs; the software cannot independently authenticate the reviewer or assess report conclusions.

```sh
npm run pilot:check
```

This checks strict configuration, operator gates, linked administrator, database integrity, model approval, protected files, cleanup state and API readiness. A normal local/demo configuration deliberately reports not pilot-ready. It does not contact your IdP as a user or independently inspect Linux permissions.

## Deployment preparation

Templates in `deploy/` are for a reviewed Linux host:

1. Install Node 24+ and the tested local Docker runtime. Build with `npm ci && npm run build`; do not copy `.data`/`.env` or development secrets into a public web root.
2. Create `bayora-api`, `bayora-signer` and a dedicated `bayora-ipc` socket group. Keep the API state directory separate from the signer key/ledger directory. Apply ownership before installing service templates.
3. Bootstrap/link the administrator to the actual IdP on a private development/maintenance instance; verify provider MFA claims. Revoke old sessions before switching to the strict profile. There is no automatic email/role-based administrator creation or production password-login fallback.
4. Generate the signer key under its independent service account. Give the API a separate 0600 copy of the client credential and a trusted public key; never its private key/ledger settings. Arrange independent key/ledger backups and recovery ownership.
5. Configure `api.env.example` and `signer.env.example` as separate environment files, with secret values in protected files. Review the local Docker socket's privileges; do not expose it over TCP or put the API user in a privileged group without reviewing that trust boundary.
6. Configure the exact HTTPS hostname and redirect URI `${BAYORA_PUBLIC_ORIGIN}/api/oidc/callback`. Place Caddy directly in front of loopback port 3001. The template overwrites forwarding headers; the application trusts them only from loopback. Adding a CDN/proxy chain requires a new trust review.
7. Validate Caddy/systemd configuration on the actual Linux host before starting it, complete the acceptance reports, run the pilot preflight and perform end-to-end sign-in/execution/verification/recovery checks there.

Caddy's forwarding/HTTPS behavior follows the [official reverse proxy documentation](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy) and [HTTPS configuration guidance](https://caddyserver.com/docs/caddyfile/options). The account/filesystem sandbox template uses the [systemd execution settings](https://www.freedesktop.org/software/systemd/man/latest/systemd.exec.html). These are deployment templates, not a remotely deployed or Linux-validated service.

Do not enable unredacted proxy query/access logs: OIDC callback URLs contain authorization codes. Request IDs are safe correlation aids; avoid raw prompts, policy rules, responses, cookies and secrets in operational logs.

## Retention and removal

Use **Administration → Workspace retention**:

1. Select the workspace; place/release a retention hold with audited operator intent.
2. Review the removal plan after all jobs and resource cleanup finish. A change to the workspace's runs/artifacts invalidates the fingerprint; holds are checked again at apply.
3. Type its exact name and acknowledge what remains, then retire/remove private content. The plan is bound to the requesting administrator and expires after 15 minutes.

The action removes workspace-bound datasets/policies/drafts/grants/access requests, raw response bodies, private frozen rules/prompts and review reasons from current application state. It preserves verifiable public manifests, hashes, sanitized outcomes, IDs/timestamps, workspace tombstones and audit history. Organization-shared artifacts are retained because other workspaces may use them. Retired workspaces cannot launch new campaigns or publish new workspace artifacts.

This is **logical private-content removal**, not complete tenant/account erasure or physical media erasure. SQLite/WAL history, storage snapshots, backups, signer receipts and already downloaded copies have separate retention responsibilities. User accounts, public metadata and organization-shared records are not anonymized by this workspace action. Do not use it to claim complete sensitive-data deletion.

After stopping the API, an operator can compact a database:

```sh
npm run data:compact
```

The broker lock refuses a running database. Compaction rewrites current SQLite content and checkpoints/truncates WAL; it does not establish SSD/media erasure or remove backups. Back up and test restores before scheduled maintenance. Review backup expiry, signer-record retention, storage encryption and downloaded artifacts in the actual pilot policy.

## Load, recovery and incident operations

```sh
npm run pilot:load
npm run data:backup
npm run data:restore -- /backup/directory /new/restore/drill
npm run runtime:worker-acceptance
```

`pilot:load` runs 760 bounded loopback synthetic API/admission requests at concurrency up to 16, checks duplicate submission/capacity limits and rate limiting, and measures health p95 against a default 250 ms local threshold (`BAYORA_LOAD_P95_MS`). It never benchmarks live-model/GPU throughput. The JSON report is `.data/acceptance/pilot-load.json`. The full workflow still needs representative production load targets and review.

The worker acceptance uses an isolated database and the configured approved real runtime/signer. It kills a real container worker, verifies partial evidence/cleanup and runs a fresh linked retry. Do not run these maintenance tests against an active production workspace as an improvised drill.

For an incident: pause the affected organization, preserve signed evidence and backups, verify all worker/container cleanup, revoke affected model approvals and sessions/credentials, involve the named operator/reviewer, document findings, recheck the relevant acceptance gates and explicitly resume only after review. Network/host compromise requires host-level isolation and investigation outside the app. See [operations runbook](OPERATIONS.md).

## What remains before a real pilot

Actual domain/TLS/IdP acceptance, independent signer administration, encrypted deployment storage/secrets ownership, independent security/threat-model review, representative load and restore acceptance, named incident/data owners and a teammate handoff remain external release gates. Full domain normalization, ZIP packaging and broader evaluators are earlier/product gaps, listed in [project status](PROJECT_STATUS.md). The code does not automatically approve any of these.
