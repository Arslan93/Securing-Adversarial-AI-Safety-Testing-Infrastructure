import { AsyncLocalStorage } from "node:async_hooks";
export function createAccess(state, save) {
  const context = new AsyncLocalStorage();
  state.grants ??= [];
  state.drafts ??= [];
  const fail = () => {
    throw Object.assign(
      Error("Resource not found or unavailable to your account."),
      { status: 404 },
    );
  };
  const current = () => context.getStore();
  const workspaceAllowed = (subject, id) =>
    subject.membership.role === "Admin" ||
    subject.membership.workspaces.includes(id);
  function visible(kind, value, subject) {
    if (!subject) return true;
    if (kind === "reviews")
      return state.runs.some(
        (r) => r.id === value.runId && visible("runs", r, subject),
      );
    if (value.orgId !== subject.orgId) return false;
    if (
      kind === "drafts" &&
      subject.membership.role !== "Admin" &&
      value.ownerId !== subject.userId
    )
      return false;
    if (kind === "workspaces") return workspaceAllowed(subject, value.id);
    return value.workspaceId
      ? workspaceAllowed(subject, value.workspaceId)
      : state.workspaces.some(
          (w) => w.orgId === subject.orgId && workspaceAllowed(subject, w.id),
        );
  }
  const scoped = new Proxy(state, {
    get(target, key) {
      const subject = current();
      if (
        !subject ||
        ![
          "workspaces",
          "policies",
          "datasets",
          "runs",
          "reviews",
          "drafts",
        ].includes(key)
      )
        return target[key];
      const list = target[key].filter((v) => visible(key, v, subject));
      for (const method of ["push", "unshift"])
        Object.defineProperty(list, method, {
          value: (...items) => {
            for (const item of items) {
              item.orgId = subject.orgId;
              item.ownerId = subject.userId;
              if (key === "policies") item.workspaceId ??= subject.workspaceId;
            }
            return target[key][method](...items);
          },
        });
      return list;
    },
  });
  function raw(entity) {
    const s = current();
    if (!entity || !visible("datasets", entity, s)) fail();
    if (
      !entity.ownerId ||
      entity.ownerId === s.userId ||
      state.grants.some(
        (g) =>
          g.orgId === s.orgId &&
          g.resourceId === entity.id &&
          g.userId === s.userId &&
          !g.revoked &&
          g.expires > Date.now(),
      )
    )
      return true;
    return false;
  }
  function requireRaw(entity) {
    if (!raw(entity))
      throw Object.assign(
        Error(
          "Private artifact: ask its owner or an administrator for a time-limited grant.",
        ),
        { status: 403 },
      );
  }
  return {
    context,
    current,
    state: scoped,
    visible,
    raw,
    requireRaw,
    fail,
    enter: (subject, fn) => context.run(subject, fn),
    workspaceAllowed,
    assertWorkspace: (id) => {
      const s = current();
      if (
        !state.workspaces.some(
          (w) => w.id === id && visible("workspaces", w, s),
        )
      )
        fail();
    },
    stampLegacy: (orgId, userId) => {
      for (const kind of [
        "workspaces",
        "policies",
        "datasets",
        "runs",
        "reviews",
      ])
        for (const value of state[kind]) {
          value.orgId ??= orgId;
          if (!(
            (kind === "datasets" &&
              value.id === "dataset-bayora-distinct-v2") ||
            (kind === "policies" && value.id === "pol-1") ||
            kind === "workspaces"
          ))
            value.ownerId ??= userId;
        }
      save();
    },
  };
}
