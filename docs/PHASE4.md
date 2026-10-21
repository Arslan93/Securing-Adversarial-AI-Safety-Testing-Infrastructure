# Phase 4 — runtime compartments and controlled inference

Phase 4 adds an opt-in **Container Ollama** execution profile alongside fixtures and the existing shared local Ollama mode. An isolated run provisions four fresh CPU containers: a Red prompt worker, a Blue policy worker, a baseline model, and a defended model. Text inputs are never evaluated as code. Red and Blue workers validate and forward their own bounded input; they are not autonomous agents and do not execute user-uploaded programs.

Every container uses `--network=none`, an unprivileged UID/GID 65532, a read-only root, no added Linux capabilities, `no-new-privileges`, private namespaces, bounded CPU/memory/PIDs, a bounded `/tmp`, and disabled Docker logs. Only model containers receive the administrator-approved model volume, mounted read-only. There are no host-directory mounts, published ports, shared role volumes, Docker socket mounts, GPU devices, or automatic image/model downloads during evaluation. Container create/start/inspect and stdin-based exec use argument arrays without a shell. Inputs never appear in CLI arguments.

The control plane is trusted. It alone holds ephemeral run/role capabilities and Docker access. A controlled gateway accepts only the pinned model, fixed sampler/token limits, canonical baseline/defended system context, and the next approved case/arm. Wrong organization/workspace/run, wrong identity, replay, out-of-order traffic, unknown tool/API fields, arbitrary URLs, expired capabilities, and excessive calls are denied. The model bridge can call only its own container's loopback Ollama chat/tags endpoints. This is local IPC through Docker exec, **not** a separately deployed mTLS gateway.

## Honest verification boundary

The backend checks actual Docker inspect results and executes probes in all four containers for UID, read-only paths, loopback-only interfaces, and actual cgroup memory/CPU/PID limits. Baseline and defended model manifests must match the frozen model revision. These are observations made by the same trusted host that operates the containers. A compromised host/daemon can fabricate them. Shared-kernel/cache side channels, GPU isolation, model-weight correctness, and independent integrity attestation are not proven.

**All live runs remain `UNVERIFIED`, including runs whose container profile checks pass.** Fixtures remain `DEMO_ONLY`. A container launch never silently falls back to the shared host Ollama service. Docker is now installed and running in the project-specific Colima `bayora` profile. Real CPU image builds, provisioning, model calls, resource/network checks, cancellation and restart cleanup have passed. Simulated-engine tests continue to cover additional failure paths. The observed enforcement does not certify the host or rule out side channels.

## Local setup

Install/start a local Linux Docker engine (Docker Desktop on macOS is one option). The backend requires a local Unix Docker endpoint and a daemon with its default seccomp support, cgroup v2, and working memory/swap/CPU/PID limit controllers. The account running Bayora must be allowed to use Docker; treat that account and the Docker daemon as trusted administrators. Public production serving is still disabled.

Build from administrator-approved **digest-pinned** official Node and Ollama base images. Replace the placeholder digests with reviewed images for your architecture. Use a Debian-based Node image compatible with the Ubuntu-based Ollama image; the model build executes `node --version` to reject missing runtime dependencies early.

```sh
export BAYORA_NODE_BASE='node@sha256:REPLACE_WITH_APPROVED_NODE_DIGEST'
export BAYORA_OLLAMA_BASE='ollama/ollama@sha256:REPLACE_WITH_APPROVED_OLLAMA_DIGEST'

docker build -f runtime/Dockerfile --target worker \
  --build-arg NODE_IMAGE="$BAYORA_NODE_BASE" \
  --build-arg OLLAMA_IMAGE="$BAYORA_OLLAMA_BASE" \
  -t bayora-worker:phase4 .

docker build -f runtime/Dockerfile --target model \
  --build-arg NODE_IMAGE="$BAYORA_NODE_BASE" \
  --build-arg OLLAMA_IMAGE="$BAYORA_OLLAMA_BASE" \
  -t bayora-model:phase4 .

docker image inspect --format '{{.Id}}' bayora-worker:phase4
docker image inspect --format '{{.Id}}' bayora-model:phase4
```

The `.dockerignore` sends only the runtime files to the build context, excluding project data and credentials. Copy the resulting full local `sha256:...` IDs into `.env`; mutable image tags are rejected by runtime configuration. Approved images must not declare anonymous volumes.

Prepare model weights separately, before any evaluation. An administrator can import existing weights into a named local volume. Alternatively the following temporary loader downloads an approved model. Only this preparation container has network access; it receives no research data. Choose a model whose CPU memory needs fit your Docker VM.

```sh
export BAYORA_MODEL_NAME='REPLACE_WITH_APPROVED_LOCAL_MODEL_TAG'
docker volume create --label bayora.models.approved=true bayora-models

docker run -d --name bayora-model-loader \
  -p 127.0.0.1:11435:11434 \
  --mount type=volume,src=bayora-models,dst=/root/.ollama/models \
  --env OLLAMA_NO_CLOUD=1 "$BAYORA_OLLAMA_BASE" serve

docker exec bayora-model-loader ollama pull "$BAYORA_MODEL_NAME"
docker exec bayora-model-loader chmod -R a+rX /root/.ollama/models
curl --fail http://127.0.0.1:11435/api/tags

docker rm -f bayora-model-loader
```

Record the **full model name and full digest from `/api/tags`**, not a shortened CLI digest. The volume must use the `local` driver with no driver mount options. Runtime mounts its contents at `/models` and never writes or deletes the weights. Keep this approved volume private to trusted administrators; an outside writer could change it between checks.

Configure `.env`:

```dotenv
BAYORA_CONTAINER_RUNTIME=true
BAYORA_WORKER_IMAGE=sha256:REPLACE_WITH_FULL_LOCAL_WORKER_IMAGE_ID
BAYORA_MODEL_IMAGE=sha256:REPLACE_WITH_FULL_LOCAL_MODEL_IMAGE_ID
BAYORA_MODEL_VOLUME=bayora-models
BAYORA_CONTAINER_MODEL=REPLACE_WITH_EXACT_MODEL_NAME
BAYORA_CONTAINER_MODEL_DIGEST=REPLACE_WITH_FULL_MODEL_DIGEST
BAYORA_MODEL_MEMORY_MB=4096
BAYORA_MAX_ACTIVE_RUNS=1
```

Each run reserves up to two 4096 MiB model limits, two 256 MiB worker limits and CPU quotas. Configure sufficient Docker VM memory (including engine overhead), or choose a smaller approved model and deliberate limits. There is no GPU support in this profile. Restart Bayora after changing runtime configuration.

```sh
npm run runtime:check
npm run runtime:smoke
npm run dev
```

`runtime:check` inspects the endpoint, daemon, image IDs and approved volume. Exit 0 means infrastructure preflight passed; model presence is checked inside containers during a run. `runtime:smoke` performs two real model requests, records observations, and requires confirmed cleanup. It uses `.data/runtime-smoke.db` so test accounts/runs do not enter your main workspace. Smoke resources are tracked in that database and recovered on the next smoke invocation after an interrupted process.

In the UI, open **Administration → Runtime readiness**, then **New campaign → Container Ollama · isolated profile**. A missing/disabled runtime leaves launch disabled and reports the reason. The API also rejects direct isolated launch requests when prerequisites fail. Fixtures/shared Ollama remain independent of Docker availability.

## Lifecycle, cancellation and cleanup

Resource names are persisted before creation. Containers are named uniquely per run and carry instance/run/role labels. A label mismatch prevents deletion of another app's resources. Success is finalized after capability revocation, forced container removal and an explicit absence check. Failure/cancellation uses the same teardown. A failed cleanup remains visible, consumes a capacity slot, and can be retried through the run's **Retry container cleanup** action or `POST /api/runs/:id/cleanup` by Admin/Analyst in the authorized workspace. The model volume is retained.

On API startup, interrupted runs become failed records, and allocated resources with incomplete cleanup are reconciled before new launches. Readiness includes runtime-recovery state. Cleanup is local and bounded; a stopped Docker daemon can prevent deletion. Restart Docker and retry. Keep the database at its original path when recovering resources: instance ownership derives from that path. Multiple API processes sharing a database are unsupported.

## Evidence and compatibility

Container snapshots freeze image IDs, model revision, profile, memory limit and model-volume identity. New container exports use `bayora-evidence-v3`, binding the runtime report digest to the run's audit stream as well as the existing manifest/results/attempts bindings. Exports wait for initial teardown to finish; they can honestly contain a cleanup failure. Editing a runtime report, downgrading its evidence format, or removing its report binding fails verification. Historical v1/v2 exports remain supported.

Raw model responses retain Phase 3 role/ownership/grant restrictions. Audit records contain request/response digests and correlation IDs, without prompts, private rules, canaries or service tokens. Docker exec stderr is discarded rather than exposed as user-facing diagnostics. Cleanup/probe reports contain no model output.

## Source references

- [Docker runtime controls](https://docs.docker.com/engine/containers/run/)
- [Docker none network driver](https://docs.docker.com/engine/network/drivers/none/)
- [Docker engine trust boundary](https://docs.docker.com/engine/security/)
- [Ollama Docker usage](https://docs.ollama.com/docker)

## Development validation record

61 automated tests pass, including 14 tests dedicated to the runtime profile, gateway, cleanup/restart/shutdown failures, and runtime evidence. Container tests use a simulated engine. Build and formatting checks pass. Browser checks passed at 1440×1000 and 390×844 using isolated Playwright/Chrome because the in-app browser connection was unavailable. Readiness/retry and the disabled launch state work without Docker; fixture completion and exported evidence verification still work.

QA screenshots are available in this development session at `/tmp/bayora-phase4-runtime-desktop.png`, `/tmp/bayora-phase4-container-desktop.png`, and `/tmp/bayora-phase4-container-mobile.png`. They are not committed project assets. The real Docker smoke and live acceptance checks now pass; see ACCEPTANCE.md.

## Validated local CPU profile (21 October 2026)

The full official GPU image exceeded this machine's disk budget. `runtime/Dockerfile.cpu` instead verifies the official Ollama ARM64 archive checksum, excludes GPU libraries, and builds a small CPU image. Validation used Ollama v0.40.7, a pinned Node 24 ARM64 image, `smollm2:135m`, 768 MiB per model, 256 MiB per input worker, and one active run. The small model is a workflow test fixture, not a safety benchmark. Source digests and actual image IDs are recorded in `.data/runtime-validation.env` and the frozen manifests.

The Colima VM has 2 CPUs, 4 GiB RAM and bounded 8 GiB data/4 GiB root disks, with host mounts disabled. It was started with `--activate=false`; the default Docker context was preserved. The gitignored `.env` sets this app's `DOCKER_HOST` to `unix:///Users/kratik/.colima/bayora/docker.sock`. To resume the saved VM use `colima start bayora --activate=false`; to stop it use `colima stop bayora`. No login/startup service was installed.

`npm run runtime:acceptance` now tests actual egress denial in all four containers, absence of the Docker socket, separate role filesystems, a bounded worker OOM event without killing Blue, cancellation removal and persisted restart recovery. Temporary evaluation containers are removed. The approved model volume/images and stopped/started VM are retained for subsequent project runs.

To reproduce the validated CPU model image on an ARM64 host (after selecting the Docker daemon):

```sh
docker build -f runtime/Dockerfile.cpu -t bayora-model:validated-cpu \
  --build-arg NODE_IMAGE=node@sha256:156e9bc7a0a267cc6ca77b4283e32b123479342df684ce297455d7b95ff5a6b5 \
  --build-arg OLLAMA_ARCHIVE_URL=https://github.com/ollama/ollama/releases/download/v0.40.7/ollama-linux-arm64.tar.zst \
  --build-arg OLLAMA_ARCHIVE_SHA256=c74249e87795b1437ce0f484adfd05b4628d7497472c475b13ec6db69ecc69cf .
```

Use the resulting immutable image ID in configuration. This CPU image already includes `serve` in its entrypoint; when provisioning the model volume with the earlier loader recipe, override it with `--entrypoint /bin/ollama` before supplying `serve`. The archive download temporarily requires about 1.5 GB in addition to extraction space.
