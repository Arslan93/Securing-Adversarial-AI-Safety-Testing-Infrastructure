import { ArrowUpRight } from "lucide-react";
import { date } from "../../lib/format.js";
export function AuditEvents({ events, onAll }) {
  return (
    <section className="panel audit-events">
      <div className="panel-head">
        <h2>Recent audit events</h2>
        {onAll && (
          <button className="text-button" onClick={onAll}>
            View all
            <ArrowUpRight size={14} />
          </button>
        )}
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Event</th>
              <th>Details</th>
              <th>Event hash</th>
            </tr>
          </thead>
          <tbody>
            {events.map((e) => (
              <tr key={e.hash}>
                <td className="nowrap">{date(e.time)}</td>
                <td>
                  <span
                    className={
                      "event-dot " + (e.type.includes("denied") ? "denied" : "")
                    }
                  />
                  <strong className="event-type">
                    {e.type.replaceAll(".", " ")}
                  </strong>
                </td>
                <td className="event-details">
                  {e.data.runId
                    ? "Run " + e.data.runId.slice(0, 8)
                    : e.data.workspace
                      ? "Workspace " + e.data.workspace.slice(0, 12)
                      : e.data.role
                        ? "Role: " + e.data.role
                        : e.data.policyId
                          ? "Policy " + e.data.policyId.slice(0, 8)
                          : "Configuration captured"}
                </td>
                <td>
                  <code>{e.hash.slice(0, 14)}…</code>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
