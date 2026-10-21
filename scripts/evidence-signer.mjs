import { createSigner } from "../server/evidence/signer.mjs";
import { loadLocalEnv } from "../server/config.mjs";
loadLocalEnv();
const signer = createSigner({
  dbPath: process.env.BAYORA_SIGNER_DB || ".data/signing/ledger.db",
  keyPath: process.env.BAYORA_SIGNER_PRIVATE_KEY || ".data/signing/private.pem",
  tokenPath: process.env.BAYORA_SIGNER_TOKEN || ".data/signing/client-token",
});
await signer.listen(
  process.env.BAYORA_SIGNER_SOCKET || ".data/signing/signer.sock",
  process.env.BAYORA_SIGNER_SOCKET_MODE === "0660" ? 0o660 : 0o600,
);
console.log("Evidence signer ready. Public key ID: " + signer.keyId);
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, async () => {
    await signer.close();
  });
