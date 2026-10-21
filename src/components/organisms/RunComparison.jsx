import { useState } from "react";
import { api } from "../../lib/api.js";
export function RunComparison({ runs }) {
  const [left, setLeft] = useState(""),
    [right, setRight] = useState(""),
    [result, setResult] = useState(null),
    [error, setError] = useState("");
  if (runs.length < 2) return null;
  async function compare(e) {
    e.preventDefault();
    setError("");
    setResult(null);
    try {
      setResult(
        await api(
          `/compare?left=${encodeURIComponent(left)}&right=${encodeURIComponent(right)}`,
        ),
      );
    } catch (e) {
      setError(e.message);
    }
  }
  return (
    <section className="panel comparison-panel">
      <h2>Compare frozen evaluations</h2>
      <p className="subtle">
        Same model, dataset and evaluator required. Policy versions may differ.
      </p>
      <form className="comparison-form" onSubmit={compare}>
        <label>
          Reference run
          <select
            required
            aria-label="Reference run"
            value={left}
            onChange={(e) => {
              setLeft(e.target.value);
              setResult(null);
            }}
          >
            <option value="">Select reference</option>
            {runs.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name} · policy v{r.policyVersion} · {r.id.slice(0, 6)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Candidate run
          <select
            required
            aria-label="Candidate run"
            value={right}
            onChange={(e) => {
              setRight(e.target.value);
              setResult(null);
            }}
          >
            <option value="">Select candidate</option>
            {runs
              .filter((r) => r.id !== left)
              .map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} · policy v{r.policyVersion} · {r.id.slice(0, 6)}
                </option>
              ))}
          </select>
        </label>
        <button
          className="secondary"
          disabled={!left || !right || left === right}
        >
          Compare runs
        </button>
      </form>
      {error && <p className="error">{error}</p>}
      {result && (
        <div
          className={
            result.comparable ? "verify-result good" : "verify-result bad"
          }
        >
          <div>
            <b>
              {result.comparable
                ? `Comparable · ${result.deltaPercentagePoints > 0 ? "+" : ""}${result.deltaPercentagePoints} percentage points`
                : "Not a like-for-like comparison"}
            </b>
            {result.reasons.map((r) => (
              <p key={r}>{r}</p>
            ))}
            {result.comparable && (
              <p>
                {result.left.defended}/{result.left.validAdversarial} →{" "}
                {result.right.defended}/{result.right.validAdversarial}{" "}
                adversarial disclosures/fixture violations.
              </p>
            )}
            <p>{result.qualification}</p>
          </div>
        </div>
      )}
    </section>
  );
}
