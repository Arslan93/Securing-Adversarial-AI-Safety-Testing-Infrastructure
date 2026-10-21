import { createOrchestrator } from "../orchestrator.mjs";
import { createContainerRuntime } from "../runtime/docker.mjs";
let orchestrator,
  run,
  stopping = false,
  sequence = 0,
  pending = new Map();
function audit(type, data) {
  if (!process.connected)
    return Promise.reject(Error("Broker connection lost."));
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pending.delete(id);
      reject(Error("Persistence acknowledgement timed out."));
    }, 5000);
    pending.set(id, {
      resolve: () => {
        clearTimeout(timeout);
        resolve();
      },
      reject,
    });
    process.send({ type: "event", id, event: type, data, run });
  });
}
async function stop() {
  if (stopping) return;
  stopping = true;
  if (run && orchestrator) {
    run.status = "CANCELLED";
    orchestrator.controllers
      .get(run.id)
      ?.abort(Error("Execution stopped by broker."));
    await orchestrator.close();
  }
  process.exit(0);
}
process.on("disconnect", () => process.exit(1));
process.on("SIGTERM", stop);
process.on("message", async (message) => {
  if (message.type === "ack") {
    const p = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) p?.reject(Error(message.error));
    else p?.resolve();
    return;
  }
  if (message.type === "stop") {
    await stop();
    return;
  }
  if (message.type !== "start" || run) return;
  run = message.run;
  const state = { runs: [] },
    runtime = createContainerRuntime({ config: message.config, audit });
  orchestrator = createOrchestrator({
    state,
    config: {
      ...message.config,
      onWorkerDone: () => process.send({ type: "done" }),
    },
    audit,
    runtime,
  });
  state.runs.push(run);
  setInterval(() => {
    if (process.connected) process.send({ type: "heartbeat" });
  }, 500).unref();
  if (run.snapshot.mode === "ollama") {
    try {
      await orchestrator.liveProgress(run.id);
      process.send({ type: "done" });
    } catch {
      process.exit(1);
    }
  } else orchestrator.progress(run.id);
});
process.on("unhandledRejection", () => process.exit(1));
