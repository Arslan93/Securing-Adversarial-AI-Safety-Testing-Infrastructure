import { RunDetail } from "../components/organisms/RunDetail.jsx";
import { api } from "../lib/api.js";
export function RunScreen({
  cloneRun,
  exportReport,
  busy,
  detail,
  page,
  act,
  setDetail,
  setToast,
  exportRun,
  permitted,
  setModal,
}) {
  return (
    <>
      {detail && page === "Runs & findings" && (
        <RunDetail
          run={detail}
          onReview={(caseId, outcome, reason) =>
            act(async () => {
              await api("/runs/" + detail.id + "/reviews", {
                caseId,
                outcome,
                reason,
              });
              setDetail(await api("/runs/" + detail.id));
              setToast("Review appended. Original classification preserved.");
            })
          }
          onCleanup={() =>
            act(async () => {
              await api("/runs/" + detail.id + "/cleanup", {});
              setDetail(await api("/runs/" + detail.id));
              setToast("Container cleanup checked.");
            })
          }
          onExport={() => exportRun(detail.id)}
          canManage={permitted}
          onCancel={() =>
            act(async () => {
              await api("/runs/" + detail.id + "/cancel", {});
              setDetail(await api("/runs/" + detail.id));
              setToast("Run cancelled. Cleanup status recorded.");
            })
          }
          onReplay={() => cloneRun(detail.id)}
          onReport={(kind) => exportReport(detail.id, kind)}
          busy={busy}
        />
      )}
    </>
  );
}
