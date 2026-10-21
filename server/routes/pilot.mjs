import { json } from "../http.mjs";
import { digest } from "../core.mjs";
import { planRetention, applyRetention } from "../retention.mjs";
export function createPilotRoutes({
  state,
  allState,
  pilot,
  queue,
  permit,
  audit,
  config,
}) {
  return async ({ url, req, res, body, role, current }) => {
    if (!url.pathname.startsWith("/api/pilot")) return false;
    permit(role, ["Admin"]);
    const reason = () => {
      if (
        typeof body.reason !== "string" ||
        body.reason.trim().length < 10 ||
        body.reason.length > 1000
      )
        throw Error("Provide an operator reason of 10–1000 characters.");
      return body.reason.trim();
    };
    if (url.pathname === "/api/pilot/status" && req.method === "GET")
      return json(res, 200, {
        enabled: !!config.pilotMode,
        control: pilot.control(current.orgId),
        approvals: pilot.approvals(current.orgId),
        workspaces: state.workspaces.map((w) => ({
          id: w.id,
          name: w.name,
          retired: !!w.retired,
          hold: !!pilot.hold(current.orgId, w.id)?.held,
        })),
        qualifications: [
          "Local operator controls; external deployment/review are separate acceptance gates.",
          "Private content removal retains verifiable public metadata and separately managed backups.",
        ],
      });
    if (url.pathname === "/api/pilot/approvals" && req.method === "POST") {
      const explanation = reason();
      if (
        typeof body.model !== "string" ||
        !/^[a-zA-Z0-9][a-zA-Z0-9_.:/-]{0,120}$/.test(body.model) ||
        body.model.includes(":cloud") ||
        typeof body.digest !== "string" ||
        !/^(sha256:)?[a-f0-9]{64}$/.test(body.digest)
      )
        throw Error(
          "A local model name and full SHA-256 revision are required.",
        );
      const id = pilot.approve(
        current.orgId,
        body.model,
        body.digest,
        explanation,
        current.userId,
      );
      audit("model.approved", {
        approvalId: id,
        model: body.model,
        modelDigest: body.digest,
        reasonHash: digest(explanation),
      });
      return json(res, 201, { id });
    }
    const revoke = url.pathname.match(
      /^\/api\/pilot\/approvals\/([^/]+)\/revoke$/,
    );
    if (revoke && req.method === "POST") {
      const explanation = reason();
      if (!pilot.revoke(current.orgId, revoke[1]))
        return json(res, 404, { error: "Approval not found." });
      audit("model.approval.revoked", {
        approvalId: revoke[1],
        reasonHash: digest(explanation),
      });
      return json(res, 200, { revoked: true });
    }
    if (url.pathname === "/api/pilot/containment" && req.method === "POST") {
      const explanation = reason();
      if (typeof body.paused !== "boolean")
        throw Error("Choose pause or resume.");
      pilot.pause(current.orgId, body.paused, explanation, current.userId);
      audit(body.paused ? "incident.contained" : "incident.resumed", {
        reasonHash: digest(explanation),
      });
      return json(res, 200, pilot.control(current.orgId));
    }
    if (url.pathname === "/api/pilot/retention-hold" && req.method === "POST") {
      const explanation = reason();
      if (!state.workspaces.some((w) => w.id === body.workspaceId))
        return json(res, 404, { error: "Workspace not found." });
      if (typeof body.held !== "boolean")
        throw Error("Choose hold or release.");
      pilot.setHold(current.orgId, body.workspaceId, body.held, explanation);
      audit("retention.hold.changed", {
        workspaceId: body.workspaceId,
        held: body.held,
        reasonHash: digest(explanation),
      });
      return json(res, 200, { held: body.held });
    }
    if (url.pathname === "/api/pilot/retention/plan" && req.method === "POST") {
      const plan = planRetention({
        state: allState,
        pilot,
        queue,
        orgId: current.orgId,
        userId: current.userId,
        workspaceId: body.workspaceId,
      });
      audit("retention.planned", {
        workspaceId: plan.workspaceId,
        planId: plan.id,
      });
      return json(res, 201, plan);
    }
    if (
      url.pathname === "/api/pilot/retention/apply" &&
      req.method === "POST"
    ) {
      const explanation = reason(),
        result = applyRetention({
          state: allState,
          pilot,
          queue,
          orgId: current.orgId,
          userId: current.userId,
          planId: body.planId,
          confirmation: body.confirmation,
        });
      audit("retention.applied", {
        workspaceId: result.workspaceId,
        counts: result.counts,
        reasonHash: digest(explanation),
      });
      return json(res, 200, result);
    }
    return json(res, 404, { error: "Pilot endpoint not found." });
  };
}
