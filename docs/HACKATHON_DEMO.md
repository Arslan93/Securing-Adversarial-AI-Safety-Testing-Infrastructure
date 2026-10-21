# Bayora — five-minute hackathon demo

## Start and prepare

Requires Node 24+, npm and an installed local browser. From a fresh checkout:

```sh
npm install
npm run build
npm run demo:seed
npm run demo
```

The demo is at **http://127.0.0.1:5180** (API 3080). Read the generated private `.data/hackathon/credentials.json` locally for five individual role accounts. Passwords are random; there are no hardcoded credentials. The dedicated workspace contains the reviewed distinct corpus, a three-case approved mini corpus and Context protection policies v1/v2. No historical runs or improvement percentages are fabricated.

If the demo is already seeded, skip `demo:seed`. Stop it before `npm run demo:reset`; reset moves the prior demo into `.data/demo-archives` and reseeds. It never resets `.data/bayora.db`. Port conflicts fail explicitly. The demo owns a separate signer/ledger; normal `npm run dev` can remain separate on 5173/3001.

## Five-minute operator journey

| Time      | Action                                                                                                                          | What to explain                                                                                                                                              |
| --------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 0:00–0:40 | Sign in as Admin. Open Administration and Execution & recovery.                                                                 | Real accounts, membership boundaries, durable queue/leases and current cleanup state. Explain fixture vs local live results.                                 |
| 0:40–1:20 | Open Test library and Policy lab. Inspect approved scenarios and compare Context protection v1/v2.                              | Immutable dataset/policy versions. Private Red prompts and Blue rules are role-scoped. Imported/uploaded code is never executed.                             |
| 1:20–2:00 | New campaign: choose frozen dataset/policy. Use Synthetic adapter for a guaranteed offline workflow; Save draft, Resume, Start. | Configuration freezes; a worker runs baseline/defended arms. Fixture outcomes are predetermined workflow demonstrations.                                     |
| 2:00–2:40 | Inspect denominators, case detail and append an analyst review with a reason.                                                   | Original outcomes remain unchanged. Live scoring checks exact fictional-canary disclosure and limited utility; it is not general model-safety certification. |
| 2:40–3:30 | Export evidence and Printable report. Upload the JSON in Audit vault.                                                           | Trusted-key signature verification; report/CSV are derived summaries. Show a previously tampered copy being rejected.                                        |
| 3:30–4:20 | Clone a campaign, launch, cancel it. Inspect cleanup.                                                                           | New ID/source lineage; cancellation and terminal history. In container mode show all four profiles/probes and confirmed removal.                             |
| 4:20–5:00 | Show Runtime readiness and the local acceptance evidence. Sign in as Auditor in another session if time permits.                | Blocked writes/private outputs, actual Docker enforcement vs independent attestation, and remaining Phase 8 responsibilities.                                |

Fixture scoring is fixed; publishing policy v2 does not imply a measured safety improvement in fixture mode. Never present fixture rates as model benchmarks.

## Optional live-isolation branch

On the already-configured development machine start/resume `colima start bayora --activate=false` if needed. The real CPU/model setup is in PHASE4.md. The demo inherits approved local Docker/model settings if configured; it never downloads models automatically. Choose **Container Ollama**, select **Hackathon approved mini corpus**, acknowledge consent and launch. Allow additional time for CPU model calls. Show four-role profile/probe evidence and cleanup, with the `UNVERIFIED` qualification visible.

`npm run runtime:worker-acceptance` demonstrates a real worker failure, resource removal, signed failed evidence and a new linked successful execution in an isolated acceptance database. This is optional infrastructure proof, not a step to improvise against a judge's running campaign.

## Offline fallback and regression

```sh
npm run build
npm run test:e2e
```

Recording requires the matching Playwright encoder; install it once with `npx playwright install ffmpeg`.

This runs a signed fixture journey without Docker/Ollama, in a temporary workspace. It prints the artifact directory containing screenshots, `fallback-demo.webm`, redacted HTML/CSV, signed JSON, a tampered copy and a printed PDF. Play the recorded fixture fallback if live hardware/model service fails. It is visibly a synthetic workflow recording; do not claim it proves real-time isolation. The real runtime acceptance is recorded separately in ACCEPTANCE.md.

For offline signature verification use the matching demo public key, not the normal workspace's key:

```sh
npm run evidence:verify -- /path/to/evidence.json --trusted-key /path/to/matching/signing/public.pem --require-signature
```

Generate a tampered copy by changing one event/hash in a copied JSON file; keep the original. The signature verifier must reject the copy.

## Teammate rehearsal checklist

A teammate should follow this runbook on their machine, complete the fixture journey, verify an export, reject tampering, and reset/reseed without touching the main workspace. Record their environment and any blockers before presenting. Local automated acceptance has passed; an independent human handoff rehearsal has not been claimed.
