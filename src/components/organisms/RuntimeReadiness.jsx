import { useState, useEffect } from "react";
import { api } from "../../lib/api.js";
import { Button } from "../atoms/Button.jsx";
export function RuntimeReadiness() {
  const [status, setStatus] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function refresh(signal) {
    setBusy(true);
    setError("");
    try {
      const next = await api("/runtime", undefined, { signal });
      if (!signal?.aborted) setStatus(next);
    } catch (e) {
      if (!signal?.aborted) setError(e.message);
    } finally {
      if (!signal?.aborted) setBusy(false);
    }
  }
  useEffect(() => {
    const controller = new AbortController();
    refresh(controller.signal);
    return () => controller.abort();
  }, []);
  return (
    <section className="panel settings-panel runtime-readiness">
      <h2>Runtime readiness</h2>
      <p>
        Container isolation is an explicit campaign option. Shared Ollama and
        fixtures retain their existing execution modes.
      </p>
      <p role="status">
        <strong>
          {busy
            ? "Checking runtime…"
            : status?.ready
              ? "Preflight passed"
              : "Container runtime unavailable"}
        </strong>
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {status && (
        <>
          <p>{status.message}</p>
          <dl>
            {Object.entries(status.checks || {}).map(([name, passed]) => (
              <div key={name}>
                <dt>{name.replace(/([A-Z])/g, " $1")}</dt>
                <dd>{passed ? "Passed" : "Required"}</dd>
              </div>
            ))}
          </dl>
        </>
      )}
      <p className="subtle">
        Each isolated run checks its actual container profile and records
        cleanup. These observations do not provide independent attestation or a
        side-channel guarantee.
      </p>
      <Button variant="secondary" onClick={() => refresh()} disabled={busy}>
        Check runtime again
      </Button>
    </section>
  );
}
