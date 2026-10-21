const escape = (value) =>
  String(value ?? "—").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const csvCell = (value) => {
  let text = String(value ?? "");
  if (/^[\s]*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
};

// Reports deliberately use a fixed allowlist; raw attempts and private rules never enter the renderer.
export function createReport(run, pack, verification) {
  const cases = pack.results.map((r) => ({
    id: r.id,
    category: r.category,
    benign: !!r.benign,
    baseline: r.baseline,
    defended: r.defended,
  }));
  const comparable = cases.filter(
    (r) =>
      !r.benign &&
      ["Safe", "No disclosure detected", "Violation"].includes(r.baseline) &&
      ["Safe", "No disclosure detected", "Violation"].includes(r.defended),
  );
  const baseline = comparable.filter((r) => r.baseline === "Violation").length;
  const defended = comparable.filter((r) => r.defended === "Violation").length;
  const rate = (n) =>
    comparable.length
      ? `${n}/${comparable.length} (${((100 * n) / comparable.length).toFixed(1)}%)`
      : "Unassessed: no comparable adversarial pairs";
  const signed = verification.trusted === true;
  const rows = cases.map((r) => [
    r.id,
    r.category,
    r.benign ? "Benign control" : "Adversarial",
    r.baseline,
    r.defended,
  ]);
  const columns = ["Case ID", "Category", "Case type", "Baseline", "Defended"];
  const csv =
    "\uFEFF" +
    [columns, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") +
    "\r\n";
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>Bayora report · ${escape(run.name)}</title>
<style>body{font:15px/1.6 system-ui,sans-serif;color:#18372e;background:#f3f7f5;margin:0}main{max-width:1000px;margin:40px auto;background:white;padding:40px;border:1px solid #dce6e0;border-radius:16px}header{border-bottom:2px solid #1b634d;padding-bottom:24px}h1{font-size:30px;margin:8px 0}h2{font-size:19px;margin-top:32px}.brand{font-weight:800;letter-spacing:2px;color:#1b634d}.muted{color:#586e65}.notice{background:#fff6dc;border-left:4px solid #c28b24;padding:16px}.metrics{display:flex;gap:24px;flex-wrap:wrap}.metric{flex:1;min-width:210px;padding:20px;background:#f1f7f3;border-radius:10px}.metric strong{display:block;font-size:20px}table{width:100%;border-collapse:collapse;text-align:left}th,td{padding:10px 12px;border-bottom:1px solid #dce6e0;vertical-align:top}th{background:#edf5f0}code{font-size:12px;overflow-wrap:anywhere}dt{font-weight:600}dd{margin:0 0 12px;overflow-wrap:anywhere}footer{margin-top:32px;font-size:12px;color:#586e65}@media(max-width:600px){main{margin:0;padding:20px;border-radius:0}.table-wrap{overflow:auto}h1{font-size:24px}}@media print{body{background:white;font-size:10pt}main{border:0;margin:0;padding:0;max-width:none}header,h2,.metric{break-inside:avoid}tr{break-inside:avoid}thead{display:table-header-group}a{color:inherit}.notice{background:white;border:1px solid #999}}</style></head><body><main>
<header><div class="brand">BAYORA / EVALUATION REPORT</div><h1>${escape(run.name)}</h1><div class="muted">${escape(run.id)} · ${escape(run.status)} · ${escape(run.createdAt)}</div></header>
<p class="notice"><strong>Environment verdict: ${escape(pack.verdict)}.</strong> ${pack.verdict === "DEMO_ONLY" ? "Synthetic fixtures demonstrate the workflow; these are not live safety results." : "Local model results do not establish independent runtime isolation or general model safety."} This human-readable report is derived from evidence and is not itself digitally signed. Verify the companion JSON with an independently supplied trusted key.</p>
<h2>Evaluation results</h2><div class="metrics"><div class="metric">Baseline disclosure rate<strong>${escape(rate(baseline))}</strong></div><div class="metric">Defended disclosure rate<strong>${escape(rate(defended))}</strong></div></div>
<p class="muted">Rates use completed, comparable adversarial pairs only. Benign controls, transport failures and inconclusive pairs are excluded. ${cases.length} recorded case pairs; ${(pack.attempts || []).filter((a) => a.status === "FAILED").length} transport errors. No calibrated general safety score is implied.</p>
<h2>Frozen configuration</h2><dl><dt>Model</dt><dd>${escape(pack.manifest.model)}</dd><dt>Dataset</dt><dd>${escape(pack.manifest.dataset?.name)} · v${escape(pack.manifest.dataset?.version)}</dd><dt>Policy</dt><dd>${escape(pack.manifest.policy.name)} · v${escape(pack.manifest.policy.version)}</dd><dt>Source campaign</dt><dd>${escape(run.parentId || "Original evaluation")}</dd></dl>
<h2>Evidence provenance</h2><dl><dt>Verification at report generation</dt><dd>${signed ? "Signature verified against the server's configured trusted public key" : "Hash consistency checked; no trusted signature established"}</dd><dt>Run event anchor</dt><dd><code>${escape(pack.anchor)}</code></dd><dt>Manifest hash</dt><dd><code>${escape(pack.manifestHash)}</code></dd><dt>Signer key ID</dt><dd><code>${escape(pack.attestation?.payload?.keyId || "Unsigned")}</code></dd><dt>Container cleanup</dt><dd>${escape(pack.runtimeReport?.cleanup?.status || "No per-run container resources")}</dd></dl>
<h2>Redacted case outcomes</h2><div class="table-wrap"><table><thead><tr>${columns.map((c) => `<th>${escape(c)}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${escape(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>
<footer>Generated ${escape(new Date().toISOString())}. Private prompts, policy rules, response bodies, review reasons and authentication credentials are excluded. Use your browser's Print → Save as PDF to produce a PDF copy. Keep the signed JSON alongside this report.</footer>
</main></body></html>`;
  return {
    html,
    csv,
    runId: run.id,
    verdict: pack.verdict,
    verification,
    qualification:
      "Derived redacted report; verify the companion evidence JSON independently.",
  };
}
