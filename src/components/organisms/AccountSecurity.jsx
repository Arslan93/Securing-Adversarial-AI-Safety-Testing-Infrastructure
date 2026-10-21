import { useState, useEffect } from "react";
import { api } from "../../lib/api.js";
import { Button } from "../atoms/Button.jsx";
import { FormField } from "../molecules/FormField.jsx";
export function AccountSecurity() {
  const [security, setSecurity] = useState(null),
    [secret, setSecret] = useState(""),
    [codes, setCodes] = useState([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  useEffect(() => {
    const abort = new AbortController();
    api("/account/security", undefined, { signal: abort.signal })
      .then(setSecurity)
      .catch((e) => {
        if (!abort.signal.aborted) setError(e.message);
      });
    return () => abort.abort();
  }, []);
  async function perform(fn) {
    setError("");
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="account-security">
      <h3>Multifactor authentication</h3>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      <p>
        {security?.mfaEnabled
          ? "Authenticator enabled. Recovery codes can each be used once."
          : "Add an authenticator app to protect password sign-in."}
      </p>
      {codes.length > 0 && (
        <div className="demo-note" role="status">
          <div>
            <strong>Save these recovery codes now. They are shown once.</strong>
            <pre>{codes.join("\n")}</pre>
            <Button variant="secondary" onClick={() => setCodes([])}>
              I saved my recovery codes
            </Button>
          </div>
        </div>
      )}
      {!security?.mfaEnabled && !secret && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const password = new FormData(e.currentTarget).get("password");
            perform(async () => {
              const result = await api("/account/mfa/enroll", { password });
              setSecret(result.secret);
            });
          }}
        >
          <FormField
            id="mfa-password"
            label="Current password for MFA setup"
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
          <Button disabled={busy}>Set up authenticator</Button>
        </form>
      )}
      {secret && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const code = new FormData(e.currentTarget).get("code");
            perform(async () => {
              const result = await api("/account/mfa/confirm", { code });
              setCodes(result.recoveryCodes);
              setSecret("");
              setSecurity({ ...security, mfaEnabled: true });
              setMessage("MFA enabled. Other sessions have been revoked.");
            });
          }}
        >
          <p>
            Enter this setup key in your authenticator app:{" "}
            <code className="secret-key">{secret}</code>
          </p>
          <FormField
            id="enroll-code"
            label="Six-digit authenticator code"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            required
          />
          <Button disabled={busy}>Confirm authenticator</Button>
        </form>
      )}
      {security?.mfaEnabled && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            perform(async () => {
              await api("/account/mfa/disable", {
                password: f.get("password"),
                code: f.get("code"),
              });
              window.location.reload();
            });
          }}
        >
          <FormField
            id="disable-password"
            label="Password to disable MFA"
            name="password"
            type="password"
            required
          />
          <FormField
            id="disable-code"
            label="Fresh authenticator or recovery code"
            name="code"
            required
            maxLength={64}
          />
          <Button variant="secondary" disabled={busy}>
            Disable MFA and sign out
          </Button>
        </form>
      )}
      <h3>Identity provider</h3>
      {!security?.oidcConfigured && (
        <p className="subtle">
          No identity provider is configured for this installation.
        </p>
      )}
      <p>
        Linking requires your current password and a fresh MFA code when
        enabled. Application roles remain controlled by workspace membership.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          perform(async () => {
            const result = await api("/account/oidc/connect", {
              password: f.get("password"),
              code: f.get("code"),
            });
            window.location.assign(result.url);
          });
        }}
      >
        <FormField
          id="link-password"
          label="Password to link identity"
          name="password"
          type="password"
          required
        />
        {security?.mfaEnabled && (
          <FormField
            id="link-code"
            label="MFA code to link identity"
            name="code"
            required
          />
        )}
        <Button
          variant="secondary"
          disabled={busy || !security?.oidcConfigured}
        >
          Connect identity provider
        </Button>
      </form>
      {security?.oidcLinks?.map((link) => (
        <p key={link.issuer}>Connected: {link.issuer}</p>
      ))}
      <h3>Accept an organization invitation</h3>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const token = new FormData(e.currentTarget).get("token");
          perform(async () => {
            await api("/invitations/accept", { token });
            window.location.reload();
          });
        }}
      >
        <FormField
          id="accept-token"
          label="Invitation token"
          name="token"
          minLength={64}
          maxLength={64}
          required
        />
        <Button disabled={busy}>Accept invitation</Button>
      </form>
    </section>
  );
}
