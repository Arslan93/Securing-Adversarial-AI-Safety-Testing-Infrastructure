import { EvidenceStatus } from "../components/organisms/EvidenceStatus.jsx";
import {
  Shield,
  Upload,
  CheckCircle2,
  TriangleAlert,
  Lock,
  FileText,
  Download,
} from "lucide-react";
import { AuditEvents } from "../components/organisms/AuditEvents.jsx";
import { Empty } from "../components/molecules/Empty.jsx";
import { running, date } from "../lib/format.js";
export function AuditScreen({
  page,
  verifyFile,
  verify,
  data,
  runs,
  exportRun,
}) {
  return (
    <>
      {page === "Audit vault" && (
        <>
          <div className="audit-grid">
            <section className="panel verify-panel">
              <div className="panel-head">
                <h2>
                  <Shield size={19} />
                  Evidence verifier
                </h2>
                <span className="badge gray">Hash and signature checks</span>
              </div>
              <p>
                Check a downloaded evidence package for changed, missing, or
                reordered events.
              </p>
              <label className="upload-area">
                <Upload size={25} />
                <strong>Choose an evidence package</strong>
                <span>Bayora JSON · up to 1 MB</span>
                <input
                  type="file"
                  accept="application/json,.json"
                  onChange={verifyFile}
                />
              </label>
              {verify && (
                <div
                  className={
                    verify.valid ? "verify-result good" : "verify-result bad"
                  }
                >
                  {verify.valid ? (
                    <CheckCircle2 size={19} />
                  ) : (
                    <TriangleAlert size={19} />
                  )}
                  <div>
                    <b>
                      {verify.valid
                        ? verify.trusted
                          ? "Trusted signature and hash chain verified"
                          : "Hash chain is consistent; signer is not trusted"
                        : "Verification failed"}
                    </b>
                    <p>
                      {verify.valid
                        ? `${verify.events} events checked. ${verify.qualification}`
                        : verify.error}
                    </p>
                  </div>
                </div>
              )}
            </section>
            <section className="panel proof-panel">
              <div className="tile-icon">
                <Lock size={22} />
              </div>
              <h2>Evidence trust</h2>
              <EvidenceStatus />
              <p>
                Signed checkpoints prove that a package matches a trusted key.
                Protection against a privileged host requires a separately
                controlled signer.
              </p>
              <dl>
                <div>
                  <dt>Hash algorithm</dt>
                  <dd>SHA-256</dd>
                </div>
                <div>
                  <dt>External signing anchor</dt>
                  <dd>Checked against the configured public key</dd>
                </div>
                <div>
                  <dt>Raw Red payloads</dt>
                  <dd>Excluded from exports</dd>
                </div>
              </dl>
            </section>
          </div>
          <AuditEvents events={data.events} />
          <section className="panel export-panel">
            <div className="panel-head">
              <h2>Finalized campaign evidence</h2>
            </div>
            {runs.filter((r) => !running(r.status)).length ? (
              runs
                .filter((r) => !running(r.status))
                .map((r) => (
                  <div className="export-row" key={r.id}>
                    <FileText size={18} />
                    <div>
                      <b>{r.name}</b>
                      <small>
                        {date(r.createdAt)} · {r.validity}
                      </small>
                    </div>
                    <button
                      className="secondary"
                      onClick={() => exportRun(r.id)}
                    >
                      <Download size={15} />
                      Export JSON
                    </button>
                  </div>
                ))
            ) : (
              <Empty
                icon={FileText}
                title="No finalized evidence yet"
                text="Complete a campaign to download its manifest, results, and audit chain."
              />
            )}
          </section>
        </>
      )}
    </>
  );
}
