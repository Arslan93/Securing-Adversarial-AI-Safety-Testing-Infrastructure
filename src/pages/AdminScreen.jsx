import { PilotControls } from "../components/organisms/PilotControls.jsx";
import { ExecutionHealth } from "../components/organisms/ExecutionHealth.jsx";
import { InvitationManager } from "../components/organisms/InvitationManager.jsx";
import { RuntimeReadiness } from "../components/organisms/RuntimeReadiness.jsx";
import { MembershipManager } from "../components/organisms/MembershipManager.jsx";
import { Info, ArrowUpRight } from "lucide-react";
export function AdminScreen({ page, data, ws, navigate, config, refresh }) {
  return (
    <>
      {page === "Administration" && data.role === "Admin" && (
        <div className="admin-grid">
          <MembershipManager data={data} />
          <InvitationManager data={data} />
          <RuntimeReadiness />
          <ExecutionHealth />
          <PilotControls refresh={refresh} />
          <section className="panel settings-panel">
            <h2>Environment & access</h2>
            <dl>
              <div>
                <dt>Deployment mode</dt>
                <dd>
                  {config?.pilotMode ? "Restricted pilot" : "Local development"}
                </dd>
              </div>
              <div>
                <dt>Session authentication</dt>
                <dd>
                  Individual accounts · {config?.limits.sessionMinutes ?? 60}{" "}
                  minutes
                </dd>
              </div>
              <div>
                <dt>Role</dt>
                <dd>{data.role}</dd>
              </div>
              <div>
                <dt>Storage</dt>
                <dd>SQLite · local disk</dd>
              </div>
              <div>
                <dt>Model adapter</dt>
                <dd>Fixtures, shared Ollama, optional container Ollama</dd>
              </div>
            </dl>
            <div className="demo-note">
              <Info size={17} />
              <span>
                Production OIDC and a hardened runtime are required before a
                research pilot.
              </span>
            </div>
          </section>
          <section className="panel settings-panel">
            <h2>Execution limits</h2>
            <dl>
              <div>
                <dt>Intended network policy</dt>
                <dd>
                  Enforced for container campaigns; shared Ollama uses host
                  networking
                </dd>
              </div>
              <div>
                <dt>Workspace TTL</dt>
                <dd>{ws.ttl} minutes</dd>
              </div>
              <div>
                <dt>Current corpus</dt>
                <dd>20 approved cases</dd>
              </div>
              <div>
                <dt>Hostile code execution</dt>
                <dd>Disabled</dd>
              </div>
              <div>
                <dt>Containers</dt>
                <dd>Per-run profile available when configured</dd>
              </div>
            </dl>
            <button
              className="secondary"
              onClick={() => {
                navigate("Workspaces");
              }}
            >
              Manage workspaces
              <ArrowUpRight size={15} />
            </button>
          </section>
        </div>
      )}
    </>
  );
}
