import { Play, FileText, ScanFace, Shield, Info } from "lucide-react";
import { Metric } from "../components/molecules/Metric.jsx";
import { ActivityChart } from "../components/organisms/ActivityChart.jsx";
import { Topology } from "../components/organisms/Topology.jsx";
import { CampaignTable } from "../components/organisms/CampaignTable.jsx";
import { AuditEvents } from "../components/organisms/AuditEvents.jsx";
import { running } from "../lib/format.js";
import { evaluationMetrics } from "../lib/metrics.js";
export function OverviewScreen({
  page,
  runs,
  metricMode,
  setMetricMode,
  period,
  setPeriod,
  filtered,
  openRun,
  navigate,
  permitted,
  setModal,
  data,
}) {
  if (page !== "Overview") return null;
  const { completed, pairedCases, adversarial, violations, rate } =
    evaluationMetrics(runs, metricMode);
  const live = metricMode === "ollama";
  return (
    <>
      <div className="metrics-context">
        <div>
          <strong>
            {live ? "Live local results" : "Synthetic fixture results"}
          </strong>
          <span>
            {live
              ? "Exact canary disclosure only; environment isolation is unverified."
              : "Predetermined demo outcomes; these do not measure a real model."}
          </span>
        </div>
        <div className="segmented" role="group" aria-label="Metric source">
          <button
            aria-pressed={!live}
            className={!live ? "active" : ""}
            onClick={() => setMetricMode("synthetic-demo")}
          >
            Synthetic fixtures
          </button>
          <button
            aria-pressed={live}
            className={live ? "active" : ""}
            onClick={() => setMetricMode("ollama")}
          >
            Live local model
          </button>
        </div>
      </div>
      <div className="metrics">
        <Metric
          icon={Play}
          label="Active campaigns"
          value={runs.filter((r) => running(r.status)).length}
          note={`${runs.length} total · all adapters`}
        />
        <Metric
          icon={FileText}
          label={live ? "Live model attempts" : "Fixture attempts"}
          value={pairedCases * 2}
          note={`${completed.length} completed ${live ? "live" : "fixture"} runs`}
        />
        <Metric
          icon={ScanFace}
          label={live ? "Canary disclosure rate" : "Fixture violation rate"}
          value={rate}
          note={`${violations} / ${adversarial} adversarial cases`}
          tone="rose"
        />
        <Metric
          icon={Shield}
          label="Evidence integrity"
          value={completed.length ? "Unverified" : "—"}
          note={
            data.evidence?.configured
              ? "Signed exports enabled · Verify pinned key"
              : "Signing is not configured"
          }
        />
      </div>
      <div className="overview-grid">
        <section className="panel activity-panel">
          <div className="panel-head">
            <h2>
              {live
                ? "Live evaluation activity"
                : "Fixture evaluation activity"}
            </h2>
            <div className="segmented">
              {["7D", "30D", "90D"].map((p) => (
                <button
                  key={p}
                  className={period === p ? "active" : ""}
                  onClick={() => setPeriod(p)}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
          <ActivityChart runs={completed} period={period} live={live} />
        </section>
        <Topology />
      </div>
      {!completed.length && (
        <div className="info-line">
          <Info size={16} />
          {live
            ? "No completed live evaluations in this workspace. Choose Local Ollama when creating a campaign."
            : "No completed fixture evaluations in this workspace. Start a synthetic campaign to explore the workflow."}
        </div>
      )}
      <CampaignTable
        runs={filtered.slice(0, 4)}
        onOpen={openRun}
        onAll={() => navigate("Campaigns")}
        emptyTitle={runs.length ? "No campaigns match your search" : null}
        emptyText={
          runs.length
            ? "Clear the campaign search to see recent activity."
            : null
        }
        emptyAction={
          permitted && !runs.length ? () => setModal("campaign") : null
        }
      />
      <AuditEvents
        events={data.events.slice(0, 3)}
        onAll={() => navigate("Audit vault")}
      />
    </>
  );
}
