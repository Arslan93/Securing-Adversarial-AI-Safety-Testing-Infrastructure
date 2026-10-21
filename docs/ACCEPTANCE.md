# Acceptance record — 21 October 2026

The previously identified local implementation gaps were closed and tested. This record separates observed behavior from external deployment assumptions.

| Phase | Implemented acceptance scope                                                                                                                                                                    | Validation                                                                                                                        |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| 1     | Modular app/API, configuration, health/session/reconnect behavior, consistent metric sources                                                                                                    | Automated regression and browser flows                                                                                            |
| 2     | Distinct private corpus, imports/composer, immutable versions, frozen runs, paired attempts, guarded comparisons and reviews                                                                    | Automated dataset/evaluation/evidence tests and live model attempts                                                               |
| 3     | Individual accounts, tenancy/membership, ownership/grants, MFA/recovery, OIDC/PKCE, invitations and artifact approvals                                                                          | Real local OIDC protocol test, MFA/invitation tests, browser enrollment/login/approval flows                                      |
| 4     | Four runtime compartments, gateway, bounded CPU/memory/PIDs, no network, read-only mounts, cleanup/cancel/restart recovery                                                                      | Real Docker smoke, egress/filesystem/OOM/recovery checks, plus simulated fault injection                                          |
| 5     | Separate Ed25519 signer, pre-execution manifest registration, pinned verification, rollback/fork refusal, append-only audit/checkpoint ledgers and backup command                               | Real signer IPC, tampering/rollback tests, signed real-container export and browser/CLI verification                              |
| 6     | Durable SQLite queue/reservations, separate workers, persistent deadlines/budgets/leases, partial attempts, linked retries, cleanup and restore operations                                      | Worker kill/pause, API crash/restart, expired queue tests, real Docker worker-loss/cleanup/retry, backup/restore drill            |
| 7     | Isolated demo seed/reset, five accounts, two policy versions, approved corpus, committed browser regression, runbook and recorded fallback                                                      | Desktop/mobile signed fixture journey, role denial, reconnect, tamper rejection, report printing and fallback video               |
| 8     | Strict pilot/acceptance gates, protected file secrets, session assurance, model approval/revocation, containment, reviewed retention/removal, deployment/CI/preflight and load/recovery tooling | Nine security integration tests, desktop/mobile operator workflow, dependency audit, synthetic load and actual container recovery |

Validation completed with **88 passing automated tests**, a successful production build and formatting check, and desktop/mobile browser flows without page errors.

The signed end-to-end container campaign completed four model calls across two cases. All four container profiles and runtime probes passed and cleanup was `REMOVED`. Its export has 28 events and was verified with the configured public key and `--require-signature`. The package is retained locally at `/tmp/bayora-signed-container-evidence.json`. No raw prompts, private rules or output bodies are exported.

The main workspace was preserved. QA identities/campaigns were placed in separate QA databases. A private consistent database/MFA-key backup was also created under `.data/backups`.

## Observed live runtime checks

- Four compartments denied outbound TCP connection attempts to a reserved test-network address.
- Docker socket access was absent.
- A Red-only temporary file was not visible in Blue or either model container.
- A bounded allocation stress caused an OOM kill in the 256 MiB Red cgroup while Blue remained usable.
- Cancellation removed all allocated containers and checked absence.
- Reopening the database recovered an interrupted run and removed its actual persisted resources.

## External conditions

OIDC code was exercised against a real local protocol test server with signed ID tokens/JWKS; no user-supplied external IdP is configured. The development signer is a separate process under the same OS account, so independent administration is not established. Production requires the operator's provider/MFA claims, HTTPS termination, protected signer ownership/backups, credential distribution and operational recovery. GPU/side-channel isolation, database RLS and independent host attestation are not provided. Live environment validity remains `UNVERIFIED`; signatures attest to checkpoints, not model safety or host honesty.

## Additional draft/report workflow browser acceptance

An isolated QA database exercised New campaign → Save draft → Resume → Revise → Launch → Printable report / Case CSV / Export evidence → Clone → Save → Resume → Launch. Desktop (1440×1000) and mobile (390×844) flows passed without page errors or horizontal overflow. The downloaded companion JSON passed pinned-key strict CLI verification. The standalone HTML report rendered without external assets and was printed to an A4 PDF during QA. Screenshots/downloads remain in `/tmp/bayora-phase6-*`; no QA identities were added to the main workspace.

## Original Phase 6 — actual worker recovery

Six execution tests cover atomic scoped queue reservations, real live-worker termination with completed/unknown partial attempts, linked retry without history overwrite, queued restart with original deadlines, SIGSTOP lease expiry, expired queued work and a real SIGKILL/restart of the API process. The release seed/restore test verifies generated five-role identities, versioned demo data, private credentials, backup integrity and refusal to overwrite a restore target.

Real Docker acceptance (`npm run runtime:worker-acceptance`) passed: the worker was killed mid-request, all four runtime containers were removed, an unknown attempt was preserved and the failed package's trusted signature verified. A fresh linked retry completed two real model calls, confirmed cleanup and produced trusted signed evidence. Its retained export is `.data/acceptance/worker-retry-evidence.json`. Failure/retry IDs were `acf25a98-0e06-49d5-a739-7818ef62c941` and `28671a45-77d6-40a0-96f9-0c90061389be`.

A private main-workspace backup was created and restored into a separate drill directory; SQLite integrity and audit history verified. The original database was not overwritten. This tests a local restore copy, not an independently operated production recovery procedure.

## Original Phase 7 — release journey

The committed `npm run test:e2e` passed on desktop 1440×1000 and mobile 390×844: sign-in, operations monitoring, draft/resume, worker completion, signed JSON and HTML/CSV downloads, clone/cancel, trusted verification/tamper rejection, Auditor UI/API denials, raw-output redaction, connection failure/reconnect and printable PDF. There were no page runtime errors. The in-app Browser execution tool was unavailable, so the established isolated Playwright/Chrome fallback was used.

The recorded synthetic fallback and screenshots/downloads are retained at `/var/folders/tl/z0rfr49119vbwvp7ks733h780000gn/T/bayora-release-K1CqdA`; `fallback-demo.webm` records the fixture journey. Demo seed/reset archived the old marked demo without touching the main workspace. The dedicated demo launcher was checked on 5180/3080 with its own key/ledger. An independent teammate rehearsal and production acceptance remain outstanding, as stated in PHASE7.md and ROADMAP.md.

Selected release artifacts are also retained privately in `.data/release/2026-10-21`: fallback video, desktop/mobile screenshots, redacted reports, signed/tampered JSON and matching public key. No account credentials or private signing keys were copied into that release artifact directory. Strict offline verification of its original JSON passed.

## Phase 8 — observed hardening acceptance

The complete suite now has 88 passing tests. Nine Phase 8 tests verify protected secret/configuration files, incomplete/expired acceptance refusal, trusted proxy checks and bounded request admission, tenant-scoped exact model approval/revocation, actual worker containment, retention holds/stale plans/single use, signed evidence after private-content removal, operator role/organization denials and positive/negative production OIDC/MFA session assurance. Legacy development sessions do not become production-authorized sessions.

The updated browser regression exercises pause/resume, exact model approval/revocation, retention holds, reviewed confirmation and retirement in a disposable workspace, plus the prior signed campaign/tamper/role/reconnect flows. Desktop 1440×1000 and mobile 390×844 layouts, no horizontal overflow, no framework overlay, no page runtime errors and primary console health were checked. In-app Browser execution remained unavailable; the established isolated Playwright/Chrome fallback was used. Shareable synthetic evidence excludes account credentials and private keys.

The bounded load report `.data/acceptance/pilot-load.json` passed 760 loopback synthetic workload requests, 16-way health concurrency and the 250 ms local p95 threshold; observed p95 was 2.87 ms on Node v26.1.0 / 10 CPUs / 16 GiB RAM. Duplicate submissions produced one run, capacity admitted one additional distinct run, and excess requests were rate limited. This is not production or live-model/GPU throughput acceptance.

Real Docker worker-loss/cleanup/retry acceptance passed again after hardening. Failure/retry IDs were `5777ca8c-0185-4aad-937e-a94ff2989b11` and `cb07a7e9-ee6c-49c7-9c14-5c878cc27f97`. The current export is `.data/acceptance/worker-retry-evidence.json`. Failed/unknown attempts, all-container removal, trusted failed evidence and a fresh successfully cleaned/signed retry were verified.

A private main database/MFA-key backup was restored into a new directory and the stopped restore copy compacted; SQLite/audit checks passed. `.data/acceptance/phase8-recovery.json` records the drill and limits. The main database was not overwritten, compacted or retired. Recovery commands use storage-only configuration so they remain available when live pilot admission is blocked.

The dependency audit reported zero known vulnerabilities; its report is `.data/acceptance/phase8-dependency-audit.json`. The immutable-reference CI workflow is prepared but has not been triggered remotely. Caddy/systemd templates were not installed or validated as a Linux deployment on this Mac.

Current pilot preflight correctly reports **not ready**: the strict profile is not enabled, external IdP-linked administrator/model approval and operator acceptance remain unconfigured. API/database/key-protection/cleanup checks pass locally. No external security review, signer-account separation, domain/TLS/IdP deployment or production privacy/performance approval is claimed. See PHASE8.md, OPERATIONS.md and PROJECT_STATUS.md for the release gates and remaining work.

Final Phase 8 browser proof is retained privately in `.data/release/phase8-20261021-final` (operator desktop/mobile screenshots, synthetic fallback video, redacted reports, signed/tampered evidence and matching public key). Final local regression output is `.data/acceptance/phase8-tests.log`; preflight and dependency audit reports are stored alongside it. No real private inputs were retired and no credentials/private signing keys were included in the shareable artifact selection.
