import http from "node:http";
import { readFileSync } from "node:fs";
import { verifyPackage, keyId } from "./signatures.mjs";
export function createEvidenceClient(config) {
  const trustedKeys = config.evidencePublicKey
    ? [readFileSync(config.evidencePublicKey, "utf8")]
    : [];
  const enabled = !!config.signerSocket;
  function call(path, body) {
    return new Promise((resolve, reject) => {
      let token;
      try {
        token = readFileSync(config.signerTokenPath, "utf8").trim();
        if (!/^[a-f0-9]{64}$/.test(token)) throw Error("Invalid signer token");
      } catch {
        return reject(Error("Signer client token is unavailable."));
      }
      const req = http.request(
        {
          socketPath: config.signerSocket,
          path,
          method: body === undefined ? "GET" : "POST",
          headers: {
            Authorization: "Bearer " + token,
            "Content-Type": "application/json",
          },
          timeout: 5000,
        },
        (res) => {
          let raw = "",
            size = 0;
          res.setEncoding("utf8");
          res.on("data", (chunk) => {
            size += Buffer.byteLength(chunk);
            if (size > 100000) {
              req.destroy();
              reject(Error("Signer response exceeded its limit."));
            } else raw += chunk;
          });
          res.on("end", () => {
            try {
              const data = JSON.parse(raw);
              if (res.statusCode !== 200)
                throw Error(data.error || "Signer operation failed.");
              resolve(data);
            } catch (e) {
              reject(
                Error(
                  e.message === "Unexpected end of JSON input"
                    ? "Invalid signer response."
                    : e.message,
                ),
              );
            }
          });
        },
      );
      req.on("error", () =>
        reject(
          Error(
            "Evidence signer is unavailable. Start the signer service and retry.",
          ),
        ),
      );
      req.on("timeout", () => req.destroy());
      req.end(body === undefined ? undefined : JSON.stringify(body));
    });
  }
  async function status() {
    if (!enabled) return { enabled: false, ready: false };
    const result = await call("/status");
    return {
      ...result,
      enabled: true,
      ready:
        result.ready && trustedKeys.some((key) => keyId(key) === result.keyId),
    };
  }
  return {
    enabled,
    requireSignature: !!config.requireSignedEvidence,
    trustedKeys,
    status,
    register: async (input) => {
      if (enabled) {
        if (!(await status()).ready)
          throw Error("Signer does not match the trusted key.");
        return call("/register", input);
      }
      if (config.requireSignedEvidence)
        throw Error("A signing service is required.");
    },
    seal: async (pack) => {
      if (!enabled) {
        if (config.requireSignedEvidence)
          throw Error("A signing service is required.");
        return pack;
      }
      const { attestation } = await call("/sign", pack),
        signed = { ...pack, attestation };
      verifyPackage(signed, { trustedKeys, requireSignature: true });
      return signed;
    },
    verify: (pack) =>
      verifyPackage(pack, {
        trustedKeys,
        requireSignature: !!config.requireSignedEvidence,
      }),
  };
}
