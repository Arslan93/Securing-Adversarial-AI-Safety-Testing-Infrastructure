import { AccessRequests } from "../components/organisms/AccessRequests.jsx";
import { AccountSecurity } from "../components/organisms/AccountSecurity.jsx";
import { useState } from "react";
import { api } from "../lib/api.js";
import { FormField } from "../components/molecules/FormField.jsx";
import { Button } from "../components/atoms/Button.jsx";
export function AccountScreen({ page, data }) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  if (page !== "Account") return null;
  async function perform(fn) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel settings-panel">
      <h2>Your account</h2>
      <p>
        {data.user.name} · {data.user.email}
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <AccountSecurity />
      <AccessRequests data={data} />
      <h3>Organizations</h3>
      {data.organizations.map((org) => (
        <p key={org.id}>
          {org.name}{" "}
          {org.id === data.organization.id ? (
            "(current)"
          ) : (
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() =>
                perform(async () => {
                  await api("/organizations/switch", {
                    organizationId: org.id,
                  });
                  window.location.reload();
                })
              }
            >
              Switch organization
            </Button>
          )}
        </p>
      ))}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const name = new FormData(e.currentTarget).get("name");
          perform(async () => {
            const org = await api("/organizations", { name });
            await api("/organizations/switch", { organizationId: org.id });
            window.location.reload();
          });
        }}
      >
        <FormField
          id="new-org"
          label="New organization name"
          name="name"
          required
          maxLength={80}
        />
        <Button disabled={busy}>Create separate organization</Button>
      </form>
      <h3>Change password</h3>
      <p>Changing your password signs you out of every session.</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          perform(async () => {
            await api("/account/password", {
              currentPassword: f.get("current"),
              password: f.get("password"),
            });
            window.location.reload();
          });
        }}
      >
        <FormField
          id="current-password"
          name="current"
          label="Current password"
          type="password"
          autoComplete="current-password"
          required
          maxLength={128}
        />
        <FormField
          id="new-password"
          name="password"
          label="New password"
          type="password"
          autoComplete="new-password"
          minLength={12}
          maxLength={128}
          required
        />
        <Button disabled={busy}>Change password and sign out</Button>
      </form>
    </section>
  );
}
