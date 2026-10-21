export const PROFILE = "bayora-container-v1";
export const ROLES = ["red", "blue", "baseline", "defended"];
export function limits(role, config) {
  return ["red", "blue"].includes(role)
    ? { memory: 256 * 1024 * 1024, pids: 64, cpus: 1 }
    : {
        memory: (config.runtimeMemoryMb || 4096) * 1024 * 1024,
        pids: 256,
        cpus: 2,
      };
}
export function containerSpec({ name, role, runId, instanceId, config }) {
  if (!ROLES.includes(role) || !/^bayora-[a-f0-9-]{16,100}$/.test(name))
    throw Error("Invalid runtime identity.");
  const model = ["baseline", "defended"].includes(role),
    l = limits(role, config);
  return [
    "create",
    "--pull=never",
    "--name",
    name,
    "--label",
    "bayora.managed=true",
    "--label",
    `bayora.instance=${instanceId}`,
    "--label",
    `bayora.run=${runId}`,
    "--label",
    `bayora.role=${role}`,
    "--network=none",
    "--read-only",
    "--user=65532:65532",
    "--cap-drop=ALL",
    "--security-opt=no-new-privileges=true",
    "--pids-limit",
    String(l.pids),
    "--memory",
    String(l.memory),
    "--memory-swap",
    String(l.memory),
    "--cpus",
    String(l.cpus),
    "--ipc=private",
    "--cgroupns=private",
    "--init",
    "--restart=no",
    "--log-driver=none",
    "--no-healthcheck",
    "--tmpfs",
    "/tmp:rw,noexec,nosuid,nodev,size=134217728,mode=1777",
    "--env",
    "HOME=/tmp",
    ...(model
      ? [
          "--mount",
          `type=volume,src=${config.runtimeModelVolume},dst=/models,readonly`,
          "--env",
          "OLLAMA_HOST=127.0.0.1:11434",
          "--env",
          "OLLAMA_MODELS=/models",
          "--env",
          "OLLAMA_NO_CLOUD=1",
          "--env",
          "OLLAMA_NUM_PARALLEL=1",
          "--env",
          "OLLAMA_MAX_LOADED_MODELS=1",
          "--entrypoint",
          "/bin/ollama",
          config.runtimeModelImage,
          "serve",
        ]
      : [
          "--entrypoint",
          "node",
          config.runtimeWorkerImage,
          "/app/worker.mjs",
          "idle",
        ]),
  ];
}
export function verifyContainer(info, { role, runId, instanceId, config }) {
  const h = info.HostConfig || {},
    c = info.Config || {},
    l = limits(role, config),
    model = ["baseline", "defended"].includes(role);
  const checks = {
    identity:
      c.Labels?.["bayora.run"] === runId &&
      c.Labels?.["bayora.instance"] === instanceId &&
      c.Labels?.["bayora.role"] === role &&
      c.Labels?.["bayora.managed"] === "true",
    image:
      info.Image ===
      (model ? config.runtimeModelImage : config.runtimeWorkerImage),
    running: info.State?.Running === true,
    network:
      h.NetworkMode === "none" &&
      !Object.keys(h.PortBindings || {}).length &&
      Object.keys(info.NetworkSettings?.Networks || {}).every(
        (n) => n === "none",
      ),
    filesystem:
      h.ReadonlyRootfs === true &&
      !h.Privileged &&
      !(h.Devices || []).length &&
      !(h.DeviceRequests || []).length,
    user: c.User === "65532:65532",
    capabilities:
      h.CapDrop?.includes("ALL") &&
      !(h.CapAdd || []).length &&
      !h.SecurityOpt?.some((v) => v.includes("unconfined")) &&
      h.SecurityOpt?.some((v) => /^no-new-privileges(?::|=true|$)/.test(v)),
    resources:
      h.Memory === l.memory &&
      h.MemorySwap === l.memory &&
      h.PidsLimit === l.pids &&
      h.NanoCpus === l.cpus * 1e9,
    namespaces:
      h.IpcMode === "private" &&
      ["", undefined].includes(h.PidMode) &&
      ["", undefined].includes(h.UTSMode) &&
      h.CgroupnsMode === "private",
    mounts:
      (info.Mounts || []).filter((m) => m.Type !== "tmpfs").length ===
        (model ? 1 : 0) &&
      (info.Mounts || []).every((m) =>
        m.Type === "tmpfs"
          ? m.Destination === "/tmp"
          : model &&
            m.Type === "volume" &&
            m.Name === config.runtimeModelVolume &&
            m.Destination === "/models" &&
            m.RW === false,
      ),
    temporary:
      Object.keys(h.Tmpfs || {}).length === 1 &&
      h.Tmpfs?.["/tmp"]?.includes("noexec") &&
      h.Tmpfs["/tmp"].includes("nosuid") &&
      h.Tmpfs["/tmp"].includes("nodev"),
    logging: h.LogConfig?.Type === "none",
  };
  if (Object.values(checks).some((v) => !v))
    throw Error(
      "Container profile verification failed: " +
        Object.entries(checks)
          .filter(([, v]) => !v)
          .map(([k]) => k)
          .join(", "),
    );
  return { role, checks, checkedAt: new Date().toISOString() };
}
