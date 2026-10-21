import { generateKeyPairSync, randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
const dir = resolve(process.argv[2] || ".data/signing");
mkdirSync(dir, { recursive: true, mode: 0o700 });
if (
  ["private.pem", "public.pem", "client-token"].some((file) =>
    existsSync(dir + "/" + file),
  )
)
  throw Error(
    "Signing files already exist. Refusing to overwrite trusted keys.",
  );
const pair = generateKeyPairSync("ed25519");
writeFileSync(
  dir + "/private.pem",
  pair.privateKey.export({ type: "pkcs8", format: "pem" }),
  { flag: "wx", mode: 0o600 },
);
writeFileSync(
  dir + "/public.pem",
  pair.publicKey.export({ type: "spki", format: "pem" }),
  { flag: "wx", mode: 0o644 },
);
writeFileSync(dir + "/client-token", randomBytes(32).toString("hex"), {
  flag: "wx",
  mode: 0o600,
});
console.log(
  "Signing keys created in " +
    dir +
    ". Keep private.pem with the signer; distribute public.pem through a trusted channel.",
);
