# Phase 6 — durable execution and recovery

This follows the original eight-phase plan. Drafts/cloning/reports were incorrectly labeled Phase 6 previously; they are retained in [WORKFLOW_REPORTS.md](WORKFLOW_REPORTS.md).

## Supported execution topology

One local API broker owns the domain store; separate child worker processes execute evaluations. SQLite `execution_jobs` holds job state, scoped idempotency, deadlines, model-call budgets, lease tokens, heartbeats and worker PIDs. A private broker lock refuses two API processes sharing one database. This is durable local execution with fail-stop recovery, not distributed high availability.

The initial run/audit/queue reservation commit in the same SQLite transaction. A unique organization/user/workspace/request key prevents duplicates and durable reserved slots enforce the configured global capacity. Slots include reserved, ready, running and cleanup-failed jobs. `BAYORA_MAX_ACTIVE_RUNS` bounds admitted work; `BAYORA_WORKER_CONCURRENCY` (default 1) bounds simultaneously dispatched workers. There is no unbounded backlog. Signer registration must succeed before a reserved job becomes dispatchable.

Workers receive execution settings through private IPC, not identity/signing credentials. SQLite persistence acknowledgements precede model requests and runtime resource creation. Started-attempt metadata records a possibly executed call even when no response acknowledgement arrives. Partial completed attempts remain unchanged. An interrupted in-flight request becomes a failed/unknown outcome and is never replayed automatically.

## Failure behavior

- **Worker exits or is killed:** finalize the run as failed, retain completed/unknown attempts and evidence, remove tracked container resources and check absence. Shared Ollama remains a separately managed service.
- **Worker stops heartbeating:** `BAYORA_WORKER_LEASE_MS` defaults to 5000; the broker polls every 250 ms, rejects stale tokens/heartbeats and stops the worker group. Cleanup then runs using bounded Docker commands. Actual Docker availability determines whether removal succeeds; failures remain visible and retain capacity.
- **API stops/restarts:** disconnected workers exit. Persisted RUNNING/RESERVED records are finalized without replay; actual recorded resources are reconciled. Untouched READY records survive and dispatch using their original deadlines. The broker verifies a persisted PID's worker command/job identity before signaling its process group.
- **Deadline expires:** queued work fails without starting; running work is stopped and cleaned up. Restart does not grant a new TTL. The deadline, maximum model calls and retry attempt number are bound into the public frozen manifest.
- **Provider response is lost:** preserve the uncertainty. Do not interpret it as a refusal or claim the provider did not execute the request.
- **Retry:** use **Retry as new evaluation** on a failed run. Original dataset/policy IDs prefill a new configuration; fresh consent/discovery apply. The new run has its own ID, linked parent and incremented execution attempt number. Historical evidence is preserved.

The system does not claim exactly-once external model effects. It provides a single claimed execution per job and explicit unknown outcomes rather than automatic replay of uncertain calls. A process failure can also lose work before its first persistence acknowledgement; its reserved start remains explainable.

## Monitoring

**Administration → Execution & recovery** reports organization-scoped queue counts, running workers, lease window and outstanding cleanup. `GET /api/operations` is Admin-only and reports queue/audit/lease checks and bounded job metadata. Liveness/readiness remain separate. Provider/model revisions are checked at live launch; the container gateway enforces per-run identity/order/quota and emits audit events. **Runtime readiness** checks the daemon/profile separately. None of these host observations establishes independent attestation.

## Retention and recovery operations

All execution records and audit/checkpoint history are retained by default; no automated destructive pruning is enabled. Archive old workspace data only through an agreed operator retention policy. Keep sensitive database/MFA-key backups private. The append-only audit contract must not be bypassed to reclaim space. Pilot-specific expiration/deletion is Phase 8.

```sh
npm run data:backup
npm run data:restore -- /path/to/backup /path/to/new-restore-directory
```

Restore refuses an existing destination, copies database and MFA key together, checks SQLite integrity and verifies persisted audit history. This safely supports restore drills without overwriting the live workspace. For operational recovery stop Bayora first; restore at its original database path so runtime ownership labels still match. Resolve existing resources and WAL files before replacing a stopped database. Configure the restored MFA key path, and restore the separate signer key/ledger from the signer operator's backup. Do not run the original and restore copy concurrently against the same runtime resources. Preserve keys/ledgers and prior backups during recovery.

## Acceptance

Automated tests exercise SQLite reservation conflicts/quota, stale leases, actual subprocess kill, unknown/partial model attempts, linked retry, queued restart, persisted deadline expiry and SIGSTOP heartbeat loss. The real Docker acceptance also kills a worker during an actual isolated model request, verifies all containers are removed, verifies failed signed evidence, and completes a fresh signed linked retry.

```sh
node --test server/execution.test.mjs server/release.test.mjs
npm run runtime:worker-acceptance
```

The latter requires the configured real runtime and running signer and uses `.data/worker-acceptance.db`, separate from the main workspace. Local failure windows were observed; no bound is promised when Docker/host storage is unavailable. See [acceptance record](ACCEPTANCE.md).
