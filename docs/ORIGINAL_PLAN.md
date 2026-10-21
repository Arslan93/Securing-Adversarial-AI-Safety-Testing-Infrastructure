# Original planning snapshot

Historical planning material supplied by the user. Its initial status/test counts describe the earlier prototype, not current completion. The original eight phase definitions below govern the roadmap. See ROADMAP.md for current status.

Bayora is currently a working local evaluation prototype. The main workflow works, but the PRD’s defining infrastructure feature—verified isolation between Red, Blue, and the model—is still unfinished.
I checked the repository and reran verification today. I did not change application code during this review.

1. Current status
   Area Status What exists
   Frontend Working Dashboard, workspaces, campaigns, policies, findings, audit screens, responsive layouts
   Backend Working locally Node.js API, validation, sessions, role checks, orchestration
   Persistence Working prototype SQLite persistence; application state stored as one JSON record
   Workspaces Partial Creation, selection, purpose, TTL and classification settings
   Authentication Demo only Freely selectable roles with expiring sessions
   Authorization Partial Server-side role restrictions and response redaction
   Policies Working basic version Published text rules, versions, hashes, frozen run snapshots
   Test library Limited 20 entries generated from five repeated templates
   Synthetic evaluation Working Predetermined fixtures for demonstrating the workflow
   Ollama inference Implemented Real paired requests, bounded generation, cancellation and timeouts
   Evaluation quality Limited Exact fictional-token disclosure check
   Findings and reviews Working basic version Case details, filtering, append-only analyst reviews
   Audit evidence Partial Hash chain, result/configuration binding, JSON export, verifier
   Runtime isolation Not implemented Diagram and intended settings; no container provisioning or network enforcement
   Production deployment Not ready Identity, tenancy, hardened execution, signing, and operational controls remain
   Current verification:
   Check Result
   Automated tests 21 passed
   Production build Passed
   Formatting Passed
   Git working tree Clean
   Frontend/backend processes Not running during inspection
   Ollama service Listening on port 11434
   Docker CLI Not found
   The first integration-test attempt could not start its server inside the sandbox. After allowing the temporary loopback server, all tests passed.
   The earlier live Ollama run is documented in the repository. I did not repeat live inference or browser testing today.
2. The most important remaining gaps
   These deserve attention before adding more screens.
   Gap Why it matters
   Anyone can select Admin The demo role picker does not establish identity
   No organization/workspace membership enforcement Roles alone cannot prevent cross-customer or cross-project access
   “Deny all egress” is stored metadata It does not currently install or verify network restrictions
   No separate runtime containers Red, Blue, and model execution are not independently contained
   Predictable canary The fictional token is derived from the run ID; it is unsuitable as a genuinely secret leakage probe
   Repeated test templates Twenty entries do not provide twenty distinct scenarios
   Narrow evaluator No token disclosure is labeled “Safe,” even though other unsafe behavior is not assessed
   Synthetic dashboard metrics Overview metrics exclude live runs; that needs clearer presentation or separate views
   Locally controlled audit anchor A privileged writer could rebuild the entire chain
   Global audit export Exports include the global event chain, rather than an independently scoped run/workspace evidence stream
   In-process execution Jobs depend on the API process rather than a durable worker system
   There is also a concurrency issue to address: live-run creation performs asynchronous model discovery between checking limits and recording the run. Simultaneous requests need an atomic reservation to guarantee concurrency and duplicate-submission limits.
   The status and coverage documentation is in [README.md](/Users/kratik/Desktop/Securing-Adversarial-AI-Safety-Testing-Infrastructure/README.md).
3. Proposed phases
   I would divide the project into eight phases. Phase 1 largely exists; the rest progressively turn it into the infrastructure described by the PRD.
   Phase Outcome Current position
   1 Reliable local foundation Mostly complete
   2 Meaningful evaluation and policy workflow Partially complete
   3 Real identity and scoped permissions Mostly remaining
   4 Enforced runtime isolation and gateway Remaining
   5 Independently verifiable evidence Partially complete
   6 Reliable execution and recovery Partially complete
   7 Integrated hackathon release Partially complete
   8 Restricted pilot and production hardening Remaining
4. Phase 1 — Stabilize the existing local foundation
   Purpose: Make the current application easy to understand, run, maintain, and demonstrate.
   The remaining work is to:

- Split the large frontend file into screens, reusable components, and API/state helpers.
- Split backend routing, authorization, persistence, and orchestration into separate modules.
- Add documented configuration and separate liveness/readiness endpoints.
- Correct copy that assumes every campaign is synthetic.
- Clearly separate synthetic metrics from live evaluation metrics.
- Improve unavailable-model, expired-session, failed-run, and empty-result states.
- Keep development identities explicitly restricted to development mode.
  The main files involved are src/main.jsx, server/index.mjs, and scripts/dev.mjs.
  Deliverable: A maintainable local application with predictable startup and accurate status messages.
  Exit criteria: A fresh checkout can install, start, execute a synthetic campaign, inspect results, and verify an export using the documented commands. Existing tests and build checks still pass.
  Owner track: Frontend and Backend.

5. Phase 2 — Build a meaningful evaluation workflow
   Purpose: Make the evaluation useful beyond the existing fixture demonstration.
   The work includes:

- Replace repeated templates with distinct, reviewed synthetic scenarios.
- Add a Red test composer with bounded prompt input and category selection.
- Add validated dataset import, versioning, and content digests.
- Allow selecting a dataset when creating a campaign.
- Generate an unpredictable private canary instead of deriving it from public run metadata.
- Expand scoring to distinguish disclosure, refusal, benign-task utility, transport failure, and inconclusive outcomes.
- Use labels such as “No exact disclosure detected” where broader safety has not been assessed.
- Add policy version comparison and a visible version diff.
- Compare runs only when dataset and model settings are compatible.
- Record separate baseline and defended attempts, including partial failures.
  The existing live adapter and review workflow are useful foundations.
  Deliverable: A user can create tests, publish policy v1 and v2, evaluate both against a frozen dataset, and inspect a meaningful comparison.
  Exit criteria: Results show their rubric, numerator, denominator, failed attempts, model revision, dataset version, and policy version. Changing a policy does not alter historical results.
  Owner track: AI/ML, with Backend and Frontend support.

6. Phase 3 — Implement real identity and scoped access
   Purpose: Ensure users can access only the organizations, workspaces, and artifacts they are entitled to.
   The work includes:

- Replace production use of the role picker with authenticated identities.
- Introduce organizations, users, workspace memberships, and role assignments.
- Normalize persistence into separate domain tables with migrations.
- Attach ownership and workspace scope to policies, datasets, runs, findings, and artifacts.
- Enforce access checks on every read, write, stream, and export.
- Scope idempotency keys to the appropriate identity and workspace.
- Separate private Red inputs, Blue drafts, model responses, and approved shared findings.
- Add explicit approval/grant flows for exceptional access.
- Invalidate access when membership or role changes.
  Moving to PostgreSQL is an option at this stage, but correct ownership and authorization are the requirement; changing databases alone does not provide them.
  Deliverable: Two independent workspaces can operate without accessing each other’s private material.
  Exit criteria: Negative tests attempt access using another user’s resource IDs, including direct API calls and exports. They receive denials without leaking protected content.
  Owner track: Backend/Security.

7. Phase 4 — Implement runtime isolation and the controlled gateway
   Purpose: Deliver the central infrastructure promise of Bayora.
   This phase requires a working container environment; Docker is currently unavailable here.
   The work includes:

- Define separate Red, Blue, and model service identities.
- Provision bounded runtimes with separate writable storage.
- Apply non-root execution, restricted capabilities, read-only filesystems, and resource limits.
- Enforce network restrictions that prevent direct Red-to-Blue and unauthorized model access.
- Route permitted evaluation requests through a gateway.
- Make gateway authorization fail closed.
- Add runtime leases, expiry, cancellation, and independently checked cleanup.
- Collect actual network, artifact-access, role, and context probe results.
- Mark runs INVALID when required boundary checks fail.
- Display probe evidence in the UI instead of relying on the conceptual topology diagram.
  A Compose file can describe a demo topology, but the restrictions still need testing.
  Deliverable: A controlled prompt-only demonstration with separate runtimes and recorded boundary checks.
  Exit criteria: Demonstrate a blocked direct connection, a permitted gateway request, a deliberate boundary failure that invalidates a run, and verified cleanup after cancellation.
  Owner track: Backend/Infrastructure.
  Container isolation should remain described according to the tested threat model; ordinary containers do not establish protection against every hostile-code or kernel threat.

8. Phase 5 — Strengthen evidence and independent verification
   Purpose: Make evidence verifiable outside the application’s writable database.
   The work includes:

- Define a versioned evidence schema and canonical serialization.
- Bind all relevant artifacts, verdicts, approvals, and cleanup receipts to evidence records.
- Scope evidence to the authorized run/workspace.
- Maintain append-only event storage with appropriately separated write privileges.
- Sign final manifests using a separately controlled signing identity.
- Retain an independent anchor or protected signed receipt.
- Verify signatures and signer identity in the offline verifier.
- Test altered files, missing artifacts, reordered events, and forged/rebuilt chains.
- Add ZIP packaging and a human-readable report.
- Keep raw restricted content excluded unless explicitly authorized.
  PDF reporting comes after correctness of the evidence contract.
  Deliverable: An evidence package that a separate verifier can check using an independently trusted public key or anchor.
  Exit criteria: Editing evidence fails verification, and an application/database writer cannot silently replace it with an accepted unsigned reconstruction.
  Owner track: Backend/Security, with Frontend support for export and verification.

9. Phase 6 — Make execution durable and recoverable
   Purpose: Keep results and resource limits correct when processes fail or requests arrive simultaneously.
   The work includes:

- Move execution out of the API process into workers.
- Add a durable queue and persistent job leases.
- Make run creation, idempotency, and quota reservation atomic.
- Enforce deadlines and budgets across process restarts.
- Record partial attempts and retry metadata.
- Make retries create linked execution records rather than overwrite history.
- Reconcile orphaned runtime resources.
- Add queue, provider, gateway, audit, and cleanup health monitoring.
- Implement retention, backup, and restore procedures.
- Add failure-injection tests.
  Deliverable: Runs remain explainable and recoverable when the API, worker, model service, or runtime fails.
  Exit criteria: Stop a worker mid-run, restart it, and demonstrate accurate terminal status, preserved evidence, no duplicate execution, and cleanup within the agreed deadline.
  Owner track: Backend/Infrastructure.

10. Phase 7 — Prepare the integrated hackathon release
    Purpose: Turn the implemented capabilities into one convincing, repeatable demonstration.
    The work includes:

- Connect identity, test authoring, policies, execution, probes, findings, and evidence in one operator journey.
- Add browser regression tests for the primary paths.
- Test desktop, mobile, role denials, reconnects, failures, cancellation, and tamper detection.
- Prepare a small approved dataset and two policy versions.
- Provide a clean demo seed/reset process.
- Prepare an architecture explanation that matches the deployed code.
- Document which controls are implemented, tested, simulated, or deferred.
- Record a fallback demo for model-service or hardware failures.
  Deliverable: A release candidate and a five-minute demo.
  Exit criteria: Another team member can run the demonstration from the instructions without developer intervention, and every security claim has corresponding evidence.
  Owner track: All three tracks.
  The presentation should demonstrate:
  Create evaluation
  ↓
  Freeze dataset and policy
  ↓
  Check runtime boundaries
  ↓
  Run baseline and defended arms
  ↓
  Inspect failure and review it
  ↓
  Export evidence
  ↓
  Reject tampered evidence
  ↓
  Verify cleanup

11. Phase 8 — Restricted pilot and production hardening
    Purpose: Support real users and sensitive data after the hackathon.
    Remaining work includes stronger threat-appropriate isolation, secrets management, external security review, deployment hardening, tenant data retention/deletion, backup recovery drills, load testing, incident procedures, model-provider approval, and operational ownership.
    Multi-model support, scheduling, enterprise reporting, and compliance integrations belong here or in later product iterations.
    Deliverable: A restricted research pilot with documented controls and operational responsibilities.
    Exit criteria: The pilot’s agreed security, privacy, recovery, and performance requirements have been independently reviewed and tested. Production readiness is a separate release decision.
