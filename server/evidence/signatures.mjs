import { createHash, createPublicKey, sign, verify } from "node:crypto";
import { verifyEvidence } from "../core.mjs";
export function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  return (
    "{" +
    Object.keys(value)
      .sort()
      .filter((k) => value[k] !== undefined)
      .map((k) => JSON.stringify(k) + ":" + canonical(value[k]))
      .join(",") +
    "}"
  );
}
export const sha = (value) =>
  createHash("sha256")
    .update(
      typeof value === "string" || Buffer.isBuffer(value)
        ? value
        : canonical(value),
    )
    .digest("hex");
export function keyId(key) {
  return sha(
    (key?.type === "public" ? key : createPublicKey(key)).export({
      type: "spki",
      format: "der",
    }),
  );
}
export function evidenceDigest(pack) {
  const { attestation, ...payload } = pack;
  return sha(payload);
}
export function attest(
  pack,
  key,
  { orgId, workspaceId, previousCheckpoint = null } = {},
) {
  const payload = {
    version: "bayora-attestation-v1",
    algorithm: "Ed25519",
    keyId: keyId(key),
    runId: pack.runId,
    orgId,
    workspaceId,
    sequence: pack.events.length,
    anchor: pack.anchor,
    manifestHash: pack.manifestHash,
    evidenceHash: evidenceDigest(pack),
    signedAt: new Date().toISOString(),
    previousCheckpoint,
  };
  return {
    payload,
    signature: sign(null, Buffer.from(canonical(payload)), key).toString(
      "base64url",
    ),
  };
}
export function verifyPackage(
  pack,
  { trustedKeys = [], requireSignature = false } = {},
) {
  const result = verifyEvidence(pack);
  if (!pack.attestation) {
    if (requireSignature)
      throw Error("A trusted evidence signature is required.");
    return { ...result, signature: "unsigned", trusted: false };
  }
  const { payload, signature } = pack.attestation;
  if (
    !payload ||
    payload.version !== "bayora-attestation-v1" ||
    payload.algorithm !== "Ed25519" ||
    typeof signature !== "string" ||
    signature.length > 128 ||
    payload.runId !== pack.runId ||
    payload.sequence !== pack.events.length ||
    payload.anchor !== pack.anchor ||
    payload.manifestHash !== pack.manifestHash ||
    payload.evidenceHash !== evidenceDigest(pack)
  )
    throw Error("Evidence signature payload does not match this package.");
  const trusted = trustedKeys.find((key) => keyId(key) === payload.keyId);
  if (!trusted) {
    if (requireSignature)
      throw Error("Signer key is not in the trusted key set.");
    return {
      ...result,
      signature: "untrusted-key",
      trusted: false,
      qualification:
        "Hash consistency only. The signature cannot be trusted without an independently supplied public key.",
    };
  }
  try {
    if (
      !verify(
        null,
        Buffer.from(canonical(payload)),
        trusted,
        Buffer.from(signature, "base64url"),
      )
    )
      throw Error("invalid");
  } catch {
    throw Error("Evidence signature verification failed.");
  }
  return {
    ...result,
    signature: "trusted",
    trusted: true,
    keyId: payload.keyId,
    signedAt: payload.signedAt,
    qualification:
      "Package matches a pinned signer key and its checkpoint. Runtime safety and signer independence depend on the deployment trust boundary.",
  };
}
