import { useState } from "react";
import { Info, Shield, Check, Lock, Plus } from "lucide-react";
import { date } from "../lib/format.js";
export function PoliciesScreen({
  page,
  canPolicy,
  data,
  setModal,
  setToast,
  onNewVersion,
}) {
  const [reference, setReference] = useState("");
  const previous =
    data.policies.find((p) => p.id === reference) || data.policies.at(-2);
  const latest = data.policies.at(-1);
  const added = (latest?.rules || []).filter(
    (r) => !previous?.rules?.includes(r),
  );
  const removed = (previous?.rules || []).filter(
    (r) => !latest?.rules?.includes(r),
  );
  return (
    <>
      {page === "Policy lab" && canPolicy && (
        <>
          <div className="info-line">
            <Info size={16} />
            Published versions are immutable. Active runs keep their original
            policy snapshot.
          </div>
          {data.policies.length > 1 && latest?.rules && previous?.rules && (
            <section className="panel comparison-panel">
              <h2>Policy version diff · candidate v{latest.version}</h2>
              <label className="diff-label">
                Reference policy
                <select
                  aria-label="Reference policy"
                  value={previous?.id || ""}
                  onChange={(e) => setReference(e.target.value)}
                >
                  {data.policies
                    .filter((p) => p.id !== latest.id)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} · v{p.version}
                      </option>
                    ))}
                </select>
              </label>
              <p className="subtle">
                {added.length} added · {removed.length} removed · exact text
                comparison
              </p>
              <div className="policy-diff">
                {removed.map((r) => (
                  <p className="removed" key={r}>
                    − {r}
                  </p>
                ))}
                {added.map((r) => (
                  <p className="added" key={r}>
                    + {r}
                  </p>
                ))}
                {!added.length && !removed.length && <p>No rule changes.</p>}
              </div>
            </section>
          )}
          <div className="policy-list">
            {[...data.policies].reverse().map((p) => (
              <section className="panel policy-card" key={p.id}>
                <div className="policy-icon">
                  <Shield size={24} />
                </div>
                <div className="policy-main">
                  <div className="inline">
                    <h2>{p.name}</h2>
                    <span className="version">v{p.version}</span>
                  </div>
                  <p>Published {date(p.createdAt)} · Text rule bundle</p>
                  <ul>
                    {!p.rules && (
                      <li>
                        <Lock size={14} />
                        Private rules · owner or explicit grant required
                      </li>
                    )}
                    {p.rules?.map((r, i) => (
                      <li key={i}>
                        <Check size={14} />
                        {r}
                      </li>
                    ))}
                  </ul>
                  <div className="digest">
                    <Lock size={12} />
                    <code>SHA-256 {p.digest?.slice(0, 24)}…</code>
                  </div>
                </div>
                <button
                  className="secondary"
                  disabled={!p.rules}
                  onClick={() => onNewVersion(p)}
                >
                  New version
                  <Plus size={14} />
                </button>
              </section>
            ))}
          </div>
        </>
      )}
    </>
  );
}
