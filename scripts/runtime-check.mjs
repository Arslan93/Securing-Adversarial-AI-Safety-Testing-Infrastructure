import { loadLocalEnv, readConfig } from "../server/config.mjs";
import { createContainerRuntime } from "../server/runtime/docker.mjs";
try {
  loadLocalEnv();
  const runtime = createContainerRuntime({ config: readConfig() }),
    status = await runtime.preflight();
  console.log(JSON.stringify(status, null, 2));
  process.exitCode = status.ready ? 0 : 1;
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
}
