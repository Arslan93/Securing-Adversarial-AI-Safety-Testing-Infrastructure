import { spawn } from "node:child_process";
const processes = [
  spawn(process.execPath, ["--watch", "server/index.mjs"], {
    stdio: "inherit",
  }),
  spawn(process.execPath, ["node_modules/vite/bin/vite.js"], {
    stdio: "inherit",
  }),
];
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    processes.forEach((p) => p.kill());
    process.exit();
  });
