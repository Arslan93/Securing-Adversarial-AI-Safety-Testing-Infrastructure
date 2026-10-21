import { useState, useEffect } from "react";
import { api } from "../../lib/api.js";
import { Button } from "../atoms/Button.jsx";
import { FormField } from "../molecules/FormField.jsx";
import { Select } from "../atoms/Select.jsx";
export function AccessRequests({ data }) {
  const [requests, setRequests] = useState([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const artifacts = [
    ...(["Admin", "Red", "Analyst"].includes(data.role) ? data.datasets : []),
    ...(["Admin", "Blue", "Analyst"].includes(data.role) ? data.policies : []),
  ];
  const load = async () =>
    setRequests((await api("/access-requests")).requests);
  useEffect(() => {
    const abort = new AbortController();
    api("/access-requests", undefined, { signal: abort.signal })
      .then((d) => setRequests(d.requests))
      .catch((e) => {
        if (!abort.signal.aborted) setError(e.message);
      });
    return () => abort.abort();
  }, [data.organization.id]);
  async function perform(fn) {
    setBusy(true);
    setError("");
    try {
      await fn();
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="account-security">
      <h3>Artifact access requests</h3>
      <Button
        variant="secondary"
        disabled={busy}
        onClick={() => perform(async () => {})}
      >
        Refresh access requests
      </Button>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {artifacts.length > 0 && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            perform(() =>
              api("/access-requests", {
                resourceId: f.get("resource"),
                reason: f.get("reason"),
              }),
            );
          }}
        >
          <label htmlFor="request-resource">Private artifact</label>
          <Select id="request-resource" name="resource">
            {artifacts.map((a) => (
              <option value={a.id} key={a.id}>
                {a.name} · v{a.version}
              </option>
            ))}
          </Select>
          <FormField
            id="request-reason"
            label="Reason for access"
            name="reason"
            minLength={5}
            maxLength={1000}
            required
          />
          <Button disabled={busy}>Request access</Button>
        </form>
      )}
      {requests.map((r) => (
        <article className="access-request" key={r.id}>
          <strong>
            {[...data.datasets, ...data.policies].find(
              (a) => a.id === r.resourceId,
            )?.name || "Artifact"}{" "}
            · {r.status}
          </strong>
          <p>{r.reason}</p>
          {r.decisionReason && <p>Decision: {r.decisionReason}</p>}
          {r.status === "PENDING" &&
            (data.role === "Admin" ||
              [...data.datasets, ...data.policies].some(
                (a) => a.id === r.resourceId && a.ownerId === data.user.id,
              )) && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  perform(() =>
                    api("/access-requests/" + r.id + "/decide", {
                      decision: f.get("decision"),
                      reason: f.get("reason"),
                      minutes: Number(f.get("minutes")),
                    }),
                  );
                }}
              >
                <label htmlFor={"decision-" + r.id}>Decision</label>
                <Select id={"decision-" + r.id} name="decision">
                  <option value="APPROVE">Approve</option>
                  <option value="DENY">Deny</option>
                </Select>
                <FormField
                  id={"reason-" + r.id}
                  label="Decision reason"
                  name="reason"
                  minLength={5}
                  maxLength={1000}
                  required
                />
                <FormField
                  id={"minutes-" + r.id}
                  label="Grant minutes"
                  name="minutes"
                  type="number"
                  min={1}
                  max={1440}
                  defaultValue={60}
                  required
                />
                <Button disabled={busy}>Save decision</Button>
              </form>
            )}
        </article>
      ))}
    </section>
  );
}
