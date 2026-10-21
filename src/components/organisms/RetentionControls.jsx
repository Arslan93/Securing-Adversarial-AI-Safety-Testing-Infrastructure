import { useState } from "react";
import { Input } from "../atoms/Input.jsx";
import { Select } from "../atoms/Select.jsx";
import { Button } from "../atoms/Button.jsx";
export function RetentionControls({ status, mutate, busy }) {
  const [workspace, setWorkspace] = useState(""),
    [plan, setPlan] = useState(null),
    [confirmation, setConfirmation] = useState(""),
    [ack, setAck] = useState(false);
  const selected = status.workspaces.find((w) => w.id === workspace);
  return (
    <section className="panel settings-panel">
      <h2>Workspace retention</h2>
      <p>
        Retire a workspace and remove its private content from application
        state. Verifiable public metadata, shared organization artifacts and
        operator-managed backups remain.
      </p>
      <label htmlFor="retention-workspace">Retention workspace</label>
      <Select
        id="retention-workspace"
        value={workspace}
        onChange={(e) => {
          setWorkspace(e.target.value);
          setPlan(null);
          setConfirmation("");
          setAck(false);
        }}
      >
        <option value="">Select workspace</option>
        {status.workspaces.map((w) => (
          <option key={w.id} value={w.id} disabled={w.retired}>
            {w.name}
            {w.retired ? " · retired" : w.hold ? " · on hold" : ""}
          </option>
        ))}
      </Select>
      {selected && !selected.retired && (
        <>
          <p>
            {selected.hold
              ? "Retention hold is active. Removal is blocked."
              : "No retention hold is active."}
          </p>
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => {
              setPlan(null);
              mutate("/pilot/retention-hold", {
                workspaceId: workspace,
                held: !selected.hold,
                reason: selected.hold
                  ? "Operator released the workspace retention hold."
                  : "Operator placed the workspace under a retention hold.",
              });
            }}
          >
            {selected.hold ? "Release retention hold" : "Place retention hold"}
          </Button>
          <Button
            variant="secondary"
            disabled={busy || selected.hold}
            onClick={() =>
              mutate(
                "/pilot/retention/plan",
                { workspaceId: workspace },
                setPlan,
              )
            }
          >
            Review removal plan
          </Button>
        </>
      )}
      {plan && (
        <form
          className="retention-plan"
          onSubmit={(e) => {
            e.preventDefault();
            mutate(
              "/pilot/retention/apply",
              {
                planId: plan.id,
                confirmation,
                reason:
                  "Operator confirmed the reviewed workspace private-content removal plan.",
              },
              () => {
                setPlan(null);
                setWorkspace("");
              },
            );
          }}
        >
          <p>
            <strong>Plan:</strong> {plan.counts.runs} run snapshots,{" "}
            {plan.counts.datasets} workspace datasets and {plan.counts.policies}{" "}
            workspace policies. Active work or unverified cleanup blocks
            removal.
          </p>
          <label htmlFor="retention-confirm">
            Type “{plan.confirmation}” to confirm retirement
          </label>
          <Input
            id="retention-confirm"
            required
            value={confirmation}
            onChange={(e) => setConfirmation(e.target.value)}
          />
          <label className="consent">
            <Input
              type="checkbox"
              checked={ack}
              onChange={(e) => setAck(e.target.checked)}
            />
            <span>
              I understand that public audit metadata and separate backups
              remain. Removed private content cannot be recovered through this
              app.
            </span>
          </label>
          <Button
            className="danger"
            disabled={busy || !ack || confirmation !== plan.confirmation}
          >
            Retire workspace and remove private content
          </Button>
        </form>
      )}
    </section>
  );
}
