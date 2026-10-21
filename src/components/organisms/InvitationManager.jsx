import { useState, useEffect } from "react";
import { api } from "../../lib/api.js";
import { Button } from "../atoms/Button.jsx";
import { FormField } from "../molecules/FormField.jsx";
import { Select } from "../atoms/Select.jsx";
export function InvitationManager({ data }) {
  const [items, setItems] = useState([]),
    [token, setToken] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const load = async () => setItems((await api("/invitations")).invitations);
  useEffect(() => {
    const abort = new AbortController();
    api("/invitations", undefined, { signal: abort.signal })
      .then((d) => setItems(d.invitations))
      .catch((e) => {
        if (!abort.signal.aborted) setError(e.message);
      });
    return () => abort.abort();
  }, []);
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
    <section className="panel settings-panel">
      <h2>Organization invitations</h2>
      <p>
        Invite a new or existing account. Deliver the single-use token through
        your own trusted channel. No email is sent automatically.
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {token && (
        <div className="demo-note">
          <div>
            <strong>Invitation token — shown once</strong>
            <code className="secret-key">{token}</code>
            <Button variant="secondary" onClick={() => setToken("")}>
              I saved the invitation token
            </Button>
          </div>
        </div>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          perform(async () => {
            const result = await api("/invitations", {
              email: f.get("email"),
              role: f.get("role"),
              hours: Number(f.get("hours")),
              workspaces: f.getAll("workspaces"),
            });
            setToken(result.token);
          });
        }}
      >
        <FormField
          id="invite-email"
          label="Invitee email"
          name="email"
          type="email"
          required
        />
        <label htmlFor="invite-role">Invitation role</label>
        <Select id="invite-role" name="role" defaultValue="Red">
          {["Admin", "Red", "Blue", "Analyst", "Auditor"].map((r) => (
            <option key={r}>{r}</option>
          ))}
        </Select>
        <FormField
          id="invite-hours"
          label="Invitation expires after (hours)"
          name="hours"
          type="number"
          min={1}
          max={168}
          defaultValue={24}
          required
        />
        <fieldset>
          <legend>Invited workspaces</legend>
          {data.workspaces.map((w) => (
            <label className="membership-check" key={w.id}>
              <input name="workspaces" type="checkbox" value={w.id} />
              {w.name}
            </label>
          ))}
        </fieldset>
        <Button disabled={busy}>Create invitation</Button>
      </form>
      {items.map((i) => (
        <p key={i.id}>
          {i.email} · {i.role} ·{" "}
          {i.consumed
            ? "Used or revoked"
            : new Date(i.expires).toLocaleString()}{" "}
          {!i.consumed && (
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() =>
                perform(() => api("/invitations/" + i.id + "/revoke", {}))
              }
            >
              Revoke invitation
            </Button>
          )}
        </p>
      ))}
    </section>
  );
}
