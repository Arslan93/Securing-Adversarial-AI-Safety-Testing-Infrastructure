# What Bayora does, what is done, and what remains

Bayora is a working AI safety evaluation workbench. An operator freezes a dataset, policy and model revision, runs baseline/defended arms, inspects outcomes and runtime probes, records reviews and exports verifiable evidence. It demonstrates a controlled research workflow; its limited evaluator does not certify general model safety.

## Implemented

| Original phase          | What exists now                                                                                                                                                                                                                                | Remaining qualification                                                                                                                   |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 1 — local foundation    | Modular backend and atomic React UI, configuration, health/session/reconnect handling, source-separated metrics                                                                                                                                | Local supported topology; no distributed application deployment claim.                                                                    |
| 2 — evaluation workflow | Distinct scenarios, Red composer/import, immutable datasets/policies, private random canary, paired/partial attempts, rubric/utility labels, version diffs and guarded comparisons                                                             | Broader human evaluation, calibrated general safety scoring and additional benchmarks.                                                    |
| 3 — identity/access     | Individual accounts, organizations/memberships, scoped permissions, ownership/grants, MFA/recovery, invitations, OIDC/PKCE and persisted session assurance                                                                                     | Domain records still use JSON-backed SQLite/application scoping. Full domain normalization/RLS and actual external IdP acceptance remain. |
| 4 — isolation/gateway   | Four per-run compartments, no-network/non-root/read-only/resource limits, scoped gateway, probes, cleanup and actual Docker failure tests                                                                                                      | Prompt-only local threat model; independent host/GPU/side-channel or hostile-code isolation is not established.                           |
| 5 — evidence            | Canonical/hash-bound redacted packages, append-only ledgers, separate signer, pinned offline/UI verification and readable HTML/CSV/PDF-print reports                                                                                           | Independent signer ownership/receipts in a real deployment and ZIP packaging remain.                                                      |
| 6 — durable execution   | Durable queue, separate workers, atomic scoped reservations, leases/deadlines/budgets, acknowledged partial/unknown attempts, linked retries, orphan cleanup, monitoring and backup/restore tooling                                            | Single local broker; no distributed HA or exactly-once external model effects.                                                            |
| 7 — hackathon release   | Isolated seed/reset, five accounts, two policies, approved mini corpus, committed desktop/mobile regression, runbook, screenshots and recorded fixture fallback                                                                                | Independent teammate rehearsal remains. Fixtures must stay labeled as demonstrations.                                                     |
| 8 — pilot hardening     | Strict opt-in pilot profile, private secret files, proxy/header/rate controls, model approvals/revocation, incident containment, retention holds/plans/removal, compaction, Linux deployment templates, preflight, CI and load/recovery checks | Real pilot release requires external infrastructure, owners and independent acceptance gates. Templates are not a deployment.             |

Drafts, cloning and downloadable reports are retained as additional workflow features. They no longer replace the original Phase 6 definition.

## Required before a real restricted pilot

1. Configure and verify the actual HTTPS domain and IdP/MFA flow, including bootstrap/linking and production session behavior.
2. Deploy/verify the API, Docker runtime, signer and encrypted storage under reviewed separate privileges. Independently protect signer keys, ledger and public-key distribution.
3. Obtain an independent security/threat-model review for the allowed data and prompt-only execution scope. Confirm actual network/storage/host controls and acknowledge unsupported threats.
4. Assign real operations/security/data owners, incident escalation, retention rules and key/backup recovery duties.
5. Perform representative production load, actual restore/key-recovery drills and a teammate handoff; record reviewed reports and expiry in the deliberately unapproved acceptance template.

The local preflight and operator-recorded gates do not independently establish that these reviews happened. The app refuses its strict pilot profile when the required recorded gates are missing or expired.

## Remaining engineering/product work

Full domain-table normalization/database-enforced tenancy, ZIP evidence bundles, complete tenant/account data lifecycle and backup/media erasure workflows, broader evaluator calibration and distributed HA remain. Scheduling, multi-model campaigns, enterprise reporting and compliance integrations are later product work; no compliance certification is claimed.

## Commands and evidence

- Normal app: `npm run dev` → `http://127.0.0.1:5173`.
- Isolated hackathon demo: `npm run demo` → `http://127.0.0.1:5180`; generated credentials are private in `.data/hackathon/credentials.json`.
- Regression: `npm test`, `npm run build`, `npm run format:check`, `npm run test:e2e`.
- Pilot checks: `npm run pilot:check`, `npm run pilot:load`.
- Recovery: `npm run data:backup`, `npm run data:restore -- BACKUP NEW_DIRECTORY`, and stopped-only `npm run data:compact`.

See [acceptance record](ACCEPTANCE.md) for observed results, [Phase 8](PHASE8.md) for implementation limits, [operations](OPERATIONS.md) for procedures and [original roadmap](ROADMAP.md) for phase mapping.
