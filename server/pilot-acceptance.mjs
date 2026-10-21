import { readFileSync, lstatSync } from "node:fs";
export const PILOT_GATES = [
  "identity",
  "signer",
  "secrets",
  "securityReview",
  "recovery",
  "load",
  "isolation",
  "retention",
  "incident",
];
export function inspectAcceptance(path, origin, now = Date.now()) {
  let value;
  try {
    if (!path) throw Error("missing");
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 32768)
      throw Error("invalid");
    value = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw Error(
      "A valid BAYORA_PILOT_ACCEPTANCE_FILE is required. Use the unapproved deployment template and record real operator review evidence.",
    );
  }
  const missing = [];
  if (value.origin !== origin) missing.push("origin");
  if (value.scope !== "prompt-only-synthetic")
    missing.push("supported prompt-only-synthetic scope");
  const expiry = Date.parse(value.validUntil);
  if (!Number.isFinite(expiry) || expiry <= now || expiry > now + 90 * 86400000)
    missing.push("review expiry (within 90 days)");
  for (const owner of ["operations", "security", "data"])
    if (
      typeof value.owners?.[owner] !== "string" ||
      !value.owners[owner].trim() ||
      value.owners[owner].includes("REQUIRED")
    )
      missing.push(owner + " owner");
  for (const gate of PILOT_GATES) {
    const g = value.gates?.[gate];
    if (
      g?.approved !== true ||
      typeof g.reviewer !== "string" ||
      !g.reviewer.trim() ||
      g.reviewer.includes("REQUIRED") ||
      !/^[a-f0-9]{64}$/.test(g.reportSha256 || "")
    )
      missing.push(gate);
  }
  return {
    ready: !missing.length,
    missing,
    validUntil: value.validUntil,
    scope: value.scope,
    qualification:
      "Operator-recorded approvals and report hashes; this software cannot independently establish the reviewer or report conclusions.",
  };
}
