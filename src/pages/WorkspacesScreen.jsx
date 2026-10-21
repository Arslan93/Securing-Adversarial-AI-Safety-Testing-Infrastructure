import { Folder, Lock, ArrowRight } from "lucide-react";
export function WorkspacesScreen({ page, data, setSelectedWs, navigate }) {
  return (
    <>
      {page === "Workspaces" && (
        <div className="workspace-grid">
          {data.workspaces.map((w) => (
            <section className="panel workspace-card" key={w.id}>
              <div className="workspace-card-top">
                <span className="tile-icon">
                  <Folder size={22} />
                </span>
                <span className="badge gray">Local demo</span>
              </div>
              <h2>{w.name}</h2>
              <p>{w.purpose || "Controlled synthetic evaluation workspace"}</p>
              <dl>
                <div>
                  <dt>Intended network policy</dt>
                  <dd>
                    <Lock size={13} />
                    {w.network} (not enforced)
                  </dd>
                </div>
                <div>
                  <dt>Maximum runtime</dt>
                  <dd>{w.ttl} minutes</dd>
                </div>
                <div>
                  <dt>Classification</dt>
                  <dd>{w.classification}</dd>
                </div>
                <div>
                  <dt>Campaigns</dt>
                  <dd>
                    {data.runs.filter((r) => r.workspaceId === w.id).length}
                  </dd>
                </div>
              </dl>
              <button
                className="secondary"
                onClick={() => {
                  setSelectedWs(w.id);
                  navigate("Campaigns");
                }}
              >
                Open workspace
                <ArrowRight size={15} />
              </button>
            </section>
          ))}
        </div>
      )}
    </>
  );
}
