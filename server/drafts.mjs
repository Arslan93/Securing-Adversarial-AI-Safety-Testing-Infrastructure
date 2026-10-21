export function campaignConfiguration(body, state) {
  if (
    typeof body.name !== "string" ||
    !body.name.trim() ||
    body.name.length > 100
  )
    throw Error("Campaign name must contain 1–100 characters.");
  const workspace = state.workspaces.find((w) => w.id === body.workspaceId);
  const policy = state.policies.find((p) => p.id === body.policyId);
  const dataset = state.datasets.find((d) => d.id === body.datasetId);
  if (
    !workspace ||
    workspace.retired ||
    !policy ||
    !dataset ||
    (policy.workspaceId && policy.workspaceId !== workspace.id) ||
    (dataset.workspaceId && dataset.workspaceId !== workspace.id)
  )
    throw Error("Select an available workspace, policy and dataset.");
  const mode = body.mode || "synthetic-demo";
  if (!["synthetic-demo", "ollama", "container-ollama"].includes(mode))
    throw Error("Unsupported model adapter.");
  if (
    mode !== "synthetic-demo" &&
    (typeof body.model !== "string" ||
      !body.model.trim() ||
      body.model.length > 200)
  )
    throw Error("Choose a model before saving this draft.");
  if (
    body.parentId &&
    !state.runs.some(
      (r) => r.id === body.parentId && r.workspaceId === workspace.id,
    )
  )
    throw Error("Source campaign is unavailable in this workspace.");
  return {
    name: body.name.trim(),
    workspaceId: workspace.id,
    policyId: policy.id,
    datasetId: dataset.id,
    mode,
    model: mode === "synthetic-demo" ? null : body.model.trim(),
    parentId: body.parentId || null,
  };
}

export function editableDraft(state, id, version) {
  const draft = state.drafts.find((d) => d.id === id && d.status === "DRAFT");
  if (!draft)
    throw Object.assign(Error("Editable draft not found."), { status: 404 });
  if (!Number.isInteger(version) || version !== draft.version)
    throw Object.assign(
      Error("This draft changed. Refresh and reopen the latest version."),
      { status: 409 },
    );
  return draft;
}
