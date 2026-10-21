# Bayora code structure

The frontend follows atomic design. Backend services use responsibility-based modules; HTTP handlers and database operations do not belong in UI atoms.

```text
src/
  components/
    atoms/          Button, Input, Select, Textarea, Badge
    molecules/      FormField, Logo, Metric, Empty
    organisms/      Sidebar, AppHeader, AuthForm, MembershipManager,
                    CampaignDialog, RunDetail, RunComparison, tables/charts
    templates/      AuthTemplate, WorkspaceTemplate (layout slots)
  pages/            Route-level screen composition, including AccountScreen
  hooks/            Session lifecycle, workbench actions, local model discovery
  lib/              API transport, formatting, navigation, metric calculations
  App.jsx           Application composition and page selection
  main.jsx          React entry point
```

Dependency direction: atoms → molecules → organisms → templates/pages → App. The arrow means “composed into.” Atoms use native elements and props, without API calls or knowledge of users, runs, or workspaces. Molecules combine small primitives. Organisms own a complete interaction or feature view. Templates accept layout slots and children; pages connect features to application state. Hooks and lib are shared nonvisual modules. Import components directly from their files rather than creating a giant barrel module.

## Request flow

1. An event handler calls `src/lib/api.js`. It sends the HttpOnly session cookie through the browser and includes the in-memory session CSRF token for writes.
2. `server/app.mjs` checks host/origin, parses bounded JSON, resolves a persisted session, checks the CSRF token, then enters a request-local authorization context.
3. `server/auth.mjs` handles setup, password sign-in, bounded password derivation, and sessions. `server/identity.mjs` owns normalized SQLite identity tables and scrypt password hashing. `server/routes/accounts.mjs` handles organizations, memberships, password changes, and explicit artifact grants.
4. `server/access.mjs` scopes domain collections by organization and workspace membership. Inserts receive organization/owner IDs from the server, never from client-supplied ownership. Route modules separately check role capabilities and private-artifact access. Asynchronous run launch revalidates the session before committing a run.
5. Registry/dataset/run handlers validate domain inputs. `server/orchestrator.mjs` advances fixture or local Ollama work. Snapshots are frozen before execution; revoking an operator's session does not erase an already authorized job or its evidence.
6. `server/store.mjs` persists domain state and scoped audit streams. New evidence exports contain only the selected run's event chain. Historical chains are preserved, with legacy global exports restricted to organization administrators.

## Persistence and scope

SQLite tables `users`, `organizations`, `memberships`, `sessions`, and `schema_migrations` hold identity state. Passwords use salted scrypt; session bearer tokens are SHA-256 digests at rest. Sessions survive server restart until expiration or revocation. A membership has one role per organization and an explicit workspace allowlist. Organization administrators can manage all workspaces in their organization. Per-workspace role overrides are not implemented.

Domain entities and grants still use the existing SQLite JSON state record. This preserves previous run snapshots and event hash formats. Organization and workspace isolation is application-enforced, not database row-level security. Request-local scoped access prevents domain handlers from returning another organization's records. The API broker, worker processes and local database owner remain trusted. Separating domain tables and runtime service identities is future infrastructure work.

On the first setup, the local administrator claims existing records. The approved seed corpus/default policy remain shared within that organization; other legacy artifacts belong to the claimant. Old event content and snapshot hashes are not rewritten. No hardcoded accounts or default passwords exist. Keep `.data/bayora.db` private and back it up before moving machines.

Private model response access requires an eligible role plus ownership or a live grant for both private dataset and policy inputs. Blue and Auditor always receive redacted responses. A grant never adds a role capability or workspace membership. Already authorized downloaded data cannot be recalled after grant revocation.

This local hackathon implementation now includes OIDC/MFA, invitations and live container checks. Phase 5 adds a separate signer and append-only audit tables. Connecting an actual external IdP, protecting the signer under independent administration, database privilege separation and hardened public deployment remain operational work.

## Phase 4 runtime path

`server/runtime/profile.mjs` defines and inspects the fixed container profile. `command.mjs` owns bounded shell-free Docker subprocesses. `docker.mjs` handles preflight, four-role provisioning, frozen model checks, boundary probes, a fixed model bridge, and ownership-checked removal. `gateway.mjs` holds ephemeral capabilities and enforces scope, schema, canonical context, ordering and call quotas. `runtime/worker.mjs` and `runtime/bridge.mjs` run inside approved images built with `runtime/Dockerfile`.

The orchestrator chooses the container path only from a frozen `snapshot.runtime`, records allocated resource names before creation, and waits for teardown before successful finalization. Startup reconciles incomplete cleanup. Run summaries omit internal resource names; evidence binds sanitized runtime reports. The control plane and Docker daemon remain trusted. See [Phase 4 runbook](PHASE4.md) for setup and actual-validation requirements.

## Phase 5 security and evidence

`server/evidence/signatures.mjs` canonicalizes and verifies packages against explicit trusted public keys. `signer.mjs` is a separate Unix-socket service with private keys, immutable registrations and append-only checkpoint rows. `client.mjs` authenticates API-to-signer traffic, checks pinned key identity, registers the first run event before execution, and verifies returned signatures. The API process does not load the signing private key. The main store mirrors historical/new audit streams into append-only SQLite rows and refuses history rollback.

`mfa.mjs` implements RFC 6238 authenticator checks, encrypted secrets, replay prevention and hashed one-use recovery codes. `security-store.mjs` persists factors, OIDC identity links and invitation hashes. `oidc.mjs` delegates protocol/JWT validation to `openid-client`; subject links require account reauthentication and provider claims cannot assign roles. `routes/collaboration.mjs` handles invitations and artifact request decisions. New UI organisms keep these workflows inside the existing atomic layers.

The signer and API share an OS account in local development, so process separation is not an independent trust boundary against that account. Deployment can use separate users and a restricted socket group, or an independently operated signing service adapter. See [Phase 5 operations](PHASE5.md).

## Additional campaign preparation and reporting

`routes/drafts.mjs` and `drafts.mjs` manage persisted, revisioned configurations and source-run cloning. `access.mjs` restricts drafts to their owner or organization administrator within accessible workspaces. Run creation resolves drafts on the server, consumes their revision once, and binds clone lineage into the new manifest. `reports.mjs` renders a fixed redacted field allowlist into escaped printable HTML and spreadsheet-safe CSV; it uses the existing finalized/signed export path. `CampaignDrafts` and `ReportActions` are UI organisms composed into campaign/run pages; saving and resuming remain in `useWorkbench` and `CampaignDialog`.

## Original Phase 6 execution boundary

`execution/broker.mjs` owns dispatch, lease heartbeats, fencing, recovery and worker shutdown. `queue.mjs` persists job reservations with unique organization/user/workspace/request keys. Run creation, queue reservation and initial audit records commit together in `store.mjs`. A broker lock refuses a second API owner for the same database, preventing JSON-state writers from overwriting one another. This remains a local single-broker topology.

Each `execution/worker.mjs` child runs the existing orchestrator and gateway without signing/OIDC/session/MFA configuration. It sends state/events through private IPC. The broker acknowledges SQLite persistence before worker model calls or container creation proceed. `attempt.started` records precede external model calls; a lost worker leaves an explicit unknown outcome. Completed attempts and raw responses retain existing role restrictions. The broker does not automatically replay an uncertain provider call.

The original frozen deadline and call budget are manifest-bound and stored in the job row. Worker messages require a current lease token. A dead/unresponsive worker group is stopped, partial history is finalized and ownership-checked Docker cleanup runs before releasing its capacity slot. New linked runs implement retries. A disconnected child exits; restart reconciles persisted worker/resource records, while untouched READY jobs remain eligible to execute.

The API and worker processes share an OS account. IPC separation is an execution/lifecycle boundary, not an independently protected security principal. Database domain normalization and distributed worker services remain future infrastructure work.

## Phase 8 control plane

`pilot-store.mjs` persists organization model approvals, pause state and retention holds. `pilot.mjs` applies the current approval/containment policy at admission, dispatch and worker persistence/heartbeat boundaries. `pilot-acceptance.mjs` validates operator-recorded report gates and expiry; it does not establish reviewer independence. `secrets.mjs` loads protected regular-file secrets. `hardening.mjs` applies forwarding checks, security headers and bounded request admission; `app.mjs` configures server timeouts.

Session schema migration 8 records authentication method, issuer and MFA assurance. OIDC callbacks issue that assurance only after signed token/protocol validation; production refuses legacy/local sessions. `retention.mjs` supports holds and expiring fingerprint-bound plans, strips private workspace/snapshot content, and preserves the original public manifest for evidence verification. The Admin UI composes `PilotControls`, `ModelApprovals` and `RetentionControls` organisms using existing atoms.

`deploy/` contains uninstalled Linux API/signer account and HTTPS proxy templates. Operational evidence/ownership are external gates, not generated approvals. The supported default remains local development; no local data is purged or main configuration switched to pilot mode by implementing these controls.
