import { readFileSync } from "node:fs";
import { verifyPackage } from "../server/evidence/signatures.mjs";
try {
  if (!process.argv[2])
    throw Error("Usage: node scripts/verify-evidence.mjs <evidence.json>");
  console.log(
    JSON.stringify(
      verifyPackage(JSON.parse(readFileSync(process.argv[2], "utf8")), {
        trustedKeys: process.argv.includes("--trusted-key")
          ? [
              readFileSync(
                process.argv[process.argv.indexOf("--trusted-key") + 1],
                "utf8",
              ),
            ]
          : [],
        requireSignature: process.argv.includes("--require-signature"),
      }),
      null,
      2,
    ),
  );
} catch (e) {
  console.error("VERIFICATION FAILED:", e.message);
  process.exitCode = 1;
}
