import { readFile, writeFile } from "node:fs/promises";
import { networkInterfaces } from "node:os";
export async function inspectBoundary({ model = false } = {}) {
  const readonly = async (path) => {
    try {
      await writeFile(path, "x");
      return false;
    } catch (e) {
      return ["EROFS", "EACCES"].includes(e.code);
    }
  };
  const [memory, pids, cpu] = await Promise.all(
    ["memory.max", "pids.max", "cpu.max"].map((file) =>
      readFile("/sys/fs/cgroup/" + file, "utf8"),
    ),
  );
  const [quota, period] = cpu.trim().split(/\s+/).map(Number);
  return {
    uid: process.getuid(),
    rootReadonly: await readonly("/bayora-write-probe"),
    ...(model
      ? { modelsReadonly: await readonly("/models/bayora-write-probe") }
      : {}),
    loopbackOnly: Object.values(networkInterfaces())
      .flat()
      .every((i) => i.internal),
    memoryMax: Number(memory.trim()),
    pidsMax: Number(pids.trim()),
    cpuQuota: quota,
    cpuPeriod: period,
  };
}
