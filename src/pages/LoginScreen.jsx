import { useState } from "react";
import { api } from "../lib/api.js";
import { Shield } from "lucide-react";
import { AuthTemplate } from "../components/templates/AuthTemplate.jsx";
import { AuthForm } from "../components/organisms/AuthForm.jsx";
import { Button } from "../components/atoms/Button.jsx";
export function LoginScreen({
  login,
  busy,
  error,
  config,
  connectionError,
  sessionNotice,
  retry,
  mfaChallenge,
}) {
  const setup = config?.setupRequired;
  const [invite, setInvite] = useState(false),
    [oidcError, setOidcError] = useState("");
  return (
    <AuthTemplate>
      <div className="login-symbol">
        <Shield size={32} />
      </div>
      <h1>{setup ? "Create your workspace." : "Welcome back."}</h1>
      <p>
        {setup
          ? "Set up the first administrator and claim your existing local project data."
          : "Sign in with your individual Bayora account."}
      </p>
      <div className="demo-note">
        {config?.pilotMode
          ? "Identity provider with MFA · Restricted synthetic pilot · Isolation independently unverified."
          : "Local accounts · Workspace permissions · Expiring sessions. Runtime isolation remains unverified."}
      </div>
      {sessionNotice && <p role="status">{sessionNotice}</p>}
      {connectionError && (
        <div className="error" role="alert">
          {connectionError}
          <Button variant="secondary" onClick={retry}>
            Retry connection
          </Button>
        </div>
      )}
      {config && !config.demoAuth && !config.oidcEnabled && (
        <p className="error">Local account authentication is disabled.</p>
      )}
      {config?.demoAuth && (
        <AuthForm
          setup={setup}
          onSubmit={login}
          busy={busy}
          disabled={!config?.demoAuth || !!connectionError}
          mfa={!!mfaChallenge}
          invite={invite}
        />
      )}
      {config?.demoAuth && !setup && !mfaChallenge && (
        <Button
          variant="secondary"
          type="button"
          onClick={() => setInvite(!invite)}
        >
          {invite ? "Back to sign in" : "Join with an invitation"}
        </Button>
      )}
      {config?.oidcEnabled && !mfaChallenge && (
        <Button
          variant="secondary"
          type="button"
          onClick={async () => {
            try {
              const result = await api("/oidc/start", {});
              window.location.assign(result.url);
            } catch (e) {
              setOidcError(e.message);
            }
          }}
        >
          Sign in with identity provider
        </Button>
      )}
      {oidcError && (
        <p className="error" role="alert">
          {oidcError}
        </p>
      )}
      {mfaChallenge && (
        <Button
          variant="secondary"
          type="button"
          onClick={() => window.location.reload()}
        >
          Restart sign-in
        </Button>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="login-footer">
        {config?.pilotMode
          ? "Restricted synthetic pilot · Operator approval required"
          : "Local prototype · Synthetic data · Local inference opt-in"}
      </div>
    </AuthTemplate>
  );
}
