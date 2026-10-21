import { useEffect, useState } from "react";
import { api } from "../../lib/api.js";
export function ExecutionHealth() {
  const [status, setStatus] = useState(null),
    [error, setError] = useState("");
  useEffect(() => {
    let stopped = false,
      timer;
    const controller = new AbortController();
    async function refresh() {
      try {
        const next = await api("/operations", undefined, {
          signal: controller.signal,
        });
        if (!stopped) {
          setStatus(next);
          setError("");
        }
      } catch (e) {
        if (!stopped) setError(e.message);
      } finally {
        if (!stopped) timer = setTimeout(refresh, 3000);
      }
    }
    refresh();
    return () => {
      stopped = true;
      controller.abort();
      clearTimeout(timer);
    };
  }, []);
  return (
    <section className="panel settings-panel">
      <h2>Execution & recovery</h2>
      <p>
        Evaluations run in separate worker processes. Queue reservations, leases
        and original deadlines survive API restarts.
      </p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {status ? (
        <>
          <dl>
            <div>
              <dt>Queue / audit storage</dt>
              <dd>{status.ready ? "Ready" : "Recovering"}</dd>
            </div>
            <div>
              <dt>Running workers</dt>
              <dd>
                {status.workers.length} / {status.workerConcurrency}
              </dd>
            </div>
            <div>
              <dt>Queued jobs</dt>
              <dd>{status.counts.READY || 0}</dd>
            </div>
            <div>
              <dt>Lease window</dt>
              <dd>{status.leaseMs / 1000} seconds</dd>
            </div>
            <div>
              <dt>Cleanup requiring attention</dt>
              <dd>{status.cleanupPending}</dd>
            </div>
          </dl>
          <p className="subtle">
            Worker failure preserves partial evidence. Retry with Clone campaign
            creates a linked execution. Provider and gateway checks run during
            live launch; use Runtime readiness to check Docker.
          </p>
        </>
      ) : (
        <p role="status">Checking execution queue…</p>
      )}
    </section>
  );
}
