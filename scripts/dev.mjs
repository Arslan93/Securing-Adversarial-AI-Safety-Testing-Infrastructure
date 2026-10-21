import { spawn } from "node:child_process";
import { loadLocalEnv, readConfig } from "../server/config.mjs";
try {
  loadLocalEnv();
  const config = readConfig();
  const children = [
    ...(config.signerSocket
      ? [
          spawn(process.execPath, ["scripts/evidence-signer.mjs"], {
            stdio: "inherit",
          }),
        ]
      : []),
    spawn(process.execPath, ["--watch", "server/index.mjs"], {
      stdio: "inherit",
    }),
    spawn(process.execPath, ["node_modules/vite/bin/vite.js"], {
      stdio: "inherit",
    }),
  ];
  let stopping = false;
  function stop(code = 0) {
    if (stopping) return;
    stopping = true;
    process.exitCode = code;
    for (const child of children) child.kill("SIGTERM");
    const timeout = setTimeout(() => {
      for (const child of children)
        if (child.exitCode === null) child.kill("SIGKILL");
    }, 3000);
    timeout.unref();
  }
  for (const child of children) {
    child.on("error", (e) => {
      console.error("Bayora development process failed:", e.message);
      stop(1);
    });
    child.on("exit", (code, signal) => {
      if (!stopping) {
        console.error(
          `A Bayora development process stopped (${signal || code}). Stopping the other process.`,
        );
        stop(code || 1);
      }
    });
  }
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => stop(0));
} catch (error) {
  console.error(`Bayora could not start: ${error.message}`);
  process.exitCode = 1;
}
