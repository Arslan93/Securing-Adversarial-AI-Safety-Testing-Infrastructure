export function ActivityChart({ runs, period, live = false }) {
  const days = Number.parseInt(period);
  const cutoff = Date.now() - days * 86400000;
  const recent = runs
    .filter((r) => new Date(r.createdAt).getTime() >= cutoff)
    .slice(0, 7)
    .reverse();
  const x = (i) => 56 + i * (500 / Math.max(recent.length - 1, 1));
  const y = (n, total = 16) => 180 - (n / (total || 1)) * 150;
  return (
    <div className="chart">
      <svg
        viewBox="0 0 600 230"
        role="img"
        aria-label={
          recent.length
            ? live
              ? "Baseline and defended canary disclosure for recent live local runs"
              : "Baseline and defended violation rates for recent synthetic fixtures"
            : "No completed evaluations yet"
        }
      >
        {[0, 25, 50, 75, 100].map((v, i) => (
          <g key={v}>
            <line
              x1="53"
              y1={180 - i * 37.5}
              x2="575"
              y2={180 - i * 37.5}
              stroke="#edf0f2"
            />
            <text x="39" y={184 - i * 37.5} textAnchor="end">
              {v}%
            </text>
          </g>
        ))}
        {recent.length > 0 ? (
          <>
            {["baseline", "defended"].map((field, j) => {
              const points = recent
                .map(
                  (r, i) =>
                    `${x(i)},${y(r[field], r.validAdversarial ?? r.adversarialTotal ?? 16)}`,
                )
                .join(" ");
              return (
                <g key={field}>
                  {recent.length > 1 && (
                    <polygon
                      points={`56,180 ${points} ${x(recent.length - 1)},180`}
                      fill={j ? "#dceee4" : "#e9ecef"}
                      opacity=".65"
                    />
                  )}
                  <polyline
                    points={points}
                    fill="none"
                    stroke={j ? "#18744d" : "#98a1aa"}
                    strokeWidth="2"
                  />
                  {recent.map((r, i) => (
                    <circle
                      key={r.id}
                      cx={x(i)}
                      cy={y(
                        r[field],
                        r.validAdversarial ?? r.adversarialTotal ?? 16,
                      )}
                      r="4"
                      fill={j ? "#18744d" : "#98a1aa"}
                    />
                  ))}
                </g>
              );
            })}
            {recent.map((r, i) => (
              <text key={r.id} x={x(i)} y="204" textAnchor="middle">
                Run {i + 1}
              </text>
            ))}
          </>
        ) : (
          <>
            <text className="chart-empty" x="315" y="100" textAnchor="middle">
              Your first evaluation starts here
            </text>
            <text x="315" y="123" textAnchor="middle">
              Complete a campaign to compare outcomes
            </text>
          </>
        )}
      </svg>
      <div className="legend">
        <span>
          <i className="baseline-dot" />
          Baseline (base instructions)
        </span>
        <span>
          <i className="defended-dot" />
          Defended (policy enabled)
        </span>
      </div>
    </div>
  );
}
