import { Button } from "../components/atoms/Button.jsx";
import { AccountScreen } from "./AccountScreen.jsx";
export function NoWorkspaceScreen({ data, logout }) {
  return (
    <main className="no-workspace">
      <section className="panel settings-panel">
        <h1>No workspace access</h1>
        <p>
          Your account is signed in. Ask an organization administrator to assign
          a workspace, or create your own organization below.
        </p>
        <Button variant="secondary" onClick={logout}>
          Sign out
        </Button>
      </section>
      <AccountScreen page="Account" data={data} />
    </main>
  );
}
