import { randomUUID } from "node:crypto";
import {
  publishDataset,
  datasetMetadata,
  SEED_DATASET_ID,
} from "../datasets.mjs";
import { compareRuns } from "../comparison.mjs";
import { json } from "../http.mjs";
export function createDatasetRoutes({ state, audit, permit, access }) {
  return async ({ url, req, res, body, role }) => {
    if (url.pathname === "/api/datasets" && req.method === "POST") {
      permit(role, ["Admin", "Red"]);
      if (
        Object.keys(body).some(
          (k) => !["name", "workspaceId", "cases", "baseDatasetId"].includes(k),
        )
      )
        throw Error("Unsupported dataset fields.");
      if (body.baseDatasetId)
        access.requireRaw(
          state.datasets.find((d) => d.id === body.baseDatasetId),
        );
      const dataset = publishDataset(state, body);
      state.datasets.push(dataset);
      audit("dataset.published", {
        datasetId: dataset.id,
        version: dataset.version,
        digest: dataset.digest,
      });
      return json(res, 201, datasetMetadata(dataset));
    }
    if (url.pathname === "/api/cases" && req.method === "POST") {
      permit(role, ["Admin", "Red"]);
      const base = state.datasets.find(
        (d) => d.id === (body.datasetId || state.datasets[0]?.id),
      );
      if (!base) throw Error("Base dataset not found.");
      access.requireRaw(base);
      const test = { ...body.test, id: randomUUID() };
      const dataset = publishDataset(state, {
        name: body.datasetName || base.name,
        workspaceId: body.workspaceId,
        cases: [...base.cases, test],
        baseDatasetId: base.id,
      });
      state.datasets.push(dataset);
      audit("dataset.published", {
        datasetId: dataset.id,
        version: dataset.version,
        digest: dataset.digest,
      });
      return json(res, 201, datasetMetadata(dataset));
    }
    const match = url.pathname.match(/^\/api\/datasets\/([^/]+)$/);
    if (match && req.method === "GET") {
      permit(role, ["Admin", "Red"]);
      const dataset = state.datasets.find((d) => d.id === match[1]);
      if (dataset) access.requireRaw(dataset);
      return dataset
        ? json(res, 200, dataset)
        : json(res, 404, { error: "Dataset not found" });
    }
    if (url.pathname === "/api/compare" && req.method === "GET") {
      const a = state.runs.find((r) => r.id === url.searchParams.get("left")),
        b = state.runs.find((r) => r.id === url.searchParams.get("right"));
      if (!a || !b)
        return json(res, 404, { error: "Select two existing runs." });
      return json(res, 200, compareRuns(a, b));
    }
    return false;
  };
}
