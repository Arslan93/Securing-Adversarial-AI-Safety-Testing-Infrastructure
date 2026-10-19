import { readFileSync } from "node:fs";
import { verifyEvidence } from "../server/core.mjs";
try {
  if (!process.argv[2])
    throw Error("Usage: node scripts/verify-evidence.mjs <evidence.json>");
  console.log(
    JSON.stringify(
      verifyEvidence(JSON.parse(readFileSync(process.argv[2], "utf8"))),
      null,
      2,
    ),
  );
} catch (e) {
  console.error("VERIFICATION FAILED:", e.message);
  process.exitCode = 1;
}
