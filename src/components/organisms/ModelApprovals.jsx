import { Input } from "../atoms/Input.jsx";
import { Button } from "../atoms/Button.jsx";
export function ModelApprovals({ status, mutate, busy }) {
  return (
    <section className="panel settings-panel">
      <h2>Approved model revisions</h2>
      <p>
        Pilot campaigns require approval of the exact local model digest.
        Revocation stops affected pilot workers at the next broker check.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const form = e.currentTarget,
            body = Object.fromEntries(new FormData(form));
          mutate("/pilot/approvals", body, () => form.reset());
        }}
      >
        <label htmlFor="approval-model">Local model name</label>
        <Input
          id="approval-model"
          name="model"
          required
          maxLength={121}
          placeholder="smollm2:135m"
        />
        <label htmlFor="approval-digest">Full model revision digest</label>
        <Input
          id="approval-digest"
          name="digest"
          required
          maxLength={71}
          placeholder="Full SHA-256 digest"
        />
        <label htmlFor="approval-reason">Approval reason</label>
        <Input
          id="approval-reason"
          name="reason"
          required
          minLength={10}
          maxLength={1000}
        />
        <Button disabled={busy}>Approve revision</Button>
      </form>
      <div className="approval-list">
        {status.approvals.map((a) => (
          <article key={a.id} className="operator-record">
            <strong>
              {a.model} · {a.revoked ? "Revoked" : "Approved"}
            </strong>
            <code>{a.digest}</code>
            {!a.revoked && (
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() =>
                  mutate(`/pilot/approvals/${a.id}/revoke`, {
                    reason:
                      "Operator revoked this model revision from the approval list.",
                  })
                }
              >
                Revoke revision
              </Button>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
