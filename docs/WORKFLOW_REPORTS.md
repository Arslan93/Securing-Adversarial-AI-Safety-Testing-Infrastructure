# Additional workflow — campaign preparation and reporting

These extra workflow features were initially mislabeled as Phase 6. The original roadmap defines Phase 6 as durable execution and recovery; that implementation is now documented in PHASE6.md. Drafts, cloning and reports remain supported as additions to the original roadmap.

## Campaign preparation

Admin and Analyst can choose **New campaign → Save draft**. A draft stores a name, workspace, published policy ID, immutable dataset version ID, adapter, selected model and optional source campaign. Saving never performs inference, reserves runtime resources or records reusable inference consent. A live draft needs a selected model; a previously saved model remains available for saving even when discovery is temporarily unavailable.

**Campaigns → Saved drafts → Resume draft** restores the configuration. Saving an edit increments its revision. The server rejects stale updates, archives and launches with a refresh/reopen message; two clients cannot silently overwrite one another. Existing drafts stay in their original workspace. Archive removes a draft from the active list without deleting its record. At most 100 visible active drafts are permitted.

Drafts are private to their creator and organization administrators and require workspace access. Blue, Red and Auditor cannot list, create or edit drafts. Draft mutations use the existing session/CSRF checks and append organization audit events without copying private artifact content.

Launching resolves the stored draft configuration on the server rather than trusting client overrides. It rechecks membership, revision, concurrency, dataset/policy availability, model revision, current inference consent and required signer registration. The launch consumes the draft and links it to a newly identified run, even if signer registration subsequently fails. Retrying the same request key returns that run; another request cannot launch the consumed draft again. Existing run snapshots and IDs remain unchanged.

## Cloning

A finalized run offers **Clone campaign**. The dialog is prefilled with its workspace, exact dataset/policy version IDs, adapter and model selection. Model discovery and inference consent are fresh. No private rules, raw prompts, responses, signing state or previous consent are returned by the configuration endpoint.

Save the clone as a draft or start a new evaluation. The new run has a fresh ID and a parent campaign ID. The parent is also included in its public frozen manifest so the evidence binds that lineage. Missing historical artifact versions prevent cloning with an error instead of silently substituting current versions. This clones configuration; it does not promise identical nondeterministic model output.

## Reports

A finalized run provides three downloads:

- **Printable report**: a standalone HTML file containing frozen configuration metadata, rates with explicit comparable adversarial denominators, case outcomes and provenance. Open it in a browser and choose **Print → Save as PDF** for a PDF copy.
- **Case CSV**: redacted case ID, category, type, baseline and defended outcomes for spreadsheet analysis. Cells are quoted and leading spreadsheet formula characters are neutralized.
- **Export evidence**: the existing verifiable JSON package, sealed when signing is configured.

Both report downloads use the same finalized evidence construction and required signer availability checks as JSON exports. Active runs and unfinished container cleanup cannot produce reports. Reports use a fixed field allowlist; private prompts, policy rules, response bodies, review reasons and credentials are excluded. HTML content is escaped, has no external assets/scripts, and has a restrictive content security policy. Signature status is checked against the API's configured trusted key, never an embedded key.

The printable summary and CSV are derived artifacts and **are not digitally signed**. Keep the signed JSON and verify it using an independently distributed public key. `DEMO_ONLY` and `UNVERIFIED` qualifications remain visible. A signature/checkpoint does not certify model safety or host isolation. An empty/noncomparable cohort is unassessed rather than a fabricated zero rate.

## Code and verification

`server/drafts.mjs` validates configurations and revision checks. `server/routes/drafts.mjs` owns draft mutations and configuration cloning. The scoped store persists drafts in the existing SQLite-backed domain record. `server/reports.mjs` produces escaped HTML and spreadsheet-safe CSV from redacted evidence. Run creation/export routes enforce launch/finalization/signing requirements.

Atomic UI organisms `CampaignDrafts` and `ReportActions` compose existing primitives. `CampaignDialog`, `useWorkbench` and run/campaign pages connect save, resume, clone and download actions.

Four integration/unit tests cover persistence, stale writes, one-time launch/idempotency, ownership/organization boundaries, frozen lineage, unfinished export rejection, redaction, denominator handling, HTML escaping and CSV injection protection. See [acceptance record](ACCEPTANCE.md) for observed end-to-end checks.
