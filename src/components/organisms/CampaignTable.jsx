import { ArrowUpRight, ChevronRight, Play } from "lucide-react";
import { Badge } from "../atoms/Badge.jsx";
import { Empty } from "../molecules/Empty.jsx";
import { date } from "../../lib/format.js";
export function CampaignTable({
  runs,
  onOpen,
  onAll,
  emptyAction,
  full,
  emptyTitle,
  emptyText,
}) {
  return (
    <section className="panel campaigns-panel">
      {!full && (
        <div className="panel-head">
          <h2>Recent campaigns</h2>
          <button className="text-button" onClick={onAll}>
            View all
            <ArrowUpRight size={14} />
          </button>
        </div>
      )}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Campaign name</th>
              <th>Client model</th>
              <th>Policy</th>
              <th>Progress</th>
              <th>Status</th>
              <th>Created</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.id} onClick={() => onOpen(r.id)}>
                <td>
                  <button
                    className="table-name"
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpen(r.id);
                    }}
                  >
                    {r.name}
                  </button>
                  <small className="table-id">{r.id.slice(0, 8)}</small>
                </td>
                <td>
                  {r.mode === "ollama" ? (
                    r.model
                  ) : (
                    <>
                      Synthetic adapter <span className="muted">v1</span>
                    </>
                  )}
                </td>
                <td>
                  <span className="version">v{r.policyVersion}</span> Safety
                  policy
                </td>
                <td>
                  <div className="progress-cell">
                    <div className="progress">
                      <i
                        style={{
                          width: `${Math.round((r.completed / r.total) * 100)}%`,
                        }}
                      />
                    </div>
                    <span>{Math.round((r.completed / r.total) * 100)}%</span>
                  </div>
                </td>
                <td>
                  <Badge status={r.status} />
                </td>
                <td className="nowrap">{date(r.createdAt)}</td>
                <td>
                  <ChevronRight size={15} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!runs.length && (
        <Empty
          icon={Play}
          title={emptyTitle || "Ready for your first evaluation"}
          text={
            emptyText ||
            "Create a campaign to compare a baseline with your defensive policy, then inspect the evidence."
          }
          action={emptyAction}
        />
      )}
    </section>
  );
}
