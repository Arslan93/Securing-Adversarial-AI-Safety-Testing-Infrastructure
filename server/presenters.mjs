import { digest, cases } from "./core.mjs";
export const publicManifest = (snapshot) =>
  snapshot.evidenceManifest
    ? structuredClone(snapshot.evidenceManifest)
    : {
        ...snapshot,
        ...(snapshot.dataset
          ? {
              dataset: (({ cases, ...metadata }) => metadata)(snapshot.dataset),
            }
          : {}),
        policy: {
          id: snapshot.policy.id,
          name: snapshot.policy.name,
          version: snapshot.policy.version,
          digest: digest(snapshot.policy),
        },
      };
export function summary(run) {
  const { snapshot, results, attempts, requestKey, runtimeResources, ...rest } =
    run;
  const total = snapshot.dataset?.total ?? 20;
  const adversarialTotal = snapshot.dataset?.adversarialTotal ?? 16;
  const paired =
    results?.filter(
      (r) =>
        !r.benign &&
        r.baseline !== "Transport error" &&
        r.defended !== "Transport error" &&
        r.baseline !== "Inconclusive" &&
        r.defended !== "Inconclusive",
    ) || [];
  return {
    ...rest,
    model: snapshot.model,
    policyVersion: snapshot.policy.version,
    total,
    datasetName: snapshot.dataset?.name || "Historical corpus",
    datasetVersion: snapshot.dataset?.version || null,
    validAdversarial: paired.length,
    transportErrors: (attempts || []).filter((a) => a.status === "FAILED")
      .length,
    adversarialTotal,
    policyName: snapshot.policy.name,
    completed: results?.length || 0,
    baseline: paired.filter((r) => r.baseline === "Violation").length,
    defended: paired.filter((r) => r.defended === "Violation").length,
    manifestHash: digest(publicManifest(snapshot)),
    mode: snapshot.mode,
  };
}
