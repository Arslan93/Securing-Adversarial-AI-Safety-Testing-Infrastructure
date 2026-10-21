# Phase 7 — integrated hackathon release

This phase follows the original roadmap. The release integrates identity, datasets/policies, isolated/fixture execution, findings, cleanup and verifiable exports rather than adding an unsupported security claim.

## Release entry points

- `npm run demo:seed`: isolated `.data/hackathon` database, five individual generated-password accounts, two policy versions, reviewed corpus and dedicated signer. Refuses an existing database.
- `npm run demo`: demo frontend/API/signer at 5180/3080; seeds if absent.
- `npm run demo:reset`: after stopping the demo, archive the old marked demo directory and reseed. No main workspace deletion.
- `npm run test:e2e`: committed browser regression in a temporary signed fixture workspace, with screenshots, downloads and a recorded fallback video. Requires the matching Playwright video encoder (`npx playwright install ffmpeg`). Uses installed Chromium or local Chrome; `BAYORA_CHROME_PATH` overrides the executable. `BAYORA_E2E_PORT` overrides its default 3088 test port.
- `npm run runtime:worker-acceptance`: real approved Docker worker-loss/cleanup/linked-retry checks, separate from browser fixtures.

See [five-minute demonstration](HACKATHON_DEMO.md), [architecture](ARCHITECTURE.md), [roadmap](ROADMAP.md) and [acceptance record](ACCEPTANCE.md).

## Claim/evidence matrix

| Claim                       | Implemented and tested                                                             | Qualification                                                                                        |
| --------------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Roles and private artifacts | Membership/ownership/grant tests plus Auditor UI/API denials                       | Same-account local host/database owner remains trusted; no database RLS.                             |
| Frozen comparisons          | Version/digest/paired-attempt and compatible-run tests                             | Rubrics are limited; fixtures are deterministic demonstrations.                                      |
| Runtime boundaries          | Actual Docker network/filesystem/resource/OOM/cleanup acceptance                   | No hostile-code, GPU/side-channel or independent host attestation guarantee.                         |
| Durable local execution     | SQLite reservations, separate workers, leases, kill/pause/restart/deadline tests   | Single broker; unknown provider outcomes are retained, not automatically replayed.                   |
| Evidence integrity          | Signer IPC, pinned offline verification, rollback/tamper tests and browser uploads | Development signer shares the OS account; independent administration is a deployment responsibility. |
| Demo workflow               | Seed/reset, desktop/mobile browser regression, signed reports and reconnect tests  | Recorded fallback uses fixtures; no live model/safety claims.                                        |
| Recovery                    | Private consistent backup and verified restore drill                               | Signer backup is separately operated; incident/production recovery remains Phase 8.                  |

## Remaining release acceptance

The automated/local release candidate is prepared. A second team member must still rehearse the published instructions independently. External IdP acceptance, independently administered signer, hardened public deployment and pilot-specific retention/security review remain outside the hackathon release. ZIP packaging/full domain normalization remain earlier-phase PRD gaps rather than being hidden by a completion percentage.
