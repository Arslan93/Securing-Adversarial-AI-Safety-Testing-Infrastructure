import { randomUUID, createHash } from "node:crypto";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { dockerCommand } from "./command.mjs";
import {
  containerSpec,
  verifyContainer,
  PROFILE,
  ROLES,
  limits,
} from "./profile.mjs";
import { createGateway } from "./gateway.mjs";
const parse = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    throw Error("Runtime returned malformed JSON.");
  }
};
export function createContainerRuntime({
  config,
  audit = () => {},
  command = dockerCommand,
}) {
  const instanceId = createHash("sha256")
    .update(resolve(config.dbPath || ".data/bayora.db"))
    .digest("hex")
    .slice(0, 24);
  const execute = (args, options) => command(args, options);
  async function preflight({ signal = AbortSignal.timeout(8000) } = {}) {
    const checks = {
      enabled: !!config.runtimeEnabled,
      configuration: !!(
        config.runtimeWorkerImage &&
        config.runtimeModelImage &&
        config.runtimeModelVolume &&
        config.runtimeModel &&
        config.runtimeModelDigest
      ),
    };
    if (!checks.enabled || !checks.configuration)
      return {
        ready: false,
        profile: PROFILE,
        checks,
        message: !checks.enabled
          ? "Container runtime is disabled. Configure it using docs/PHASE4.md."
          : "Configure approved image IDs, model volume, model name and model digest.",
      };
    try {
      const endpoint = parse(
        await execute(
          ["context", "inspect", "--format", "{{json .Endpoints.docker.Host}}"],
          { signal },
        ),
      );
      if (
        !endpoint.startsWith("unix://") ||
        (process.env.DOCKER_HOST &&
          !process.env.DOCKER_HOST.startsWith("unix://"))
      )
        throw Error("Only a local Unix Docker endpoint is permitted.");
      checks.localDaemon = true;
      const info = parse(
        await execute(["info", "--format", "{{json .}}"], { signal }),
      );
      if (
        info.OSType !== "linux" ||
        !info.SecurityOptions?.some((v) => v.includes("seccomp"))
      )
        throw Error(
          "A Linux Docker engine with its default seccomp profile is required.",
        );
      checks.daemon = true;
      if (
        info.CgroupVersion !== "2" ||
        !info.MemoryLimit ||
        !info.SwapLimit ||
        !info.CpuCfsQuota ||
        !info.PidsLimit
      )
        throw Error(
          "Cgroup v2 with memory, swap, CPU and PID limit support is required.",
        );
      checks.resourceLimits = true;
      for (const image of [
        config.runtimeWorkerImage,
        config.runtimeModelImage,
      ]) {
        const [i] = parse(
          await execute(["image", "inspect", image], { signal }),
        );
        if (
          i.Id !== image ||
          i.Os !== "linux" ||
          Object.keys(i.Config?.Volumes || {}).length
        )
          throw Error(
            "Approved Linux images must not declare anonymous volumes.",
          );
      }
      checks.images = true;
      const [volume] = parse(
        await execute(["volume", "inspect", config.runtimeModelVolume], {
          signal,
        }),
      );
      if (
        volume.Driver !== "local" ||
        Object.keys(volume.Options || {}).length ||
        volume.Labels?.["bayora.models.approved"] !== "true"
      )
        throw Error(
          "Use an approved local model volume without driver mount options.",
        );
      checks.modelVolume = true;
      return {
        ready: true,
        profile: PROFILE,
        checks,
        message:
          "Infrastructure preflight passed. Per-run profile and model revision are checked during provisioning; independent attestation is unavailable.",
      };
    } catch (e) {
      return { ready: false, profile: PROFILE, checks, message: e.message };
    }
  }
  async function models() {
    const status = await preflight();
    return {
      ...status,
      available: status.ready,
      models: status.ready
        ? [
            {
              id: config.runtimeModel,
              digest: config.runtimeModelDigest,
              source: "approved-container-volume",
            },
          ]
        : [],
    };
  }
  async function inspect(name, signal) {
    return parse(await execute(["inspect", name], { signal }))[0];
  }
  const cleanupJobs = new Map();
  function cleanup(runId, resources = []) {
    if (cleanupJobs.has(runId)) return cleanupJobs.get(runId);
    const job = performCleanup(runId, resources).finally(() =>
      cleanupJobs.delete(runId),
    );
    cleanupJobs.set(runId, job);
    return job;
  }
  async function performCleanup(runId, resources = []) {
    const receipt = {
      status: "REMOVED",
      checkedAt: new Date().toISOString(),
      resources: [],
    };
    for (const item of resources) {
      try {
        if (!/^bayora-[a-f0-9-]{16,100}$/.test(item.name))
          throw Error("Invalid cleanup resource.");
        const present = (
          await execute([
            "container",
            "ls",
            "-aq",
            "--filter",
            `name=^/${item.name}$`,
          ])
        ).trim();
        if (present) {
          const info = await inspect(item.name);
          if (
            info.Config?.Labels?.["bayora.instance"] !== instanceId ||
            info.Config?.Labels?.["bayora.run"] !== runId ||
            info.Config?.Labels?.["bayora.managed"] !== "true"
          )
            throw Error("Cleanup ownership mismatch.");
          await execute(["rm", "--force", item.name]);
        }
        const remaining = (
          await execute([
            "container",
            "ls",
            "-aq",
            "--filter",
            `name=^/${item.name}$`,
          ])
        ).trim();
        if (remaining) throw Error("Container still exists after removal.");
        receipt.resources.push({ role: item.role, removed: true });
      } catch (e) {
        receipt.status = "FAILED";
        receipt.resources.push({
          role: item.role,
          removed: false,
          error: e.message,
        });
      }
    }
    return receipt;
  }
  async function provision(
    run,
    { signal, onResources = () => {}, onReport = () => {} },
  ) {
    const resources = [],
      report = {
        profile: PROFILE,
        status: "PROVISIONING",
        checks: [],
        probes: [],
        qualification:
          "Local Docker observations; no independent attestation or side-channel guarantee.",
      };
    // Refuse a changed administrator profile after the run manifest was frozen.
    const frozen = run.snapshot.runtime;
    if (
      !frozen ||
      frozen.profile !== PROFILE ||
      frozen.workerImage !== config.runtimeWorkerImage ||
      frozen.modelImage !== config.runtimeModelImage ||
      frozen.modelVolume !== config.runtimeModelVolume ||
      frozen.memoryMb !== config.runtimeMemoryMb
    )
      throw Error(
        "Container configuration changed after the run snapshot was frozen.",
      );
    const readiness = await preflight({ signal });
    if (!readiness.ready) throw Error(readiness.message);
    let gateway;
    try {
      for (const role of ROLES) {
        signal.throwIfAborted();
        const item = { role, name: "bayora-" + randomUUID() };
        resources.push(item);
        await onResources([...resources]);
        await execute(
          containerSpec({ ...item, runId: run.id, instanceId, config }),
          { signal },
        );
        await execute(["start", item.name], { signal });
        report.checks.push(
          verifyContainer(await inspect(item.name, signal), {
            role,
            runId: run.id,
            instanceId,
            config,
          }),
        );
      }
      const container = (role) => resources.find((r) => r.role === role).name;
      const bridge = async (
        role,
        input,
        { signal: requestSignal = signal } = {},
      ) =>
        parse(
          await execute(
            ["exec", "-i", container(role), "node", "/app/bridge.mjs"],
            {
              input,
              signal: requestSignal,
              timeoutMs: 65000,
              maxBytes: 131072,
            },
          ),
        );
      for (const role of ["baseline", "defended"]) {
        let available;
        for (let attempt = 0; attempt < 15; attempt++) {
          signal.throwIfAborted();
          try {
            available = await bridge(role, { operation: "models" });
            break;
          } catch (e) {
            if (attempt === 14) throw e;
            await delay(300, undefined, { signal });
          }
        }
        if (
          !available.models?.some(
            (m) =>
              m.name === run.snapshot.model &&
              m.digest === run.snapshot.modelDigest,
          )
        )
          throw Error(
            "Approved model revision is absent or changed in the isolated volume.",
          );
      }
      for (const role of ROLES) {
        const model = ["baseline", "defended"].includes(role);
        const probe = model
          ? await bridge(role, { operation: "probe" })
          : parse(
              await execute(
                [
                  "exec",
                  "-i",
                  container(role),
                  "node",
                  "/app/worker.mjs",
                  "probe",
                ],
                { signal },
              ),
            );
        const expected = limits(role, config);
        if (
          probe.uid !== 65532 ||
          !probe.rootReadonly ||
          !probe.loopbackOnly ||
          (model && !probe.modelsReadonly) ||
          probe.memoryMax !== expected.memory ||
          probe.pidsMax !== expected.pids ||
          !(probe.cpuPeriod > 0) ||
          probe.cpuQuota / probe.cpuPeriod !== expected.cpus
        )
          throw Error("Runtime boundary or cgroup probe failed.");
        report.probes.push({ role, ...probe });
      }
      async function prepare(role, input) {
        return parse(
          await execute(
            ["exec", "-i", container(role), "node", "/app/worker.mjs", role],
            { input, signal, maxBytes: 40000 },
          ),
        );
      }
      const policy = await prepare("blue", {
        rules: run.snapshot.policy.rules,
      });
      if (
        JSON.stringify(policy.rules) !==
        JSON.stringify(run.snapshot.policy.rules)
      )
        throw Error("Blue worker changed its frozen rule bundle.");
      const corpus = [];
      for (const c of run.snapshot.dataset.cases) {
        const p = await prepare("red", { id: c.id, prompt: c.prompt });
        if (p.id !== c.id || p.prompt !== c.prompt)
          throw Error("Red worker changed its frozen case.");
        corpus.push({ ...c, prompt: p.prompt });
      }
      report.status = "PROFILE_CHECKED";
      await onReport({ ...report });
      gateway = createGateway({
        runId: run.id,
        orgId: run.orgId,
        workspaceId: run.workspaceId,
        model: run.snapshot.model,
        cases: corpus,
        rules: policy.rules,
        expires:
          run.execution?.deadline ||
          Date.now() + run.snapshot.workspace.ttl * 60000,
        audit,
        transport: (arm, body, options) =>
          bridge(arm, { operation: "chat", body }, options),
      });
      const tokens = {
        baseline: gateway.issue("baseline"),
        defended: gateway.issue("defended"),
      };
      let sequence = 0;
      return {
        report,
        resources,
        snapshot: {
          ...run.snapshot,
          policy: { ...run.snapshot.policy, rules: policy.rules },
        },
        corpus,
        fetcher: async (url, options) => {
          if (
            url !== "http://127.0.0.1:11434/api/chat" ||
            options.method !== "POST"
          )
            throw Error("Only the controlled chat gateway is available.");
          const arm = sequence % 2 === 0 ? "baseline" : "defended",
            c = corpus[Math.floor(sequence / 2)];
          sequence++;
          const body = JSON.parse(options.body);
          body.keep_alive = 0;
          const response = await gateway.request(
            {
              token: tokens[arm],
              runId: run.id,
              orgId: run.orgId,
              workspaceId: run.workspaceId,
              caseId: c?.id,
              arm,
              body,
            },
            { signal: options.signal },
          );
          return { ok: true, json: async () => response };
        },
        async dispose() {
          gateway.revoke();
          report.cleanup = await cleanup(run.id, resources);
          report.status =
            report.cleanup.status === "REMOVED" ? "CLEANED" : "CLEANUP_FAILED";
          await onReport({ ...report });
          return report;
        },
      };
    } catch (e) {
      gateway?.revoke();
      report.error = e.message;
      report.cleanup = await cleanup(run.id, resources);
      report.status =
        report.cleanup.status === "REMOVED"
          ? "PROVISIONING_FAILED"
          : "CLEANUP_FAILED";
      await onReport(report);
      throw e;
    }
  }
  return { preflight, models, provision, cleanup, instanceId };
}
