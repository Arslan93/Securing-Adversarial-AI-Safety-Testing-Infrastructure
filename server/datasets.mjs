import { randomUUID } from "node:crypto";
import { cases, digest } from "./core.mjs";
export const SEED_DATASET_ID = "dataset-bayora-distinct-v2";
export function datasetMetadata({ cases, ...dataset }) {
  return {
    ...dataset,
    total: cases.length,
    adversarialTotal: cases.filter((c) => !c.benign).length,
  };
}
export function seedDataset() {
  return {
    id: SEED_DATASET_ID,
    familyId: SEED_DATASET_ID,
    name: "Bayora distinct synthetic corpus",
    version: 1,
    workspaceId: null,
    cases: structuredClone(cases),
    digest: digest(cases),
    createdAt: new Date().toISOString(),
  };
}
const categories = new Set([
  "Prompt injection",
  "Data privacy",
  "Role spoofing",
  "Obfuscation",
  "Benign control",
]);
export function validateCase(value, index = 0) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error("Each test case must be an object.");
  const allowed = [
    "id",
    "name",
    "category",
    "prompt",
    "benign",
    "expectedContains",
  ];
  if (Object.keys(value).some((k) => !allowed.includes(k)))
    throw Error(
      "Unsupported test fields. Only bounded prompt text and labels are accepted.",
    );
  if (
    typeof value.name !== "string" ||
    !value.name.trim() ||
    value.name.length > 100 ||
    typeof value.prompt !== "string" ||
    !value.prompt.trim() ||
    value.prompt.length > 2000 ||
    !categories.has(value.category) ||
    typeof value.benign !== "boolean"
  )
    throw Error(
      "Case requires name (1–100), prompt (1–2000), an allowed category and a boolean benign label.",
    );
  if (value.benign !== (value.category === "Benign control"))
    throw Error("Benign labels must match the Benign control category.");
  if (
    value.expectedContains !== undefined &&
    (typeof value.expectedContains !== "string" ||
      !value.expectedContains.trim() ||
      value.expectedContains.length > 120 ||
      !value.benign)
  )
    throw Error("Expected text must be a bounded benign-control string.");
  const id = value.id || `CASE-${index + 1}`;
  if (typeof id !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(id))
    throw Error("Invalid case identifier.");
  return {
    id,
    name: value.name.trim(),
    category: value.category,
    prompt: value.prompt.trim(),
    benign: value.benign,
    ...(value.expectedContains
      ? { expectedContains: value.expectedContains.trim() }
      : {}),
  };
}
export function publishDataset(
  state,
  { name, workspaceId, cases: input, baseDatasetId },
) {
  if (
    typeof name !== "string" ||
    !name.trim() ||
    name.length > 100 ||
    !state.workspaces.some((w) => w.id === workspaceId && !w.retired)
  )
    throw Error("A dataset name and valid workspace are required.");
  if (!Array.isArray(input) || input.length < 1 || input.length > 100)
    throw Error("Dataset must contain 1–100 prompt-only cases.");
  const validated = input.map(validateCase);
  if (new Set(validated.map((c) => c.id)).size !== validated.length)
    throw Error("Case IDs must be unique within a dataset.");
  const base = baseDatasetId
    ? state.datasets.find((d) => d.id === baseDatasetId)
    : null;
  if (baseDatasetId && !base) throw Error("Base dataset not found.");
  if (base?.workspaceId && base.workspaceId !== workspaceId)
    throw Error("Dataset belongs to another workspace.");
  const familyId = base?.workspaceId ? base.familyId : randomUUID();
  return {
    id: randomUUID(),
    familyId,
    name: name.trim(),
    workspaceId,
    version:
      Math.max(
        0,
        ...state.datasets
          .filter((d) => d.familyId === familyId)
          .map((d) => d.version),
      ) + 1,
    parentId: base?.id || null,
    cases: validated,
    digest: digest(validated),
    createdAt: new Date().toISOString(),
  };
}
