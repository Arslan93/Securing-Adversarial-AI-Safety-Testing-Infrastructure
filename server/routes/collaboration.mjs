import { randomBytes, randomUUID } from "node:crypto";
import { fingerprint, ROLES, credentials, hashPassword } from "../identity.mjs";
import { json } from "../http.mjs";
export function createCollaborationRoutes({
  state,
  allState,
  identity,
  access,
  permit,
  audit,
  save,
}) {
  allState.accessRequests ??= [];
  return async ({ url, req, res, body, current, role }) => {
    if (url.pathname === "/api/invitations" && req.method === "GET") {
      permit(role, ["Admin"]);
      return json(res, 200, {
        invitations: identity.security.invitations(current.orgId),
      });
    }
    if (url.pathname === "/api/invitations" && req.method === "POST") {
      permit(role, ["Admin"]);
      const email = String(body.email || "")
        .trim()
        .toLowerCase();
      if (
        !/^[^\s@]{1,100}@[^\s@]{1,100}\.[^\s@]{1,50}$/.test(email) ||
        !ROLES.includes(body.role) ||
        !Array.isArray(body.workspaces) ||
        body.workspaces.some(
          (id) => !state.workspaces.some((w) => w.id === id),
        ) ||
        !Number.isInteger(body.hours) ||
        body.hours < 1 ||
        body.hours > 168
      )
        throw Error(
          "Use a valid email, role, workspace selection and expiry of 1–168 hours.",
        );
      const token = randomBytes(32).toString("hex"),
        invite = {
          id: randomUUID(),
          hash: fingerprint(token),
          orgId: current.orgId,
          email,
          role: body.role,
          workspaces: body.workspaces,
          expires: Date.now() + body.hours * 3600000,
          createdBy: current.userId,
        };
      identity.security.invite(invite);
      audit("invitation.created", {
        invitationId: invite.id,
        role: body.role,
        expires: invite.expires,
      });
      return json(res, 201, { id: invite.id, token, expires: invite.expires });
    }
    if (url.pathname === "/api/invitations/accept" && req.method === "POST") {
      if (typeof body.token !== "string" || body.token.length !== 64)
        throw Error("Invitation token is invalid.");
      const invite = identity.security.invitation(fingerprint(body.token));
      if (
        !invite ||
        invite.email !== current.user.email ||
        identity.membership(invite.created_by, invite.org_id)?.role !== "Admin"
      )
        return json(res, 404, {
          error:
            "Invitation is expired, consumed, or belongs to a different account.",
        });
      if (identity.membership(current.userId, invite.org_id))
        throw Error(
          "You already belong to this organization. Ask its administrator to update your membership.",
        );
      const spaces = JSON.parse(invite.workspaces);
      if (
        spaces.some(
          (id) =>
            !allState.workspaces.some(
              (w) => w.id === id && w.orgId === invite.org_id,
            ),
        )
      )
        throw Error("Invitation workspace is no longer available.");
      identity.transaction(() => {
        if (!identity.security.consumeInvite(invite.id))
          throw Error("Invitation was already used.");
        identity.setMembership(
          current.userId,
          invite.org_id,
          invite.role,
          spaces,
        );
      });
      access.enter(
        {
          ...current,
          orgId: invite.org_id,
          membership: identity.membership(current.userId, invite.org_id),
        },
        () =>
          audit("invitation.accepted", {
            invitationId: invite.id,
            userId: current.userId,
          }),
      );
      return json(res, 200, {
        ok: true,
        organization: identity.org(invite.org_id),
      });
    }
    const revoke = url.pathname.match(/^\/api\/invitations\/([^/]+)\/revoke$/);
    if (revoke && req.method === "POST") {
      permit(role, ["Admin"]);
      identity.security.revokeInvite(revoke[1], current.orgId);
      audit("invitation.revoked", { invitationId: revoke[1] });
      return json(res, 200, { ok: true });
    }
    if (url.pathname === "/api/access-requests" && req.method === "GET") {
      return json(res, 200, {
        requests: allState.accessRequests.filter(
          (r) =>
            r.orgId === current.orgId &&
            (!r.workspaceId ||
              access.workspaceAllowed(current, r.workspaceId)) &&
            (role === "Admin" ||
              r.userId === current.userId ||
              [...state.datasets, ...state.policies].some(
                (a) => a.id === r.resourceId && a.ownerId === current.userId,
              )),
        ),
      });
    }
    if (url.pathname === "/api/access-requests" && req.method === "POST") {
      const resource = [...state.datasets, ...state.policies].find(
        (a) => a.id === body.resourceId,
      );
      if (!resource) return json(res, 404, { error: "Artifact unavailable." });
      const dataset = state.datasets.some((a) => a.id === resource.id);
      permit(
        role,
        dataset ? ["Admin", "Red", "Analyst"] : ["Admin", "Blue", "Analyst"],
      );
      if (
        typeof body.reason !== "string" ||
        body.reason.trim().length < 5 ||
        body.reason.length > 1000
      )
        throw Error("Provide an access reason of 5–1000 characters.");
      if (
        allState.accessRequests.some(
          (r) =>
            r.resourceId === resource.id &&
            r.userId === current.userId &&
            r.status === "PENDING",
        )
      )
        throw Error("You already have a pending request for this artifact.");
      const request = {
        id: randomUUID(),
        orgId: current.orgId,
        workspaceId: resource.workspaceId,
        userId: current.userId,
        resourceId: resource.id,
        reason: body.reason.trim(),
        status: "PENDING",
        createdAt: new Date().toISOString(),
      };
      allState.accessRequests.push(request);
      audit("access.requested", {
        requestId: request.id,
        resourceId: resource.id,
        userId: current.userId,
      });
      return json(res, 201, request);
    }
    const decision = url.pathname.match(
      /^\/api\/access-requests\/([^/]+)\/decide$/,
    );
    if (decision && req.method === "POST") {
      const request = allState.accessRequests.find(
          (r) => r.id === decision[1] && r.orgId === current.orgId,
        ),
        resource =
          request &&
          [...state.datasets, ...state.policies].find(
            (a) => a.id === request.resourceId,
          );
      if (
        !request ||
        !resource ||
        (role !== "Admin" && resource.ownerId !== current.userId)
      )
        return json(res, 404, { error: "Request unavailable." });
      if (request.status !== "PENDING")
        throw Error("This request has already been decided.");
      if (
        !["APPROVE", "DENY"].includes(body.decision) ||
        typeof body.reason !== "string" ||
        body.reason.trim().length < 5 ||
        body.reason.length > 1000
      )
        throw Error("A decision and reason of 5–1000 characters are required.");
      if (body.decision === "APPROVE") {
        if (
          !Number.isInteger(body.minutes) ||
          body.minutes < 1 ||
          body.minutes > 1440
        )
          throw Error("Approval duration must be 1–1440 minutes.");
        const target = identity.membership(request.userId, current.orgId);
        if (
          !target ||
          (resource.workspaceId &&
            target.role !== "Admin" &&
            !target.workspaces.includes(resource.workspaceId))
        )
          throw Error("Recipient no longer has workspace membership.");
        const grant = {
          id: randomUUID(),
          orgId: current.orgId,
          resourceId: resource.id,
          ownerId: resource.ownerId,
          userId: request.userId,
          expires: Date.now() + body.minutes * 60000,
          approvedBy: current.userId,
        };
        allState.grants.push(grant);
        request.grantId = grant.id;
      }
      Object.assign(request, {
        status: body.decision === "APPROVE" ? "APPROVED" : "DENIED",
        decisionBy: current.userId,
        decisionReason: body.reason.trim(),
        decidedAt: new Date().toISOString(),
      });
      audit("access.decided", {
        requestId: request.id,
        status: request.status,
        grantId: request.grantId || null,
      });
      return json(res, 200, request);
    }
    return false;
  };
}
