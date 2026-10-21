import { useState, useEffect } from "react";
import { api } from "../../lib/api.js";
import { Button } from "../atoms/Button.jsx";
export function EvidenceStatus() {
  const [status, setStatus] = useState(null);
  async function load() {
    try {
      setStatus(await api("/evidence/status"));
    } catch {
      setStatus({ ready: false });
    }
  }
  useEffect(() => {
    const abort = new AbortController();
    api("/evidence/status", undefined, { signal: abort.signal })
      .then(setStatus)
      .catch(() => {});
    return () => abort.abort();
  }, []);
  return (
    <div>
      <p>
        <strong>
          {status?.ready
            ? "Evidence signer connected"
            : status?.enabled
              ? "Evidence signer unavailable"
              : "Exports are unsigned"}
        </strong>
      </p>
      {status?.keyId && (
        <p className="subtle mono">Pinned signer: {status.keyId}</p>
      )}
      <p>
        Trusted verification requires a public key supplied independently of the
        evidence file. A signature authenticates a checkpoint; it does not
        certify model safety or runtime isolation.
      </p>
      <Button variant="secondary" onClick={load}>
        Check evidence signer
      </Button>
    </div>
  );
}
