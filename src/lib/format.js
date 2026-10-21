export const running = (s) =>
  [
    "VALIDATING",
    "QUEUED",
    "PROVISIONING",
    "RUNNING",
    "EVALUATING",
    "FINALIZING",
  ].includes(s);
export const date = (s) =>
  new Date(s).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
