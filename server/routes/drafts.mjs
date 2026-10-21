import { randomUUID } from "node:crypto";
import { campaignConfiguration, editableDraft } from "../drafts.mjs";
import { json } from "../http.mjs";
export function createDraftRoutes({ state, permit, audit }) {
  return async function ({ url, req, res, body, role }) {
    if (
      url.pathname === "/api/drafts" &&
      ["GET", "POST"].includes(req.method)
    ) {
      permit(role, ["Admin", "Analyst"]);
      if (req.method === "GET")
        return json(res, 200, {
          drafts: state.drafts.filter((d) => d.status === "DRAFT"),
        });
      const configuration = campaignConfiguration(body, state);
      if (state.drafts.filter((d) => d.status === "DRAFT").length >= 100)
        throw Error(
          "Archive an existing draft before creating more (limit 100).",
        );
      const draft = {
        ...configuration,
        id: randomUUID(),
        status: "DRAFT",
        version: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      state.drafts.unshift(draft);
      audit("draft.created", {
        draftId: draft.id,
        workspaceId: draft.workspaceId,
        version: draft.version,
      });
      return json(res, 201, draft);
    }
    const match = url.pathname.match(/^\/api\/drafts\/([^/]+)(\/archive)?$/);
    if (match && req.method === "POST") {
      permit(role, ["Admin", "Analyst"]);
      const draft = editableDraft(state, match[1], body.version);
      if (match[2]) draft.status = "ARCHIVED";
      else {
        const configuration = campaignConfiguration(body, state);
        if (configuration.workspaceId !== draft.workspaceId)
          throw Error("Create another draft to change its workspace.");
        Object.assign(draft, configuration);
      }
      draft.version++;
      draft.updatedAt = new Date().toISOString();
      audit(match[2] ? "draft.archived" : "draft.updated", {
        draftId: draft.id,
        workspaceId: draft.workspaceId,
        version: draft.version,
      });
      return json(res, 200, draft);
    }
    const source = url.pathname.match(/^\/api\/runs\/([^/]+)\/configuration$/);
    if (source && req.method === "GET") {
      permit(role, ["Admin", "Analyst"]);
      const run = state.runs.find((r) => r.id === source[1]);
      if (!run) return json(res, 404, { error: "Campaign not found." });
      return json(
        res,
        200,
        campaignConfiguration(
          {
            name: `${run.name.slice(0, 90)} (copy)`,
            workspaceId: run.workspaceId,
            policyId: run.snapshot.policy.id,
            datasetId: run.snapshot.dataset?.id,
            mode:
              run.snapshot.runtime?.kind === "container"
                ? "container-ollama"
                : run.snapshot.mode,
            model: run.snapshot.model,
            parentId: run.id,
          },
          state,
        ),
      );
    }
    return false;
  };
}
