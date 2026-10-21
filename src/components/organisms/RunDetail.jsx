import React, { useState } from "react";
import {
  X,
  Download,
  RefreshCw,
  Lock,
  ScanFace,
  Shield,
  CheckCircle2,
  LoaderCircle,
  Check,
  Activity,
  ChevronDown,
  Info,
} from "lucide-react";
import { Badge } from "../atoms/Badge.jsx";
import { ReportActions } from "./ReportActions.jsx";
import { Metric } from "../molecules/Metric.jsx";
import { Empty } from "../molecules/Empty.jsx";
import { running, date } from "../../lib/format.js";
export function RunDetail({
  onReport,
  busy,
  run,
  onExport,
  onCancel,
  onReplay,
  canManage,
  onReview,
  onCleanup,
}) {
  const [filter, setFilter] = useState("All outcomes"),
    [selected, setSelected] = useState(null);
  const results = run.results.filter(
    (r) => filter === "All outcomes" || r.defended === "Violation",
  );
  return (
    <>
      <section className="panel run-summary">
        <div className="run-summary-top">
          <div className="inline">
            <Badge status={run.status} />
            <span className="subtle mono">{run.id.slice(0, 8)}</span>
          </div>
          <div className="inline">
            {running(run.status) && canManage ? (
              <button className="secondary danger" onClick={onCancel}>
                <X size={15} />
                Cancel run
              </button>
            ) : null}
            {!running(run.status) && (
              <ReportActions onReport={onReport} busy={busy} />
            )}
            {!running(run.status) && (
              <button className="secondary" onClick={onExport}>
                <Download size={15} />
                Export evidence
              </button>
            )}
            {canManage && !running(run.status) && (
              <button className="primary" onClick={onReplay}>
                <RefreshCw size={15} />
                {run.status === "FAILED"
                  ? "Retry as new evaluation"
                  : "Clone campaign"}
              </button>
            )}
          </div>
        </div>
        <div className="run-config">
          <div>
            <small>CLIENT MODEL</small>
            <strong>{run.model}</strong>
          </div>
          <div>
            <small>POLICY VERSION</small>
            <strong>
              {run.policyName || "Safety policy"} · v{run.policyVersion}
            </strong>
          </div>
          <div>
            <small>DATASET</small>
            <strong>
              {run.datasetName || "Historical corpus"} · {run.total} cases · v
              {run.datasetVersion || "legacy"}
            </strong>
          </div>
          <div>
            <small>ENVIRONMENT VERDICT</small>
            <strong className="warning-text">
              {run.validity === "PENDING"
                ? "Pending evaluation"
                : run.mode === "ollama"
                  ? run.runtimeReport
                    ? "Unverified · Container profile"
                    : "Unverified · Shared runtime"
                  : "Demo only · Unattested"}
            </strong>
          </div>
        </div>
        <div className="snapshot">
          <Lock size={13} />
          <span>Frozen manifest</span>
          <code>{run.manifestHash.slice(0, 32)}…</code>
        </div>
      </section>
      {run.rawAccess === false && (
        <p className="demo-note">
          Response bodies are restricted. Your role and grants for the run’s
          private input artifacts determine access.
        </p>
      )}
      {run.runtimeReport && (
        <section className="panel settings-panel">
          <h2>Runtime boundary report</h2>
          <p>
            {run.runtimeReport.profile || "Container profile"} ·{" "}
            {run.runtimeReport.status}
          </p>
          <p>
            {run.runtimeReport.qualification ||
              "Local runtime observations. Environment integrity remains unverified."}
          </p>
          <dl>
            <div>
              <dt>Container profiles checked</dt>
              <dd>{run.runtimeReport.checks?.length || 0}</dd>
            </div>
            <div>
              <dt>Runtime boundary probes</dt>
              <dd>{run.runtimeReport.probes?.length || 0}</dd>
            </div>
            <div>
              <dt>Cleanup</dt>
              <dd>{run.runtimeReport.cleanup?.status || "Pending"}</dd>
            </div>
          </dl>
          {run.runtimeReport.cleanup?.status === "FAILED" && canManage && (
            <button className="secondary" onClick={onCleanup}>
              Retry container cleanup
            </button>
          )}
        </section>
      )}
      <div className="metrics three">
        <Metric
          icon={ScanFace}
          label="Baseline violations"
          value={`${run.baseline} / ${run.validAdversarial ?? run.adversarialTotal}`}
          note={
            run.mode === "ollama"
              ? "Exact canary disclosure"
              : "Synthetic fixture outcomes"
          }
          tone="rose"
        />
        <Metric
          icon={Shield}
          label="Defended violations"
          value={`${run.defended} / ${run.validAdversarial ?? run.adversarialTotal}`}
          note="Same frozen corpus"
        />
        <Metric
          icon={CheckCircle2}
          label="Recorded case pairs"
          value={`${run.completed} / ${run.total}`}
          note={`${run.transportErrors || 0} failed model attempts`}
        />
      </div>
      {run.attempts?.length > 0 && (
        <section className="panel attempts-panel">
          <div className="panel-head">
            <h2>Model attempts · partial failures preserved</h2>
            <span className="subtle">
              {run.attempts.length} requests recorded
            </span>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Case</th>
                  <th>Arm</th>
                  <th>Status</th>
                  <th>Assessment</th>
                  <th>Latency / error</th>
                </tr>
              </thead>
              <tbody>
                {run.attempts.map((a) => (
                  <tr key={a.id}>
                    <td>{a.caseId}</td>
                    <td>{a.arm}</td>
                    <td>{a.status}</td>
                    <td>{a.assessment}</td>
                    <td>{a.error || `${a.latency} ms`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      <section className="panel timeline-panel">
        <div className="panel-head">
          <h2>Execution timeline</h2>
          <span className="subtle">
            {running(run.status)
              ? "Updates automatically"
              : "Finalized · read only"}
          </span>
        </div>
        <div className="timeline">
          {run.timeline.map((s, i) => (
            <div className="timeline-step" key={s.status}>
              <span
                className={
                  i === run.timeline.length - 1 && running(run.status)
                    ? "current"
                    : ""
                }
              >
                {i === run.timeline.length - 1 && running(run.status) ? (
                  <LoaderCircle size={14} className="spin" />
                ) : (
                  <Check size={13} />
                )}
              </span>
              <b>{s.status.toLowerCase()}</b>
              <small>{new Date(s.time).toLocaleTimeString("en-GB")}</small>
            </div>
          ))}
        </div>
        {run.cleanup && (
          <div className="cleanup">
            <CheckCircle2 size={15} />
            {run.cleanup}
          </div>
        )}
      </section>
      <section className="panel">
        <div className="panel-head">
          <h2>Per-case outcomes</h2>
          <select
            aria-label="Filter outcomes"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            <option>All outcomes</option>
            <option>Violations only</option>
          </select>
        </div>
        {!run.results.length ? (
          <Empty
            icon={Activity}
            title={
              running(run.status) ? "Evaluation in progress" : "No case results"
            }
            text={
              running(run.status)
                ? run.mode === "ollama"
                  ? "The local model is processing baseline and defended requests. Results appear after each completed pair."
                  : "The synthetic adapter is processing the paired test corpus."
                : "This run ended before evaluation results were recorded."
            }
          />
        ) : !results.length ? (
          <Empty
            icon={Activity}
            title="No outcomes match this filter"
            text="Choose All outcomes to inspect every evaluated case."
          />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Case</th>
                  <th>Category</th>
                  <th>Baseline</th>
                  <th>Defended</th>
                  <th>Latency</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {results.map((r) => (
                  <React.Fragment key={r.id}>
                    <tr>
                      <td>
                        <button
                          className="table-name"
                          onClick={() =>
                            setSelected(selected === r.id ? null : r.id)
                          }
                        >
                          {r.id} · {r.name}
                        </button>
                      </td>
                      <td>{r.category}</td>
                      <td>
                        <span
                          className={
                            "outcome " +
                            ([
                              "Safe",
                              "No disclosure detected",
                              "Control passed",
                            ].includes(r.baseline)
                              ? "safe"
                              : "unsafe")
                          }
                        >
                          {r.baseline}
                        </span>
                      </td>
                      <td>
                        <span
                          className={
                            "outcome " +
                            ([
                              "Safe",
                              "No disclosure detected",
                              "Control passed",
                            ].includes(r.defended)
                              ? "safe"
                              : "unsafe")
                          }
                        >
                          {r.defended}
                        </span>
                      </td>
                      <td>
                        {r.latency} ms{" "}
                        <span className="muted">
                          {run.mode === "ollama" ? "paired" : "fixture"}
                        </span>
                      </td>
                      <td>
                        <button
                          className="icon-btn"
                          aria-label={"Inspect " + r.id}
                          onClick={() =>
                            setSelected(selected === r.id ? null : r.id)
                          }
                        >
                          <ChevronDown size={15} />
                        </button>
                      </td>
                    </tr>
                    {selected === r.id && (
                      <tr>
                        <td colSpan="6">
                          <div className="result-detail">
                            <b>
                              Defended response ·{" "}
                              {run.mode === "ollama"
                                ? "live local model"
                                : "synthetic fixture"}
                            </b>
                            {r.output ? (
                              <p>{r.output}</p>
                            ) : (
                              <p>Raw responses are restricted for this role.</p>
                            )}
                            {r.baselineOutput && (
                              <>
                                <b>Baseline response</b>
                                <p>{r.baselineOutput}</p>
                              </>
                            )}
                            {r.rubric && <p>{r.rubric}</p>}
                            <small>
                              Evaluator:{" "}
                              {run.mode === "ollama"
                                ? run.snapshot?.evaluator ||
                                  "random-canary-utility-v2"
                                : "fixture-rubric-v1"}{" "}
                              · Original outcome preserved
                            </small>
                            {run.reviews
                              ?.filter((review) => review.caseId === r.id)
                              .map((review) => (
                                <div className="review-note" key={review.id}>
                                  <CheckCircle2 size={14} />
                                  <div>
                                    <b>
                                      Reviewed as {review.outcome} ·{" "}
                                      {review.role}
                                    </b>
                                    {review.reason && <p>{review.reason}</p>}
                                    <small>{date(review.time)}</small>
                                  </div>
                                </div>
                              ))}
                            {canManage && !running(run.status) && (
                              <form
                                className="review-form"
                                onSubmit={(e) => {
                                  e.preventDefault();
                                  const f = new FormData(e.currentTarget);
                                  onReview(
                                    r.id,
                                    f.get("outcome"),
                                    f.get("reason"),
                                  );
                                  e.currentTarget.reset();
                                }}
                              >
                                <label>
                                  Analyst classification
                                  <select name="outcome">
                                    <option>Safe</option>
                                    <option>Violation</option>
                                  </select>
                                </label>
                                <label>
                                  Review reason
                                  <input
                                    name="reason"
                                    required
                                    minLength={5}
                                    maxLength={1000}
                                    placeholder="Explain your assessment…"
                                  />
                                </label>
                                <button className="secondary" type="submit">
                                  <Check size={14} />
                                  Append review
                                </button>
                              </form>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <div className="info-line">
        <Info size={16} />
        Model scores do not establish runtime isolation. No container or
        independent audit anchor was provisioned.
      </div>
    </>
  );
}
