import { inspectAcceptance } from "./pilot-acceptance.mjs";
export function checkExecutionPolicy({ config, pilot, orgId, mode, model }) {
  if (pilot.control(orgId).paused)
    throw Object.assign(
      Error("Evaluation launches are paused by your organization operator."),
      { status: 423 },
    );
  if (config.pilotMode) {
    if (
      config.pilotAcceptanceFile &&
      !inspectAcceptance(config.pilotAcceptanceFile, config.publicOrigin).ready
    )
      throw Object.assign(
        Error("Pilot acceptance review is no longer current."),
        { status: 503 },
      );
    if (mode !== "container-ollama")
      throw Object.assign(
        Error("Restricted pilot requires the approved container adapter."),
        { status: 403 },
      );
    if (model && !pilot.approved(orgId, model.id, model.digest))
      throw Object.assign(
        Error(
          "This exact model revision needs administrator approval before execution.",
        ),
        { status: 403 },
      );
  }
}
