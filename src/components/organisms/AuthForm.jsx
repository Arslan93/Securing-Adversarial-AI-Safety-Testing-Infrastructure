import { Button } from "../atoms/Button.jsx";
import { FormField } from "../molecules/FormField.jsx";
export function AuthForm({ setup, onSubmit, busy, disabled, mfa, invite }) {
  return (
    <form onSubmit={onSubmit}>
      {mfa ? (
        <>
          <FormField
            id="mfa-code"
            name="code"
            label="Authenticator or recovery code"
            required
            maxLength={64}
            autoComplete="one-time-code"
            autoFocus
          />
          <Button className="login-submit" disabled={busy}>
            Verify and sign in
          </Button>
        </>
      ) : (
        <>
          {invite && (
            <>
              <FormField
                id="invite-token"
                name="invitationToken"
                label="Invitation token"
                required
                minLength={64}
                maxLength={64}
              />
              <FormField
                id="invite-name"
                name="name"
                label="Your name"
                required
                maxLength={80}
              />
            </>
          )}

          {setup && (
            <>
              <FormField
                id="name"
                name="name"
                label="Your name"
                required
                maxLength={80}
                autoComplete="name"
              />
              <FormField
                id="organization"
                name="organization"
                label="Organization name"
                required
                maxLength={80}
              />
            </>
          )}
          <FormField
            id="email"
            name="email"
            label="Email"
            type="email"
            required
            autoComplete="username"
            maxLength={254}
          />
          <FormField
            id="password"
            name="password"
            label="Password"
            type="password"
            required
            minLength={12}
            maxLength={128}
            autoComplete={setup ? "new-password" : "current-password"}
            hint="12–128 characters"
          />
          <Button className="login-submit" disabled={busy || disabled}>
            {busy
              ? "Please wait…"
              : setup
                ? "Create administrator account"
                : invite
                  ? "Create invited account"
                  : "Sign in"}
          </Button>
        </>
      )}
    </form>
  );
}
