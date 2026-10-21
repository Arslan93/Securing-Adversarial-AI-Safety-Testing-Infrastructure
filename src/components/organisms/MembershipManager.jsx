import { useState, useEffect } from "react";
import { api } from "../../lib/api.js";
import { Button } from "../atoms/Button.jsx";
import { Select } from "../atoms/Select.jsx";
import { FormField } from "../molecules/FormField.jsx";
const roles = ["Admin", "Red", "Blue", "Analyst", "Auditor"];
export function MembershipManager({ data }) {
  const [members, setMembers] = useState([]),
    [grants, setGrants] = useState([]),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const load = async () => {
    const [m, g] = await Promise.all([api("/members"), api("/grants")]);
    setMembers(m.members);
    setGrants(g.grants);
  };
  useEffect(() => {
    let active = true;
    Promise.all([api("/members"), api("/grants")])
      .then(([m, g]) => {
        if (active) {
          setMembers(m.members);
          setGrants(g.grants);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [data.organization?.id]);
  async function perform(fn) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
      await load();
      setNotice("Access settings saved.");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  const workspaceChecks = (selected = []) =>
    data.workspaces.map((w) => (
      <label key={w.id} className="membership-check">
        <input
          type="checkbox"
          name="workspaces"
          value={w.id}
          defaultChecked={selected.includes(w.id)}
        />
        {w.name}
      </label>
    ));
  return (
    <section className="panel settings-panel membership-panel">
      <h2>People & artifact access</h2>
      <p>
        Create individual local accounts. Changes to membership revoke all
        sessions for that member. Administrators can manage every workspace.
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const form = e.currentTarget,
            f = new FormData(form);
          perform(async () => {
            await api("/members", {
              name: f.get("name"),
              email: f.get("email"),
              password: f.get("password"),
              role: f.get("role"),
              workspaces: f.getAll("workspaces"),
            });
            form.reset();
          });
        }}
      >
        <h3>Add a member</h3>
        <FormField
          id="member-name"
          name="name"
          label="Name"
          required
          maxLength={80}
        />
        <FormField
          id="member-email"
          name="email"
          label="Email"
          type="email"
          autoComplete="off"
          required
        />
        <FormField
          id="member-password"
          name="password"
          label="Initial password"
          type="password"
          minLength={12}
          maxLength={128}
          autoComplete="new-password"
          required
        />
        <label htmlFor="member-role">Role</label>
        <Select id="member-role" name="role" defaultValue="Red">
          {roles.map((r) => (
            <option key={r}>{r}</option>
          ))}
        </Select>
        <fieldset>
          <legend>Workspace memberships</legend>
          {workspaceChecks()}
        </fieldset>
        <Button disabled={busy}>Create account</Button>
      </form>
      <h3>Current members</h3>
      <div className="member-list">
        {members.map((m) => (
          <form
            key={`${m.id}:${m.role}:${m.workspaces.join()}`}
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              perform(() =>
                api("/members/" + m.id, {
                  role: f.get("role"),
                  workspaces: f.getAll("workspaces"),
                }),
              );
            }}
          >
            <strong>{m.name}</strong>
            <small>{m.email}</small>
            <label htmlFor={"role-" + m.id}>Role</label>
            <Select id={"role-" + m.id} name="role" defaultValue={m.role}>
              {roles.map((r) => (
                <option key={r}>{r}</option>
              ))}
            </Select>
            <fieldset>
              <legend>Workspaces</legend>
              {workspaceChecks(m.workspaces)}
            </fieldset>
            <Button variant="secondary" disabled={busy}>
              Update membership
            </Button>
          </form>
        ))}
      </div>
      <h3>Time-limited artifact grant</h3>
      <p>
        Grants permit private artifact reads within the recipient’s existing
        role and workspace permissions.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          perform(() =>
            api("/grants", {
              resourceId: f.get("resource"),
              userId: f.get("user"),
              minutes: Number(f.get("minutes")),
            }),
          );
        }}
      >
        <label htmlFor="grant-resource">Artifact</label>
        <Select id="grant-resource" name="resource" required>
          {[...data.datasets, ...data.policies].map((a) => (
            <option key={a.id} value={a.id}>
              {a.name} · v{a.version}
            </option>
          ))}
        </Select>
        <label htmlFor="grant-user">Recipient</label>
        <Select id="grant-user" name="user" required>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name} ({m.role})
            </option>
          ))}
        </Select>
        <FormField
          id="grant-minutes"
          label="Expires after (minutes)"
          name="minutes"
          type="number"
          min={1}
          max={1440}
          defaultValue={60}
          required
        />
        <Button disabled={busy}>Approve grant</Button>
      </form>
      <ul>
        {grants.map((g) => (
          <li key={g.id}>
            {members.find((m) => m.id === g.userId)?.name || g.userId} ·{" "}
            {new Date(g.expires).toLocaleString()} ·{" "}
            {g.revoked ? (
              "Revoked"
            ) : g.expires <= Date.now() ? (
              "Expired"
            ) : (
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() =>
                  perform(() => api("/grants/" + g.id + "/revoke", {}))
                }
              >
                Revoke grant
              </Button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
