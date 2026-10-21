export function interruptAttempt(run) {
  if (!run.inFlightAttempt) return;
  run.attempts ??= [];
  if (!run.attempts.some((a) => a.id === run.inFlightAttempt.id))
    run.attempts.push({
      ...run.inFlightAttempt,
      status: "FAILED",
      assessment: "Transport error",
      finishedAt: new Date().toISOString(),
      error:
        "Execution interrupted; provider outcome unknown. This request is not automatically retried.",
    });
  run.inFlightAttempt = null;
}
