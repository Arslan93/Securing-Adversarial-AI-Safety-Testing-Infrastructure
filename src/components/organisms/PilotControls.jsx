import { useEffect, useState } from "react";
import { api } from "../../lib/api.js";
import { Input } from "../atoms/Input.jsx";
import { Button } from "../atoms/Button.jsx";
import { ModelApprovals } from "./ModelApprovals.jsx";
import { RetentionControls } from "./RetentionControls.jsx";
export function PilotControls({ refresh }) {
  const [status, setStatus] = useState(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    api("/pilot/status", undefined, { signal: controller.signal })
      .then(setStatus)
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, []);
  async function mutate(path, body, done) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await api(path, body);
      done?.(result);
      if (path === "/pilot/retention/apply") await refresh?.();
      setStatus(await api("/pilot/status"));
      setNotice("Operator action recorded.");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="pilot-controls">
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {status && (
        <>
          <section className="panel settings-panel">
            <h2>Pilot & incident controls</h2>
            <p>
              {status.enabled
                ? "Restricted pilot enforcement is enabled."
                : "Development mode. Operator controls are available; production pilot enforcement is not enabled."}
            </p>
            <p role="status">
              <strong>
                {status.control.paused
                  ? "Organization evaluations paused"
                  : "Organization evaluations enabled"}
              </strong>
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const form = e.currentTarget,
                  reason = new FormData(form).get("reason");
                mutate(
                  "/pilot/containment",
                  { paused: !status.control.paused, reason },
                  () => form.reset(),
                );
              }}
            >
              <label htmlFor="containment-reason">
                Incident or resume reason
              </label>
              <Input
                id="containment-reason"
                name="reason"
                required
                minLength={10}
                maxLength={1000}
              />
              <Button disabled={busy}>
                {status.control.paused
                  ? "Resume organization evaluations"
                  : "Pause organization evaluations"}
              </Button>
            </form>
            <p className="subtle">
              Pause blocks new launches and stops active workers at their next
              broker check. Review failed/unknown attempts and cleanup before
              resuming.
            </p>
          </section>
          <ModelApprovals status={status} mutate={mutate} busy={busy} />
          <RetentionControls status={status} mutate={mutate} busy={busy} />
        </>
      )}
    </div>
  );
}
