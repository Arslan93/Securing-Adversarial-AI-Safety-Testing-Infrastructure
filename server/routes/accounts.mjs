import { randomBytes, randomUUID } from "node:crypto";
import { json } from "../http.mjs";
import { seedDataset } from "../datasets.mjs";
import {
  ROLES,
  credentials,
  hashPassword,
  checkPassword,
} from "../identity.mjs";
export function createAccountRoutes({
  identity,
  access,
  allState,
  save,
  audit,
  permit,
  issue,
  logout,
  boundedHash,
  revalidate,
  publicUser,
}) {
  return async function accountRoutes({ url, req, res, body, current }) {
    if (url.pathname === "/api/organizations" && req.method === "GET")
      return json(res, 200, { organizations: identity.orgs(current.userId) });
    if (url.pathname === "/api/organizations" && req.method === "POST") {
      if (
        typeof body.name !== "string" ||
        !body.name.trim() ||
        body.name.length > 80
      )
        throw Error("Organization name is required (up to 80 characters).");
      const org = identity.addOrg(body.name);
      identity.setMembership(current.userId, org.id, "Admin", []);
      const ws = {
        id: randomUUID(),
        orgId: org.id,
        name: "Research workspace",
        ttl: 30,
        purpose: "Controlled synthetic evaluation",
        classification: "Synthetic",
        network: "Deny all egress",
      };
      allState.workspaces.push(ws);
      allState.policies.push({
        id: randomUUID(),
        orgId: org.id,
        workspaceId: ws.id,
        name: "Default safety policy",
        version: 1,
        rules: ["Protect private context"],
        createdAt: new Date().toISOString(),
      });
      allState.datasets.push({
        ...seedDataset(),
        id: randomUUID(),
        orgId: org.id,
        workspaceId: ws.id,
      });
      save();
      return json(res, 201, org);
    }
    if (url.pathname === "/api/organizations/switch" && req.method === "POST") {
      if (!identity.membership(current.userId, body.organizationId))
        return json(res, 404, { error: "Organization unavailable." });
      identity.deleteSession(current.token);
      return issue(res, identity.user(current.userId), body.organizationId);
    }
    if (url.pathname === "/api/account/password" && req.method === "POST") {
      const input = credentials({
        email: current.user.email,
        password: body.password,
      });
      if (
        typeof body.currentPassword !== "string" ||
        body.currentPassword.length > 128 ||
        !(await boundedHash(() =>
          checkPassword(
            body.currentPassword,
            identity.user(current.userId).password,
          ),
        ))
      )
        return json(res, 403, { error: "Current password is incorrect." });
      identity.changePassword(
        current.userId,
        await boundedHash(() => hashPassword(input.password)),
      );
      audit("account.password.changed", { userId: current.userId });
      return logout(res, current);
    }
    if (url.pathname === "/api/members" && req.method === "GET") {
      permit(current.role, ["Admin"]);
      return json(res, 200, { members: identity.members(current.orgId) });
    }
    if (url.pathname === "/api/members" && req.method === "POST") {
      permit(current.role, ["Admin"]);
      const input = credentials(body);
      if (
        !ROLES.includes(body.role) ||
        !Array.isArray(body.workspaces) ||
        body.workspaces.some(
          (id) =>
            !allState.workspaces.some(
              (w) => w.id === id && w.orgId === current.orgId,
            ),
        )
      )
        throw Error("Select a valid role and workspace memberships.");
      if (identity.byEmail(input.email))
        return json(res, 409, {
          error:
            "An account already uses that email. Use its existing organization administrator to manage access.",
        });
      const hash = await boundedHash(() => hashPassword(input.password));
      if (identity.byEmail(input.email))
        return json(res, 409, { error: "An account already uses that email." });
      // Re-check the administrator after asynchronous password derivation.
      if (identity.membership(current.userId, current.orgId)?.role !== "Admin")
        return json(res, 403, {
          error: "Administrator membership was revoked.",
        });
      revalidate(current);
      const user = identity.addUser({ ...input, name: body.name }, hash);
      identity.setMembership(
        user.id,
        current.orgId,
        body.role,
        body.workspaces,
      );
      audit("membership.created", {
        userId: user.id,
        role: body.role,
        workspaces: body.workspaces,
      });
      return json(res, 201, publicUser(user));
    }
    const member = url.pathname.match(/^\/api\/members\/([^/]+)$/);
    if (member && req.method === "POST") {
      permit(current.role, ["Admin"]);
      const previous = identity.membership(member[1], current.orgId);
      if (!previous) return json(res, 404, { error: "Member not found." });
      if (
        !ROLES.includes(body.role) ||
        !Array.isArray(body.workspaces) ||
        body.workspaces.some(
          (id) =>
            !allState.workspaces.some(
              (w) => w.id === id && w.orgId === current.orgId,
            ),
        )
      )
        throw Error("Select a valid role and workspaces.");
      if (
        previous.role === "Admin" &&
        body.role !== "Admin" &&
        identity.members(current.orgId).filter((m) => m.role === "Admin")
          .length === 1
      )
        throw Error("Keep at least one organization administrator.");
      identity.setMembership(
        member[1],
        current.orgId,
        body.role,
        body.workspaces,
      );
      identity.revoke(member[1]);
      audit("membership.changed", {
        userId: member[1],
        role: body.role,
        workspaces: body.workspaces,
      });
      return json(res, 200, { ok: true });
    }
    if (url.pathname === "/api/grants" && req.method === "GET")
      return json(res, 200, {
        grants: allState.grants.filter(
          (g) =>
            g.orgId === current.orgId &&
            (current.role === "Admin" ||
              g.ownerId === current.userId ||
              g.userId === current.userId),
        ),
      });
    if (url.pathname === "/api/grants" && req.method === "POST") {
      const resource = [...allState.datasets, ...allState.policies].find(
        (e) => e.id === body.resourceId && e.orgId === current.orgId,
      );
      if (
        !resource ||
        !access.workspaceAllowed(current, resource.workspaceId) ||
        (current.role !== "Admin" && resource.ownerId !== current.userId)
      )
        return json(res, 404, { error: "Artifact unavailable." });
      const target = identity.membership(body.userId, current.orgId);
      if (
        !target ||
        (resource.workspaceId &&
          target.role !== "Admin" &&
          !target.workspaces.includes(resource.workspaceId))
      )
        throw Error("Recipient needs membership in this artifact workspace.");
      if (
        !Number.isInteger(body.minutes) ||
        body.minutes < 1 ||
        body.minutes > 1440
      )
        throw Error("Grant duration must be 1–1440 minutes.");
      const grant = {
        id: randomBytes(16).toString("hex"),
        orgId: current.orgId,
        resourceId: resource.id,
        ownerId: resource.ownerId,
        userId: body.userId,
        expires: Date.now() + body.minutes * 60000,
        approvedBy: current.userId,
      };
      allState.grants.push(grant);
      audit("artifact.granted", {
        grantId: grant.id,
        resourceId: resource.id,
        userId: grant.userId,
        expires: grant.expires,
      });
      return json(res, 201, grant);
    }
    const grant = url.pathname.match(/^\/api\/grants\/([^/]+)\/revoke$/);
    if (grant && req.method === "POST") {
      const value = allState.grants.find(
        (g) =>
          g.id === grant[1] &&
          g.orgId === current.orgId &&
          (current.role === "Admin" || g.ownerId === current.userId),
      );
      if (!value) return json(res, 404, { error: "Grant unavailable." });
      value.revoked = true;
      audit("artifact.grant.revoked", { grantId: value.id });
      return json(res, 200, { ok: true });
    }
    return false;
  };
}
