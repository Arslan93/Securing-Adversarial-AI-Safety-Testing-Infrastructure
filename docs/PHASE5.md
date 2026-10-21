# Phase 5 — signed evidence and completion checks

Phase 5 adds a separate Ed25519 evidence signer, pinned-key verification, an append-only audit ledger, signing-aware readiness, and a trust-aware Audit vault. It also closes the identified Phase 3 workflow gaps with authenticator MFA, one-use recovery codes, OIDC authorization-code/PKCE integration, organization invitations and recorded access-request decisions.

## Evidence service

```sh
npm run evidence:init
npm run evidence:signer
```

Initialization creates a private key, public key and 256-bit client token under `.data/signing` without overwriting existing files. The signer has its own SQLite ledger. The API reads the public key and client token; it does not load the private key. Configure:

```dotenv
BAYORA_SIGNER_SOCKET=.data/signing/signer.sock
BAYORA_SIGNER_TOKEN=.data/signing/client-token
BAYORA_EVIDENCE_PUBLIC_KEY=.data/signing/public.pem
BAYORA_REQUIRE_SIGNED_EVIDENCE=true
```

`npm run dev` supervises the signer alongside API and frontend when the signer socket is configured. `npm start` expects the signer to be managed separately. Readiness fails while required signing is unavailable. New runs register their first event/manifest with the signer before execution. If registration fails, the run is failed and no evaluation begins.

Finalized exports contain a detached attestation covering the complete canonical evidence payload, run scope, manifest, event count/anchor, key ID and timestamp. The signer requires the registered manifest/start event and refuses rollback or forks relative to earlier sealed checkpoints. Checkpoints also hash-link to the previous signer checkpoint. Signing does not change `DEMO_ONLY` or `UNVERIFIED` runtime classifications.

Verify with an independently supplied public key:

```sh
node scripts/verify-evidence.mjs evidence.json \
  --trusted-key /trusted/location/bayora-public.pem --require-signature
```

The verifier never trusts a public key embedded in an evidence file. Without a trusted key it reports hash consistency and an untrusted/unsigned status. Requiring a signature rejects unsigned historical exports. Historical v1/v2/v3 packages can still be checked for local consistency without that requirement. Runs created before signer registration are not silently given a retrospective pre-execution anchor; their exports remain historical unsigned evidence or fail strict signing requirements.

An old, valid signature establishes what was sealed at that time. Offline verification alone does not establish that a package is the newest checkpoint. Retain the signer ledger and distribute trusted keys/checkpoints through an independently managed channel.

## Actual trust boundary

The default development signer is a separate process running under the same OS account. It is useful for testing signatures, API separation and rollback checks, but it is **not independent of that account or a root administrator**. A protected deployment must run the signer as a separate account/service, restrict the private-key/ledger directory to it, give the API only its client credential/public key, and protect ledger backups. An optional `BAYORA_SIGNER_SOCKET_MODE=0660` permits a dedicated shared socket group; default mode is 0600. Set ownership/group membership through deployment tooling. Do not make the socket or private key world-accessible.

Neither the signer nor a signature proves a model response is truthful, a host is uncompromised, or side channels are impossible. The initial manifest is anchored before execution, and finalized reports are sealed; unsealed observations still depend on the trusted control plane. Independent runtime attestation is a separate deployment capability.

The application database now has append-only `audit_entries` with update/delete rejection triggers. Existing event streams are migrated without rewriting their hashes. Startup and persistence check state against ledger entries, rejecting truncated or altered history. A privileged database owner can drop triggers, so this ledger is not a substitute for an independently protected signer.

## MFA and account recovery

Open **Account & organizations → Multifactor authentication**. Re-enter your current password, copy the setup key into an authenticator app, and confirm a six-digit code. Ten recovery codes are shown once. Enabling MFA revokes other sessions and rotates the current one. Password sign-in then requires a fresh authenticator code or one recovery code. Codes cannot be replayed; challenges expire, and factor attempts are bounded. Disabling MFA requires both the current password and a fresh factor and signs out all sessions.

MFA secrets are AES-256-GCM encrypted using `BAYORA_AUTH_KEY` or the database directory's `auth-master.key`, created with private permissions. Back up the database and this key together. The service refuses to recreate a missing key if factor records already exist. Recovery codes are stored only as hashes. Do not lose all authenticators/recovery codes without an operator recovery procedure.

## OIDC

Configure a real provider before using external sign-in:

```dotenv
BAYORA_PUBLIC_ORIGIN=https://bayora.example
BAYORA_OIDC_ISSUER=https://identity.example/realm
BAYORA_OIDC_CLIENT_ID=bayora
BAYORA_OIDC_CLIENT_SECRET=YOUR_SECRET
BAYORA_OIDC_REQUIRE_MFA=true
```

Register the exact redirect URI `${BAYORA_PUBLIC_ORIGIN}/api/oidc/callback`. The issuer must use HTTPS. Explicit loopback HTTP is available only in development using `BAYORA_OIDC_ALLOW_HTTP=true` for protocol testing. Production serving disables local password auth (`BAYORA_DEMO_AUTH=false`), requires HTTPS public origin, required signing and IdP MFA. Local bootstrap/maintenance without authentication remains possible but is not a ready deployment.

Existing accounts link from Account settings after password/MFA reauthentication. Login validates issuer, signature/JWKS, audience, authorization code, PKCE S256, state, nonce and expiration through `openid-client`. When required, ID-token `amr` must include `mfa`, `otp` or `hwk`; configure your provider to issue those claims. Optional provider-specific ACR values can be set with `BAYORA_OIDC_ACR_VALUES`. Roles come from application memberships; email/role claims never auto-create administrators or link accounts.

A local test provider exercises real signed ID tokens and HTTP token/JWKS exchanges, including missing MFA and nonce/state failures. That is protocol integration validation, **not acceptance against your unconfigured external provider**. Establish the initial account/link in development before switching to the production configuration; do not enable a production profile with no linked administrator.

## Invitations and artifact decisions

Administrators create email-bound, expiring invitations in Administration. The token is shown once and is delivered through your trusted channel; no email is sent automatically. New members choose **Join with an invitation** on sign-in. Existing accounts accept it in Account settings. Tokens are stored as hashes and consumed once. Revocation, expiration, email mismatch, removed workspaces and revoked inviter authority prevent acceptance.

Eligible members request private dataset/policy access from Account settings. Artifact owners or organization administrators approve or deny with a reason; approval creates an expiring grant. Role/workspace restrictions still apply. Requests, decisions and grants are audited without putting private reasons or artifacts in evidence exports.

## Backups and operations

```sh
npm run data:backup
```

This writes a private, consistent SQLite backup plus the MFA encryption key to a new `.data/backups` directory. Stop the API before restoring both together; never restore only the database when it has enrolled factors. The signer operator backs up its private key and ledger separately. Backups contain private data and must be encrypted/access-controlled by deployment operations.

A complete deployment also needs TLS termination, protected credentials, trusted signer administration and an actual IdP connection. No percentage label replaces those external acceptance checks.
