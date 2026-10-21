import { Textarea } from "../components/atoms/Textarea.jsx";
import { Select } from "../components/atoms/Select.jsx";
import { Input } from "../components/atoms/Input.jsx";
import { useState } from "react";
import { BookOpen, Lock, Plus, Upload, Download, Info } from "lucide-react";
import { Empty } from "../components/molecules/Empty.jsx";
import { api, download } from "../lib/api.js";
export function LibraryScreen({
  page,
  data,
  caseList,
  casesLoading,
  ws,
  selectedDatasetId,
  setSelectedDatasetId,
  act,
  setToast,
}) {
  const [composing, setComposing] = useState(false);
  if (page !== "Test library") return null;
  const datasets = (data.datasets || []).filter(
    (d) => !d.workspaceId || d.workspaceId === ws.id,
  );
  const current =
    datasets.find((d) => d.id === selectedDatasetId) || datasets[0];
  const privateAccess = ["Admin", "Red"].includes(data.role);
  async function saveCase(e) {
    e.preventDefault();
    const form = e.currentTarget,
      f = new FormData(form);
    await act(async () => {
      const dataset = await api("/cases", {
        workspaceId: ws.id,
        datasetId: current.id,
        datasetName: f.get("datasetName"),
        test: {
          name: f.get("name"),
          category: f.get("category"),
          prompt: f.get("prompt"),
          benign: f.get("category") === "Benign control",
          ...(f.get("expectedContains")
            ? { expectedContains: f.get("expectedContains") }
            : {}),
        },
      });
      setSelectedDatasetId(dataset.id);
      setComposing(false);
      setToast(
        `Published dataset v${dataset.version}; existing runs keep their original corpus.`,
      );
    });
  }
  async function importFile(e) {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    await act(async () => {
      if (file.size > 800000)
        throw Error("Import must be smaller than 800 KB.");
      const parsed = JSON.parse(await file.text());
      if (
        !parsed ||
        Object.keys(parsed).some(
          (k) => !["name", "cases", "baseDatasetId"].includes(k),
        )
      )
        throw Error("Import schema: {name, cases, optional baseDatasetId}.");
      const dataset = await api("/datasets", { ...parsed, workspaceId: ws.id });
      setSelectedDatasetId(dataset.id);
      setToast("Validated prompt-only dataset published.");
    });
  }
  return (
    <>
      <div className="library-summary">
        <BookOpen size={22} />
        <div>
          <h2>{current?.name || "Test corpus"}</h2>
          <p>
            {current?.total || 0} distinct prompt cases · v
            {current?.version || 1} · {current?.adversarialTotal || 0}{" "}
            adversarial
          </p>
        </div>
        <span className="badge green">Synthetic research data</span>
      </div>
      <div className="dataset-toolbar">
        <label>
          Dataset version
          <Select
            aria-label="Dataset version"
            value={current?.id || ""}
            onChange={(e) => setSelectedDatasetId(e.target.value)}
          >
            {datasets.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name} · v{d.version} · {d.total} cases
              </option>
            ))}
          </Select>
        </label>
        {privateAccess && (
          <div className="inline">
            <button
              className="secondary"
              onClick={() =>
                download(
                  {
                    name: "Example synthetic corpus",
                    cases: [
                      {
                        id: "example-control",
                        name: "Arithmetic control",
                        category: "Benign control",
                        prompt: "What is two plus two? Answer with one digit.",
                        benign: true,
                        expectedContains: "4",
                      },
                    ],
                  },
                  "bayora-dataset-template.json",
                )
              }
            >
              <Download size={14} />
              Import template
            </button>
            <label className="secondary import-button">
              <Upload size={14} />
              Import JSON
              <Input
                type="file"
                accept=".json,application/json"
                onChange={importFile}
              />
            </label>
            <button
              className="primary"
              onClick={() => setComposing(!composing)}
            >
              <Plus size={15} />
              Add test case
            </button>
          </div>
        )}
      </div>
      {privateAccess ? (
        <>
          {composing && (
            <section className="panel composer-panel">
              <h2>Add a bounded synthetic test</h2>
              <form onSubmit={saveCase}>
                <label>
                  Dataset name
                  <Input
                    name="datasetName"
                    defaultValue={current?.name}
                    maxLength={100}
                    required
                  />
                </label>
                <div className="form-columns">
                  <label>
                    Test name
                    <Input name="name" maxLength={100} required />
                  </label>
                  <label>
                    Category
                    <Select name="category">
                      {[
                        "Prompt injection",
                        "Data privacy",
                        "Role spoofing",
                        "Obfuscation",
                        "Benign control",
                      ].map((c) => (
                        <option key={c}>{c}</option>
                      ))}
                    </Select>
                  </label>
                </div>
                <label>
                  Prompt text
                  <Textarea
                    name="prompt"
                    rows={4}
                    maxLength={2000}
                    required
                    placeholder="Use fictional information and authorized synthetic scenarios."
                  />
                </label>
                <label>
                  Expected text (benign controls only; optional)
                  <Input name="expectedContains" maxLength={120} />
                </label>
                <p className="subtle">
                  Publishing creates a new immutable dataset revision. No shell,
                  file upload, or tool execution is supported.
                </p>
                <div className="modal-actions">
                  <button
                    className="secondary"
                    type="button"
                    onClick={() => setComposing(false)}
                  >
                    Cancel
                  </button>
                  <button className="primary">Publish dataset revision</button>
                </div>
              </form>
            </section>
          )}
          <section className="panel" aria-busy={casesLoading}>
            <div className="panel-head">
              <h2>Private test cases</h2>
              <span className="subtle">Red / Admin only</span>
            </div>
            {casesLoading ? (
              <p className="inline-loading" role="status">
                Loading approved test cases…
              </p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Case</th>
                      <th>Name / prompt</th>
                      <th>Category</th>
                      <th>Rubric</th>
                    </tr>
                  </thead>
                  <tbody>
                    {caseList.map((c) => (
                      <tr key={c.id}>
                        <td className="mono">{c.id.slice(0, 12)}</td>
                        <td>
                          <details>
                            <summary>{c.name}</summary>
                            <p className="case-prompt">{c.prompt}</p>
                          </details>
                        </td>
                        <td>{c.category}</td>
                        <td>
                          {c.benign
                            ? c.expectedContains
                              ? `Expected text: ${c.expectedContains}`
                              : "Utility unassessed"
                            : "Exact canary disclosure"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
          <div className="info-line">
            <Info size={16} />
            <code>SHA-256 {current?.digest?.slice(0, 28)}…</code> · No
            executable payloads
          </div>
        </>
      ) : (
        <Empty
          icon={Lock}
          title="Private test content"
          text="Your role may select dataset metadata but cannot read private Red prompts."
        />
      )}
    </>
  );
}
