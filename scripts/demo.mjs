import { existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { spawn } from "node:child_process";
import { seedDemo } from "./demo-seed.mjs";
const directory = resolve(".data/hackathon");
if (!existsSync(join(directory, "bayora.db"))) await seedDemo(directory);
const child = spawn(process.execPath, ["scripts/dev.mjs"], {
  stdio: "inherit",
  env: {
    ...process.env,
    PORT: "3080",
    BAYORA_FRONTEND_PORT: "5180",
    NODE_ENV: "development",
    BAYORA_PILOT_MODE: "false",
    BAYORA_TRUST_PROXY: "false",
    BAYORA_OIDC_CLIENT_SECRET: "",
    BAYORA_OIDC_CLIENT_SECRET_FILE: "",
    BAYORA_DB: join(directory, "bayora.db"),
    BAYORA_DEMO_AUTH: "true",
    BAYORA_OIDC_ISSUER: "",
    BAYORA_PUBLIC_ORIGIN: "",
    BAYORA_SIGNER_SOCKET: ".data/hackathon/signing/signer.sock",
    BAYORA_SIGNER_PRIVATE_KEY: join(directory, "signing/private.pem"),
    BAYORA_SIGNER_DB: join(directory, "signing/ledger.db"),
    BAYORA_SIGNER_TOKEN: join(directory, "signing/client-token"),
    BAYORA_EVIDENCE_PUBLIC_KEY: join(directory, "signing/public.pem"),
    BAYORA_REQUIRE_SIGNED_EVIDENCE: "true",
  },
});
console.log(
  "Hackathon demo: http://127.0.0.1:5180 · private credentials: " +
    join(directory, "credentials.json"),
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => child.kill(signal));
child.on("exit", (code) => {
  process.exitCode = code || 0;
});
