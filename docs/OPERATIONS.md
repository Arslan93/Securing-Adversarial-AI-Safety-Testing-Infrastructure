# Bayora operations runbook

This is a procedure template. Record real named owners and reviewed reports in the deployment acceptance file; no owner or external approval is invented by the repository.

## Startup and routine checks

- Local hackathon: `npm run dev`; separate demo: `npm run demo`. Neither represents an approved production pilot.
- Restricted pilot: use the reviewed Linux service/proxy configuration, then `npm run pilot:check`. Check actual browser OIDC/MFA login, trusted evidence verification, exact model approvals and runtime readiness.
- Watch organization-scoped Execution & recovery, incident pause state, pending container cleanup and signer readiness. Missing required signing or expired acceptance must stop admission. Keep public API and Docker/socket access restricted to the reviewed deployment topology.

## Containment and investigation

1. Admin pauses organization evaluations with an incident reason. New launches are blocked; broker checks stop workers and preserve completed/unknown attempts.
2. Verify cleanup. If Docker is unreachable, keep the incident paused; do not claim resources are removed. Recover the daemon and retry ownership-checked cleanup.
3. Export/verify evidence, capture request IDs and sanitized operational state, and take a consistent private backup. Keep private artifacts out of tickets/logs unless explicitly authorized.
4. Revoke affected model revisions, IdP sessions or local memberships as appropriate. Rotate API client credentials and signing keys through their separate operators; retain trusted old public keys/checkpoints for historical verification. The current API pins one public key per configuration, so verify older packages with their original independently trusted key.
5. If host/API/signing compromise is suspected, isolate the host at infrastructure level and involve the named security owner. A dashboard pause cannot establish a compromised host's honesty.
6. Record the reviewed root cause, restore/retest affected controls, update relevant acceptance evidence and explicitly resume with a reason. Preserve history; retries use new linked runs.

## Backup and restore drill

Back up database and MFA key together. Back up signer key/ledger separately under its operator; do not place them in the API backup directory. Encrypt/protect backup storage and test key availability.

Use `data:restore` into a new directory for a nondestructive verification drill. Compare audit/event counts and identities, verify trusted evidence and enrolled-factor recovery, and record timings against agreed recovery targets. For a real restore, stop services first, reconcile orphaned resources, retain the failed database for investigation and restore to the original configured path so resource ownership labels still match. Review WAL/checkpoint files before replacing a stopped database. Do not simultaneously serve original and restored copies.

## Retention review

Record the data owner's retention window for private inputs/responses, public evidence/audit metadata, backups, signer records and downloaded exports separately. Use holds while review is pending. The application's reviewed workspace removal preserves public evidence and shared organization content. Complete tenant/account lifecycle deletion and physical media guarantees require additional design/operational controls; do not label workspace retirement as those capabilities.

## Review cadence and ownership

Set a real review cadence and acceptance expiry (maximum 90 days), along with patch/dependency review, IdP/provider changes, model revision approval, backup restore exercises, representative load tests and incident contacts. Re-review after a security-relevant configuration or trust-boundary change. `npm audit` and passing tests support review; they do not replace an independent security assessment.
