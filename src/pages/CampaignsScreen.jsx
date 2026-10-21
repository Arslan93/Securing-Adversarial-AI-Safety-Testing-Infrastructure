import { RunComparison } from "../components/organisms/RunComparison.jsx";
import { CampaignTable } from "../components/organisms/CampaignTable.jsx";
import { CampaignDrafts } from "../components/organisms/CampaignDrafts.jsx";
export function CampaignsScreen({
  drafts,
  resumeDraft,
  act,
  busy,
  page,
  detail,
  runs,
  status,
  setStatus,
  filtered,
  openRun,
  permitted,
  setModal,
}) {
  return (
    <>
      {(page === "Campaigns" || page === "Runs & findings") && !detail && (
        <>
          {permitted && (
            <CampaignDrafts
              drafts={drafts}
              resumeDraft={resumeDraft}
              act={act}
              busy={busy}
            />
          )}
          <RunComparison runs={runs} />
          <div className="table-toolbar">
            <div className="tabs">
              <button className="active">
                All campaigns <span>{runs.length}</span>
              </button>
            </div>
            <select
              aria-label="Filter campaign status"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              {[
                "All statuses",
                "COMPLETED",
                "RUNNING",
                "CANCELLED",
                "FAILED",
              ].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </div>
          <CampaignTable
            runs={filtered}
            onOpen={openRun}
            emptyTitle={runs.length ? "No campaigns match your filters" : null}
            emptyText={
              runs.length
                ? "Clear the search or choose another status to see your campaigns."
                : null
            }
            emptyAction={
              permitted && !runs.length ? () => setModal("campaign") : null
            }
            full
          />
        </>
      )}
    </>
  );
}
