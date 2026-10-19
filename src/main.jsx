import React, { useEffect, useState, useRef } from "react";
import { createRoot } from "react-dom/client";
import {
  Shield,
  LayoutDashboard,
  Folder,
  Play,
  BookOpen,
  FileText,
  ChartNoAxesColumn,
  Settings,
  ChevronDown,
  ChevronRight,
  Plus,
  Search,
  Bell,
  ArrowUpRight,
  ArrowRight,
  Check,
  CheckCircle2,
  X,
  Info,
  Database,
  BrainCircuit,
  Users,
  ScanFace,
  Lock,
  Download,
  Upload,
  LogOut,
  Menu,
  Activity,
  Clock,
  Copy,
  TriangleAlert,
  RefreshCw,
  LoaderCircle,
} from "lucide-react";
import "./styles.css";
const nav = [
  ["Overview", LayoutDashboard],
  ["Workspaces", Folder],
  ["Campaigns", Play],
  ["Test library", BookOpen],
  ["Policy lab", FileText],
  ["Runs & findings", ChartNoAxesColumn],
  ["Audit vault", Shield],
];
const running = (s) =>
  [
    "VALIDATING",
    "QUEUED",
    "PROVISIONING",
    "RUNNING",
    "EVALUATING",
    "FINALIZING",
  ].includes(s);
const date = (s) =>
  new Date(s).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
async function api(path, body) {
  const res = await fetch("/api" + path, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await res.json();
  if (!res.ok)
    throw Object.assign(Error(data.error || "Request failed"), {
      status: res.status,
    });
  return data;
}
function download(data, name) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function Badge({ status }) {
  return (
    <span
      className={
        "badge " +
        (status === "COMPLETED"
          ? "green"
          : running(status)
            ? "blue"
            : status === "CANCELLED"
              ? "gray"
              : "red")
      }
    >
      <span />
      {status.toLowerCase().replaceAll("_", " ")}
    </span>
  );
}
function App() {
  const [data, setData] = useState(null),
    [auth, setAuth] = useState(false),
    [page, setPage] = useState("Overview"),
    [modal, setModal] = useState(null),
    [toast, setToast] = useState(""),
    [error, setError] = useState(""),
    [search, setSearch] = useState(""),
    [detail, setDetail] = useState(null),
    [mobile, setMobile] = useState(false),
    [period, setPeriod] = useState("7D"),
    [role, setRole] = useState("Admin"),
    [selectedWs, setSelectedWs] = useState("ws-research"),
    [status, setStatus] = useState("All statuses"),
    [caseList, setCaseList] = useState([]),
    [verify, setVerify] = useState(null),
    [busy, setBusy] = useState(false),
    [modelMode, setModelMode] = useState("synthetic-demo"),
    [models, setModels] = useState(null);
  const initialFocus = useRef(null),
    requestKey = useRef(crypto.randomUUID());
  useEffect(() => {
    if (modal === "campaign") requestKey.current = crypto.randomUUID();
  }, [modal]);
  useEffect(() => {
    const handler = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        document.querySelector(".search input")?.focus();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);
  function clearSession() {
    setAuth(false);
    setData(null);
    setMobile(false);
    setPage("Overview");
    setDetail(null);
    setModal(null);
    setCaseList([]);
    setSearch("");
    setError("");
    setToast("");
  }
  async function refresh() {
    try {
      const next = await api("/state");
      setData(next);
      setAuth(true);
    } catch (e) {
      if (e.status === 401) {
        clearSession();
      } else setError(e.message);
    }
  }
  useEffect(() => {
    refresh();
  }, []);
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [page, detail?.id]);
  useEffect(() => {
    if (!auth) return;
    const timer = setInterval(refresh, 1800);
    return () => clearInterval(timer);
  }, [auth]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 4500);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(() => {
    if (!detail) return;
    let alive = true;
    const load = () =>
      api("/runs/" + detail.id)
        .then((r) => alive && setDetail(r))
        .catch((e) => setError(e.message));
    load();
    const t = setInterval(load, 1400);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [detail?.id]);
  useEffect(() => {
    if (
      page === "Test library" &&
      auth &&
      ["Admin", "Red"].includes(data?.role)
    )
      api("/cases")
        .then((d) => setCaseList(d.cases))
        .catch((e) => setError(e.message));
  }, [page, auth, data?.role]);
  useEffect(() => {
    if (modal) {
      initialFocus.current?.focus();
      const key = (e) => {
        if (e.key === "Escape") setModal(null);
        if (e.key === "Tab") {
          const items = [
            ...document.querySelectorAll(
              ".modal button,.modal input,.modal select,.modal textarea",
            ),
          ].filter((x) => !x.disabled);
          const first = items[0],
            last = items.at(-1);
          if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last?.focus();
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first?.focus();
          }
        }
      };
      document.addEventListener("keydown", key);
      return () => document.removeEventListener("keydown", key);
    }
  }, [modal]);
  const permitted = ["Admin", "Analyst"].includes(data?.role),
    canPolicy = ["Admin", "Blue"].includes(data?.role);
  const ws =
    data?.workspaces.find((w) => w.id === selectedWs) || data?.workspaces[0];
  const runs = (data?.runs || []).filter((r) => r.workspaceId === ws?.id);
  const filtered = runs.filter(
    (r) =>
      (r.name + " " + r.model + " " + r.id)
        .toLowerCase()
        .includes(search.toLowerCase()) &&
      (status === "All statuses" || r.status === status),
  );
  const complete = runs.filter(
      (r) => r.status === "COMPLETED" && r.mode !== "ollama",
    ),
    total = complete.reduce((n, r) => n + r.completed, 0),
    violations = complete.reduce((n, r) => n + r.defended, 0);
  async function act(fn) {
    setBusy(true);
    setError("");
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function login(e) {
    e.preventDefault();
    await act(async () => {
      await api("/login", { role });
      await refresh();
    });
  }
  async function openRun(id) {
    try {
      setDetail(await api("/runs/" + id));
      setPage("Runs & findings");
    } catch (e) {
      setError(e.message);
    }
  }
  async function exportRun(id) {
    await act(async () => {
      const pack = await api("/runs/" + id + "/export");
      download(pack, "bayora-evidence-" + id.slice(0, 8) + ".json");
      setToast("Evidence package downloaded");
    });
  }
  async function formSubmit(e) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    await act(async () => {
      if (modal === "campaign") {
        const result = await api("/runs", {
          name: form.get("name"),
          workspaceId: form.get("workspace"),
          policyId: form.get("policy"),
          mode: modelMode,
          model: form.get("model"),
          localConsent: form.get("consent") === "on",
          requestKey: requestKey.current,
        });
        setToast("Campaign created. Synthetic evaluation started.");
        setModal(null);
        await openRun(result.id);
      } else if (modal === "workspace") {
        const result = await api("/workspaces", {
          name: form.get("name"),
          purpose: form.get("purpose"),
          ttl: Number(form.get("ttl")),
        });
        setSelectedWs(result.id);
        setModal(null);
        setToast("Workspace created with deny-by-default network policy");
      } else {
        await api("/policies", {
          name: form.get("name"),
          rules: String(form.get("rules"))
            .split("\n")
            .map((s) => s.trim())
            .filter(Boolean),
        });
        setModal(null);
        setToast("Immutable policy version published");
      }
    });
  }
  async function verifyFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    await act(async () => {
      try {
        const pack = JSON.parse(await file.text());
        setVerify(await api("/verify", pack));
      } catch (err) {
        setVerify({ valid: false, error: err.message });
      }
    });
    e.target.value = "";
  }
  const navigate = (p) => {
    setPage(p);
    setDetail(null);
    setSearch("");
    setStatus("All statuses");
    setMobile(false);
  };
  if (!auth)
    return (
      <div className="login-page">
        <div className="login-brand">
          <Logo />
          <span>Isolation-first AI safety testing</span>
        </div>
        <div className="login-card">
          <div className="login-symbol">
            <Shield size={32} />
          </div>
          <h1>A safer place to test limits.</h1>
          <p>
            Evaluate defenses. Preserve boundaries.
            <br />
            Keep the evidence.
          </p>
          <div className="demo-note">
            <Info size={17} />
            <div>
              <strong>Local development demo</strong>
              <br />
              Synthetic demo or opt-in local inference. Role selection is for
              testing permissions, and is not production authentication.
            </div>
          </div>
          <form onSubmit={login}>
            <label htmlFor="role">Continue as</label>
            <select
              id="role"
              value={role}
              onChange={(e) => setRole(e.target.value)}
            >
              {["Admin", "Red", "Blue", "Analyst", "Auditor"].map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
            <button className="primary login-submit" disabled={busy}>
              {busy ? (
                <LoaderCircle className="spin" size={17} />
              ) : (
                <Shield size={17} />
              )}
              Enter workspace
              <ArrowRight size={17} />
            </button>
          </form>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <div className="login-footer">
            <Lock size={13} />
            Local-only · Synthetic data · No external inference
          </div>
        </div>
        <span className="login-credit">BAYORA / TEAM MANGO DB</span>
      </div>
    );
  return (
    <div className="app">
      <aside className={mobile ? "sidebar open" : "sidebar"}>
        <Logo />
        <div className="workspace-switch">
          <Database size={18} />
          <div>
            <b>Mango DB</b>
            <select
              aria-label="Current workspace"
              value={ws?.id}
              onChange={(e) => {
                setSelectedWs(e.target.value);
                setDetail(null);
              }}
            >
              {data.workspaces.map((w) => (
                <option value={w.id} key={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </div>
          <ChevronDown size={14} />
        </div>
        <div className="nav-caption">WORKSPACE</div>
        <nav>
          {nav
            .filter(([name]) => name !== "Policy lab" || canPolicy)
            .map(([name, Icon]) => (
              <button
                key={name}
                className={page === name ? "nav-item selected" : "nav-item"}
                onClick={() => navigate(name)}
              >
                <Icon size={18} />
                {name}
                {name === "Campaigns" &&
                runs.filter((r) => running(r.status)).length > 0 ? (
                  <span className="nav-count">
                    {runs.filter((r) => running(r.status)).length}
                  </span>
                ) : null}
              </button>
            ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="local-health">
            <span className="status-dot" />
            <span>Local demo</span>
            <span className="tiny">v0.1</span>
          </div>
          {data.role === "Admin" && (
            <button
              className={
                "nav-item " + (page === "Administration" ? "selected" : "")
              }
              onClick={() => navigate("Administration")}
            >
              <Settings size={18} />
              Administration
              <ChevronRight size={15} />
            </button>
          )}
          <button
            className="user"
            onClick={() =>
              act(async () => {
                await api("/logout", {});
                clearSession();
              })
            }
          >
            <span className="avatar">MD</span>
            <span>
              <b>Demo operator</b>
              <small>{data.role}</small>
            </span>
            <LogOut size={16} />
          </button>
        </div>
      </aside>
      {mobile && (
        <div className="mobile-scrim" onClick={() => setMobile(false)} />
      )}
      <div className="main-shell">
        <header>
          <div className="breadcrumbs">
            <button
              className="mobile-menu icon-btn"
              aria-label="Open navigation"
              onClick={() => setMobile(true)}
            >
              <Menu size={21} />
            </button>
            <span>Workspace</span>
            <span className="slash">/</span>
            <strong>{page}</strong>
            <span className="role-badge">{data.role}</span>
          </div>
          <div className="header-tools">
            <div className="search">
              <Search size={16} />
              <input
                aria-label="Search campaigns"
                placeholder="Search campaigns…"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  if (page !== "Campaigns" && page !== "Overview") {
                    setPage("Campaigns");
                    setDetail(null);
                  }
                }}
              />
              <kbd>⌘ K</kbd>
            </div>
            <button
              className="icon-btn notification"
              aria-label="View recent audit events"
              onClick={() => navigate("Audit vault")}
            >
              <Bell size={19} />
              <i />
            </button>
            <span className="avatar small">MD</span>
          </div>
        </header>
        <main>
          <div className="page-title">
            <div>
              <h1>
                {detail
                  ? detail.name
                  : {
                      Overview: "Workspace overview",
                      "Runs & findings": "Runs & findings",
                      "Policy lab": "Policy lab",
                      "Audit vault": "Audit vault",
                      "Test library": "Test library",
                      Administration: "Administration",
                    }[page] || page}
              </h1>
              <p>
                {detail
                  ? "A frozen configuration. Every result in context."
                  : {
                      Overview: "Your evaluation environment, at a glance.",
                      Workspaces: "Separate environments. Explicit boundaries.",
                      Campaigns:
                        "Run controlled evaluations against a frozen policy.",
                      "Test library":
                        "A curated, benign corpus for repeatable evaluation.",
                      "Policy lab":
                        "Build, version, and evaluate your defensive rules.",
                      "Runs & findings":
                        "Investigate safety outcomes and evaluation provenance.",
                      "Audit vault": "Inspect the trail. Verify the evidence.",
                      Administration:
                        "Manage the limits of your local environment.",
                    }[page]}
              </p>
            </div>
            {page === "Workspaces" && data.role === "Admin" ? (
              <button className="primary" onClick={() => setModal("workspace")}>
                <Plus size={17} />
                New workspace
              </button>
            ) : page === "Policy lab" && canPolicy ? (
              <button className="primary" onClick={() => setModal("policy")}>
                <Plus size={17} />
                Publish policy
              </button>
            ) : detail ? (
              <button
                className="secondary"
                onClick={() => {
                  setDetail(null);
                }}
              >
                <ArrowRight size={16} className="rotate" />
                All runs
              </button>
            ) : permitted &&
              ["Overview", "Campaigns", "Runs & findings"].includes(page) ? (
              <button className="primary" onClick={() => setModal("campaign")}>
                <Plus size={17} />
                New campaign
              </button>
            ) : null}
          </div>
          <div className="environment">
            <span className="status-dot" />
            <strong>Local demo environment</strong>
            <span className="env-divider" />
            <span>
              {detail?.mode === "ollama"
                ? "Live local inference · Isolation unverified"
                : "Synthetic demo · Local inference available on opt-in"}
            </span>
            <span className="classification">
              <Lock size={12} />
              Synthetic data
            </span>
          </div>
          {error && (
            <div className="error alert" role="alert">
              <TriangleAlert size={17} />
              {error}
              <button aria-label="Dismiss error" onClick={() => setError("")}>
                <X size={16} />
              </button>
            </div>
          )}
          {page === "Overview" && (
            <>
              <div className="metrics">
                <Metric
                  icon={Play}
                  label="Active campaigns"
                  value={runs.filter((r) => running(r.status)).length}
                  note={`${runs.length} total campaigns`}
                />
                <Metric
                  icon={FileText}
                  label="Evaluations"
                  value={total * 2}
                  note="Paired synthetic model attempts"
                />
                <Metric
                  icon={ScanFace}
                  label="Attack success rate"
                  value={
                    total
                      ? ((violations / (complete.length * 16)) * 100).toFixed(
                          1,
                        ) + "%"
                      : "—"
                  }
                  note={`${violations} / ${complete.length * 16} adversarial cases`}
                  tone="rose"
                />
                <Metric
                  icon={Shield}
                  label="Evidence integrity"
                  value={complete.length ? "Unverified" : "—"}
                  note="Independent anchor not configured"
                />
              </div>
              <div className="overview-grid">
                <section className="panel activity-panel">
                  <div className="panel-head">
                    <h2>Evaluation activity</h2>
                    <div className="segmented">
                      {["7D", "30D", "90D"].map((p) => (
                        <button
                          key={p}
                          className={period === p ? "active" : ""}
                          onClick={() => setPeriod(p)}
                        >
                          {p}
                        </button>
                      ))}
                    </div>
                  </div>
                  <ActivityChart runs={complete} period={period} />
                </section>
                <Topology />
              </div>
              <CampaignTable
                runs={filtered.slice(0, 4)}
                onOpen={openRun}
                onAll={() => navigate("Campaigns")}
                emptyAction={permitted ? () => setModal("campaign") : null}
              />
              <AuditEvents
                events={data.events.slice(0, 3)}
                onAll={() => navigate("Audit vault")}
              />
            </>
          )}
          {page === "Workspaces" && (
            <div className="workspace-grid">
              {data.workspaces.map((w) => (
                <section className="panel workspace-card" key={w.id}>
                  <div className="workspace-card-top">
                    <span className="tile-icon">
                      <Folder size={22} />
                    </span>
                    <span className="badge gray">Local demo</span>
                  </div>
                  <h2>{w.name}</h2>
                  <p>
                    {w.purpose || "Controlled synthetic evaluation workspace"}
                  </p>
                  <dl>
                    <div>
                      <dt>Network policy</dt>
                      <dd>
                        <Lock size={13} />
                        {w.network}
                      </dd>
                    </div>
                    <div>
                      <dt>Maximum runtime</dt>
                      <dd>{w.ttl} minutes</dd>
                    </div>
                    <div>
                      <dt>Classification</dt>
                      <dd>{w.classification}</dd>
                    </div>
                    <div>
                      <dt>Campaigns</dt>
                      <dd>
                        {data.runs.filter((r) => r.workspaceId === w.id).length}
                      </dd>
                    </div>
                  </dl>
                  <button
                    className="secondary"
                    onClick={() => {
                      setSelectedWs(w.id);
                      navigate("Campaigns");
                    }}
                  >
                    Open workspace
                    <ArrowRight size={15} />
                  </button>
                </section>
              ))}
            </div>
          )}
          {(page === "Campaigns" || page === "Runs & findings") && !detail && (
            <>
              <div className="table-toolbar">
                <div className="tabs">
                  <button className="active">
                    All campaigns <span>{runs.length}</span>
                  </button>
                </div>
                <select
                  aria-label="Filter campaign status"
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                >
                  {[
                    "All statuses",
                    "COMPLETED",
                    "RUNNING",
                    "CANCELLED",
                    "FAILED",
                  ].map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </div>
              <CampaignTable
                runs={filtered}
                onOpen={openRun}
                emptyAction={permitted ? () => setModal("campaign") : null}
                full
              />
            </>
          )}
          {detail?.error && (
            <div className="error alert" role="alert">
              <TriangleAlert size={16} />
              {detail.error}
            </div>
          )}
          {detail && page === "Runs & findings" && (
            <RunDetail
              run={detail}
              onReview={(caseId, outcome, reason) =>
                act(async () => {
                  await api("/runs/" + detail.id + "/reviews", {
                    caseId,
                    outcome,
                    reason,
                  });
                  setDetail(await api("/runs/" + detail.id));
                  setToast(
                    "Review appended. Original classification preserved.",
                  );
                })
              }
              onExport={() => exportRun(detail.id)}
              canManage={permitted}
              onCancel={() =>
                act(async () => {
                  await api("/runs/" + detail.id + "/cancel", {});
                  setDetail(await api("/runs/" + detail.id));
                  setToast("Run cancelled. Demo cleanup recorded.");
                })
              }
              onReplay={() => setModal("campaign")}
            />
          )}
          {page === "Test library" && (
            <>
              <div className="library-summary">
                <BookOpen size={22} />
                <div>
                  <h2>Bayora synthetic benchmark</h2>
                  <p>20 prompt-only cases · 5 categories · Dataset v1</p>
                </div>
                <span className="badge green">Approved demo corpus</span>
              </div>
              {["Admin", "Red"].includes(data.role) ? (
                <section className="panel">
                  <div className="panel-head">
                    <h2>
                      Test cases{" "}
                      <span className="muted">{caseList.length}</span>
                    </h2>
                    <span className="subtle">Private to Red / Admin</span>
                  </div>
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Case</th>
                          <th>Name</th>
                          <th>Category</th>
                          <th>Expected behavior</th>
                        </tr>
                      </thead>
                      <tbody>
                        {caseList.map((c) => (
                          <tr key={c.id}>
                            <td className="mono">{c.id}</td>
                            <td>
                              <details>
                                <summary>{c.name}</summary>
                                <p className="case-prompt">{c.prompt}</p>
                              </details>
                            </td>
                            <td>{c.category}</td>
                            <td>
                              {c.benign ? "Answer safely" : "Enforce boundary"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              ) : (
                <Empty
                  icon={Lock}
                  title="Private test content"
                  text="Your role can view aggregate results. Raw Red test inputs require a Red or Admin development identity."
                />
              )}
            </>
          )}
          {page === "Policy lab" && canPolicy && (
            <>
              <div className="info-line">
                <Info size={16} />
                Published versions are immutable. Active runs keep their
                original policy snapshot.
              </div>
              <div className="policy-list">
                {[...data.policies].reverse().map((p) => (
                  <section className="panel policy-card" key={p.id}>
                    <div className="policy-icon">
                      <Shield size={24} />
                    </div>
                    <div className="policy-main">
                      <div className="inline">
                        <h2>{p.name}</h2>
                        <span className="version">v{p.version}</span>
                      </div>
                      <p>Published {date(p.createdAt)} · Text rule bundle</p>
                      <ul>
                        {p.rules?.map((r, i) => (
                          <li key={i}>
                            <Check size={14} />
                            {r}
                          </li>
                        ))}
                      </ul>
                      <div className="digest">
                        <Lock size={12} />
                        <code>SHA-256 {p.digest?.slice(0, 24)}…</code>
                      </div>
                    </div>
                    <button
                      className="secondary"
                      onClick={() => {
                        setModal("policy");
                        setToast(
                          "Publish a new version to preserve existing evidence.",
                        );
                      }}
                    >
                      New version
                      <Plus size={14} />
                    </button>
                  </section>
                ))}
              </div>
            </>
          )}
          {page === "Audit vault" && (
            <>
              <div className="audit-grid">
                <section className="panel verify-panel">
                  <div className="panel-head">
                    <h2>
                      <Shield size={19} />
                      Evidence verifier
                    </h2>
                    <span className="badge gray">Local consistency</span>
                  </div>
                  <p>
                    Check a downloaded evidence package for changed, missing, or
                    reordered events.
                  </p>
                  <label className="upload-area">
                    <Upload size={25} />
                    <strong>Choose an evidence package</strong>
                    <span>Bayora JSON · up to 1 MB</span>
                    <input
                      type="file"
                      accept="application/json,.json"
                      onChange={verifyFile}
                    />
                  </label>
                  {verify && (
                    <div
                      className={
                        verify.valid
                          ? "verify-result good"
                          : "verify-result bad"
                      }
                    >
                      {verify.valid ? (
                        <CheckCircle2 size={19} />
                      ) : (
                        <TriangleAlert size={19} />
                      )}
                      <div>
                        <b>
                          {verify.valid
                            ? "Hash chain is consistent"
                            : "Verification failed"}
                        </b>
                        <p>
                          {verify.valid
                            ? `${verify.events} events checked. ${verify.qualification}`
                            : verify.error}
                        </p>
                      </div>
                    </div>
                  )}
                </section>
                <section className="panel proof-panel">
                  <div className="tile-icon">
                    <Lock size={22} />
                  </div>
                  <h2>Evidence, with honest limits.</h2>
                  <p>
                    Event hashes detect changes relative to the exported anchor.
                    An independent signature is required to prove integrity
                    against a privileged administrator.
                  </p>
                  <dl>
                    <div>
                      <dt>Hash algorithm</dt>
                      <dd>SHA-256</dd>
                    </div>
                    <div>
                      <dt>External signing anchor</dt>
                      <dd className="warning-text">Not configured</dd>
                    </div>
                    <div>
                      <dt>Raw Red payloads</dt>
                      <dd>Excluded from exports</dd>
                    </div>
                  </dl>
                </section>
              </div>
              <AuditEvents events={data.events} />
              <section className="panel export-panel">
                <div className="panel-head">
                  <h2>Finalized campaign evidence</h2>
                </div>
                {runs.filter((r) => !running(r.status)).length ? (
                  runs
                    .filter((r) => !running(r.status))
                    .map((r) => (
                      <div className="export-row" key={r.id}>
                        <FileText size={18} />
                        <div>
                          <b>{r.name}</b>
                          <small>
                            {date(r.createdAt)} · {r.validity}
                          </small>
                        </div>
                        <button
                          className="secondary"
                          onClick={() => exportRun(r.id)}
                        >
                          <Download size={15} />
                          Export JSON
                        </button>
                      </div>
                    ))
                ) : (
                  <Empty
                    icon={FileText}
                    title="No finalized evidence yet"
                    text="Complete a campaign to download its manifest, results, and audit chain."
                  />
                )}
              </section>
            </>
          )}
          {page === "Administration" && (
            <div className="admin-grid">
              <section className="panel settings-panel">
                <h2>Environment & access</h2>
                <dl>
                  <div>
                    <dt>Deployment mode</dt>
                    <dd>Local development</dd>
                  </div>
                  <div>
                    <dt>Session authentication</dt>
                    <dd>Demo role identities · 1 hour</dd>
                  </div>
                  <div>
                    <dt>Role</dt>
                    <dd>{data.role}</dd>
                  </div>
                  <div>
                    <dt>Storage</dt>
                    <dd>SQLite · local disk</dd>
                  </div>
                  <div>
                    <dt>Model adapter</dt>
                    <dd>Synthetic fixture v1</dd>
                  </div>
                </dl>
                <div className="demo-note">
                  <Info size={17} />
                  <span>
                    Real OIDC, tenant membership, and a hardened runtime are
                    required before a research pilot.
                  </span>
                </div>
              </section>
              <section className="panel settings-panel">
                <h2>Execution limits</h2>
                <dl>
                  <div>
                    <dt>Default network</dt>
                    <dd>Deny all egress</dd>
                  </div>
                  <div>
                    <dt>Workspace TTL</dt>
                    <dd>{ws.ttl} minutes</dd>
                  </div>
                  <div>
                    <dt>Dataset limit</dt>
                    <dd>20 approved cases</dd>
                  </div>
                  <div>
                    <dt>Hostile code execution</dt>
                    <dd>Disabled</dd>
                  </div>
                  <div>
                    <dt>Containers</dt>
                    <dd>Not provisioned in demo</dd>
                  </div>
                </dl>
                <button
                  className="secondary"
                  onClick={() => {
                    navigate("Workspaces");
                  }}
                >
                  Manage workspaces
                  <ArrowUpRight size={15} />
                </button>
              </section>
            </div>
          )}
          <footer className="page-footer">
            <span>
              <Shield size={12} />
              Bayora · Isolation-first evaluation
            </span>
            <span>Controlled demo / No security attestation</span>
          </footer>
        </main>
      </div>
      {modal && (
        <div className="modal-backdrop" onClick={() => setModal(null)}>
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-heading">
              <span className="tile-icon">
                {modal === "policy" ? (
                  <Shield size={22} />
                ) : modal === "workspace" ? (
                  <Folder size={22} />
                ) : (
                  <Play size={22} />
                )}
              </span>
              <button
                className="icon-btn"
                aria-label="Close dialog"
                onClick={() => setModal(null)}
              >
                <X size={20} />
              </button>
            </div>
            <h2 id="modal-title">
              {modal === "campaign"
                ? "Create a campaign"
                : modal === "workspace"
                  ? "Create a workspace"
                  : "Publish a policy version"}
            </h2>
            <p>
              {modal === "campaign"
                ? "Freeze your configuration and start a paired synthetic evaluation."
                : modal === "workspace"
                  ? "Define a bounded environment for your evaluations."
                  : "Publish immutable, bounded text rules for the demo evaluator."}
            </p>
            <form onSubmit={formSubmit}>
              <label htmlFor="name">
                {modal === "campaign"
                  ? "Campaign name"
                  : modal === "workspace"
                    ? "Workspace name"
                    : "Policy name"}
              </label>
              <input
                ref={initialFocus}
                name="name"
                id="name"
                required
                maxLength={80}
                placeholder={
                  modal === "campaign"
                    ? "e.g. Prompt injection baseline"
                    : modal === "workspace"
                      ? "e.g. Safety research"
                      : "e.g. Context protection policy"
                }
              />
              {modal === "campaign" ? (
                <>
                  <label htmlFor="workspace">Workspace</label>
                  <select name="workspace" id="workspace" defaultValue={ws.id}>
                    {data.workspaces.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name}
                      </option>
                    ))}
                  </select>
                  <label htmlFor="policy">Defensive policy</label>
                  <select
                    name="policy"
                    id="policy"
                    defaultValue={data.policies.at(-1).id}
                  >
                    {data.policies.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} · v{p.version}
                      </option>
                    ))}
                  </select>
                  <label htmlFor="adapter">Model adapter</label>
                  <select
                    id="adapter"
                    value={modelMode}
                    onChange={async (e) => {
                      setModelMode(e.target.value);
                      if (e.target.value === "ollama") {
                        setModels(null);
                        try {
                          setModels(await api("/models"));
                        } catch (err) {
                          setModels({ available: false, message: err.message });
                        }
                      }
                    }}
                  >
                    <option value="synthetic-demo">
                      Synthetic adapter · instant demo
                    </option>
                    <option value="ollama">
                      Local Ollama · live inference
                    </option>
                  </select>
                  {modelMode === "ollama" && (
                    <div className="live-model-form">
                      {models?.available && models.models.length ? (
                        <>
                          <label htmlFor="model">Installed local model</label>
                          <select id="model" name="model" required>
                            {models.models.map((m) => (
                              <option key={m.id} value={m.id}>
                                {m.id}
                              </option>
                            ))}
                          </select>
                          <label className="consent">
                            <input type="checkbox" name="consent" required />
                            <span>
                              I approve sending this synthetic corpus and policy
                              to my local model. The shared runtime is not
                              isolated per run.
                            </span>
                          </label>
                        </>
                      ) : (
                        <div className="demo-note">
                          <Info size={16} />
                          <span>
                            {!models
                              ? "Checking local Ollama…"
                              : models.available
                                ? "No local models installed. Install an approved model in Ollama first."
                                : models.message}
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                  <div className="form-static">
                    <div>
                      <span>Client model</span>
                      <b>
                        {modelMode === "ollama"
                          ? "Selected local model"
                          : "Bayora synthetic adapter v1"}
                      </b>
                    </div>
                    <div>
                      <span>Dataset</span>
                      <b>20 approved synthetic cases</b>
                    </div>
                    <div>
                      <span>Evaluation</span>
                      <b>Baseline + defended</b>
                    </div>
                  </div>
                  <div className="demo-note">
                    <Info size={16} />
                    <span>
                      {modelMode === "ollama"
                        ? "Live inference uses 40 bounded calls with fresh message contexts. Exact canary disclosure is scored; environment isolation remains unverified."
                        : "No live inference or containers. Results demonstrate the workflow using deterministic fixtures."}
                    </span>
                  </div>
                </>
              ) : modal === "workspace" ? (
                <>
                  <label htmlFor="purpose">Project purpose</label>
                  <textarea
                    id="purpose"
                    name="purpose"
                    rows={3}
                    maxLength={300}
                    placeholder="What will this workspace evaluate?"
                  />
                  <label htmlFor="ttl">Maximum runtime (minutes)</label>
                  <input
                    id="ttl"
                    name="ttl"
                    type="number"
                    min="1"
                    max="120"
                    defaultValue="30"
                    required
                  />
                  <div className="demo-note">
                    <Lock size={16} />
                    <span>
                      Synthetic data only. Deny all egress. No shared runtime
                      mounts.
                    </span>
                  </div>
                </>
              ) : (
                <>
                  <label htmlFor="rules">Rules (one per line)</label>
                  <textarea
                    className="rule-input"
                    id="rules"
                    name="rules"
                    rows={6}
                    maxLength={5000}
                    required
                    defaultValue={
                      "Block instruction overrides\nProtect private context\nReject role impersonation"
                    }
                  />
                  <div className="demo-note">
                    <Info size={16} />
                    <span>
                      Text-only policy format. Rules are versioned and hashed;
                      the synthetic adapter uses a fixed scoring fixture.
                    </span>
                  </div>
                </>
              )}
              {error && (
                <p className="error" role="alert">
                  {error}
                </p>
              )}
              <div className="modal-actions">
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setModal(null)}
                >
                  Cancel
                </button>
                <button
                  className="primary"
                  disabled={
                    busy ||
                    (modal === "campaign" &&
                      modelMode === "ollama" &&
                      (!models?.available || !models.models?.length))
                  }
                >
                  {busy ? (
                    <LoaderCircle size={16} className="spin" />
                  ) : modal === "campaign" ? (
                    <Play size={16} />
                  ) : (
                    <Check size={16} />
                  )}
                  {modal === "campaign"
                    ? "Start evaluation"
                    : modal === "workspace"
                      ? "Create workspace"
                      : "Publish version"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
      {toast && (
        <div className="toast" role="status">
          <CheckCircle2 size={18} />
          {toast}
          <button
            className="icon-btn"
            aria-label="Dismiss notification"
            onClick={() => setToast("")}
          >
            <X size={15} />
          </button>
        </div>
      )}
    </div>
  );
}
function Logo() {
  return (
    <div className="logo">
      <div className="logo-mark">
        <Shield size={22} strokeWidth={2.3} />
      </div>
      <span>BAYORA</span>
    </div>
  );
}
function Metric({ icon: Icon, label, value, note, tone = "" }) {
  return (
    <section className="metric">
      <span className={"metric-icon " + tone}>
        <Icon size={22} />
      </span>
      <div>
        <p>{label}</p>
        <strong>{value}</strong>
        <small>{note}</small>
      </div>
    </section>
  );
}
function Empty({ icon: Icon, title, text, action }) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <Icon size={25} />
      </span>
      <h3>{title}</h3>
      <p>{text}</p>
      {action && (
        <button className="secondary" onClick={action}>
          <Plus size={15} />
          Create campaign
        </button>
      )}
    </div>
  );
}
function ActivityChart({ runs, period }) {
  const days = Number.parseInt(period);
  const cutoff = Date.now() - days * 86400000;
  const recent = runs
    .filter((r) => new Date(r.createdAt).getTime() >= cutoff)
    .slice(0, 7)
    .reverse();
  const x = (i) => 56 + i * (500 / Math.max(recent.length - 1, 1));
  const y = (n) => 180 - (n / 16) * 150;
  return (
    <div className="chart">
      <svg
        viewBox="0 0 600 230"
        role="img"
        aria-label={
          recent.length
            ? "Baseline and defended attack success rates for recent synthetic runs"
            : "No completed evaluations yet"
        }
      >
        {[0, 25, 50, 75, 100].map((v, i) => (
          <g key={v}>
            <line
              x1="53"
              y1={180 - i * 37.5}
              x2="575"
              y2={180 - i * 37.5}
              stroke="#edf0f2"
            />
            <text x="39" y={184 - i * 37.5} textAnchor="end">
              {v}%
            </text>
          </g>
        ))}
        {recent.length > 0 ? (
          <>
            {["baseline", "defended"].map((field, j) => {
              const points = recent
                .map((r, i) => `${x(i)},${y(r[field])}`)
                .join(" ");
              return (
                <g key={field}>
                  {recent.length > 1 && (
                    <polygon
                      points={`56,180 ${points} ${x(recent.length - 1)},180`}
                      fill={j ? "#dceee4" : "#e9ecef"}
                      opacity=".65"
                    />
                  )}
                  <polyline
                    points={points}
                    fill="none"
                    stroke={j ? "#18744d" : "#98a1aa"}
                    strokeWidth="2"
                  />
                  {recent.map((r, i) => (
                    <circle
                      key={r.id}
                      cx={x(i)}
                      cy={y(r[field])}
                      r="4"
                      fill={j ? "#18744d" : "#98a1aa"}
                    />
                  ))}
                </g>
              );
            })}
            {recent.map((r, i) => (
              <text key={r.id} x={x(i)} y="204" textAnchor="middle">
                Run {i + 1}
              </text>
            ))}
          </>
        ) : (
          <>
            <text className="chart-empty" x="315" y="100" textAnchor="middle">
              Your first evaluation starts here
            </text>
            <text x="315" y="123" textAnchor="middle">
              Complete a campaign to compare outcomes
            </text>
          </>
        )}
      </svg>
      <div className="legend">
        <span>
          <i className="baseline-dot" />
          Baseline (no safeguards)
        </span>
        <span>
          <i className="defended-dot" />
          Defended (policy enabled)
        </span>
      </div>
    </div>
  );
}
function Topology() {
  return (
    <section className="panel topology-panel">
      <div className="panel-head">
        <h2>Isolation boundaries</h2>
        <Lock size={15} className="muted" />
      </div>
      <div className="topology">
        <div className="topology-node red-node">
          <span>
            <ScanFace size={25} />
          </span>
          <b>Red team</b>
          <small>
            Adversarial
            <br />
            test inputs
          </small>
        </div>
        <div className="topology-arrow">
          <ArrowRight size={21} />
        </div>
        <div className="topology-node gateway-node">
          <span>
            <Shield size={25} />
          </span>
          <b>Policy gateway</b>
          <small>
            Controlled
            <br />
            communication
          </small>
        </div>
        <div className="topology-arrow">
          <ArrowRight size={21} />
        </div>
        <div className="topology-node model-node">
          <span>
            <BrainCircuit size={25} />
          </span>
          <b>Client LLM</b>
          <small>
            Scoped model
            <br />
            adapter
          </small>
        </div>
        <div className="topology-arrow">
          <ArrowRight size={21} />
        </div>
        <div className="topology-node blue-node">
          <span>
            <Users size={25} />
          </span>
          <b>Blue team</b>
          <small>
            Defensive
            <br />
            policies
          </small>
        </div>
      </div>
      <div className="blocked-line">
        <span />
        <b>
          <X size={12} />
        </b>
        <span />
      </div>
      <div className="blocked-copy">
        <Lock size={11} />
        Direct access prohibited by design
      </div>
      <div className="topology-note">
        <Info size={13} />
        Demo topology · Not a security attestation
      </div>
    </section>
  );
}
function CampaignTable({ runs, onOpen, onAll, emptyAction, full }) {
  return (
    <section className="panel campaigns-panel">
      {!full && (
        <div className="panel-head">
          <h2>Recent campaigns</h2>
          <button className="text-button" onClick={onAll}>
            View all
            <ArrowUpRight size={14} />
          </button>
        </div>
      )}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Campaign name</th>
              <th>Client model</th>
              <th>Policy</th>
              <th>Progress</th>
              <th>Status</th>
              <th>Created</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.id} onClick={() => onOpen(r.id)}>
                <td>
                  <button
                    className="table-name"
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpen(r.id);
                    }}
                  >
                    {r.name}
                  </button>
                  <small className="table-id">{r.id.slice(0, 8)}</small>
                </td>
                <td>
                  {r.mode === "ollama" ? (
                    r.model
                  ) : (
                    <>
                      Synthetic adapter <span className="muted">v1</span>
                    </>
                  )}
                </td>
                <td>
                  <span className="version">v{r.policyVersion}</span> Safety
                  policy
                </td>
                <td>
                  <div className="progress-cell">
                    <div className="progress">
                      <i
                        style={{
                          width: `${Math.round((r.completed / r.total) * 100)}%`,
                        }}
                      />
                    </div>
                    <span>{Math.round((r.completed / r.total) * 100)}%</span>
                  </div>
                </td>
                <td>
                  <Badge status={r.status} />
                </td>
                <td className="nowrap">{date(r.createdAt)}</td>
                <td>
                  <ChevronRight size={15} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!runs.length && (
        <Empty
          icon={Play}
          title="Ready for your first evaluation"
          text="Create a campaign to compare a baseline with your defensive policy, then inspect the evidence."
          action={emptyAction}
        />
      )}
    </section>
  );
}
function AuditEvents({ events, onAll }) {
  return (
    <section className="panel audit-events">
      <div className="panel-head">
        <h2>Recent audit events</h2>
        {onAll && (
          <button className="text-button" onClick={onAll}>
            View all
            <ArrowUpRight size={14} />
          </button>
        )}
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Event</th>
              <th>Details</th>
              <th>Event hash</th>
            </tr>
          </thead>
          <tbody>
            {events.map((e) => (
              <tr key={e.hash}>
                <td className="nowrap">{date(e.time)}</td>
                <td>
                  <span
                    className={
                      "event-dot " + (e.type.includes("denied") ? "denied" : "")
                    }
                  />
                  <strong className="event-type">
                    {e.type.replaceAll(".", " ")}
                  </strong>
                </td>
                <td className="event-details">
                  {e.data.runId
                    ? "Run " + e.data.runId.slice(0, 8)
                    : e.data.workspace
                      ? "Workspace " + e.data.workspace.slice(0, 12)
                      : e.data.role
                        ? "Role: " + e.data.role
                        : e.data.policyId
                          ? "Policy " + e.data.policyId.slice(0, 8)
                          : "Configuration captured"}
                </td>
                <td>
                  <code>{e.hash.slice(0, 14)}…</code>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
function RunDetail({ run, onExport, onCancel, onReplay, canManage, onReview }) {
  const [filter, setFilter] = useState("All outcomes"),
    [selected, setSelected] = useState(null);
  const results = run.results.filter(
    (r) => filter === "All outcomes" || r.defended === "Violation",
  );
  return (
    <>
      <section className="panel run-summary">
        <div className="run-summary-top">
          <div className="inline">
            <Badge status={run.status} />
            <span className="subtle mono">{run.id.slice(0, 8)}</span>
          </div>
          <div className="inline">
            {running(run.status) && canManage ? (
              <button className="secondary danger" onClick={onCancel}>
                <X size={15} />
                Cancel run
              </button>
            ) : null}
            {!running(run.status) && (
              <button className="secondary" onClick={onExport}>
                <Download size={15} />
                Export evidence
              </button>
            )}
            {canManage && !running(run.status) && (
              <button className="primary" onClick={onReplay}>
                <RefreshCw size={15} />
                New evaluation
              </button>
            )}
          </div>
        </div>
        <div className="run-config">
          <div>
            <small>CLIENT MODEL</small>
            <strong>{run.model}</strong>
          </div>
          <div>
            <small>POLICY VERSION</small>
            <strong>Safety policy · v{run.policyVersion}</strong>
          </div>
          <div>
            <small>DATASET</small>
            <strong>20 synthetic cases</strong>
          </div>
          <div>
            <small>ENVIRONMENT VERDICT</small>
            <strong className="warning-text">
              {run.validity === "PENDING"
                ? "Pending evaluation"
                : run.mode === "ollama"
                  ? "Unverified · Shared runtime"
                  : "Demo only · Unattested"}
            </strong>
          </div>
        </div>
        <div className="snapshot">
          <Lock size={13} />
          <span>Frozen manifest</span>
          <code>{run.manifestHash.slice(0, 32)}…</code>
        </div>
      </section>
      <div className="metrics three">
        <Metric
          icon={ScanFace}
          label="Baseline violations"
          value={`${run.baseline} / 16`}
          note={
            run.mode === "ollama"
              ? "Exact canary disclosure"
              : "Synthetic fixture outcomes"
          }
          tone="rose"
        />
        <Metric
          icon={Shield}
          label="Defended violations"
          value={`${run.defended} / 16`}
          note="Same frozen corpus"
        />
        <Metric
          icon={CheckCircle2}
          label="Completed cases"
          value={`${run.completed} / 20`}
          note="Paired baseline + defended"
        />
      </div>
      <section className="panel timeline-panel">
        <div className="panel-head">
          <h2>Execution timeline</h2>
          <span className="subtle">
            {running(run.status)
              ? "Updates automatically"
              : "Finalized · read only"}
          </span>
        </div>
        <div className="timeline">
          {run.timeline.map((s, i) => (
            <div className="timeline-step" key={s.status}>
              <span
                className={
                  i === run.timeline.length - 1 && running(run.status)
                    ? "current"
                    : ""
                }
              >
                {i === run.timeline.length - 1 && running(run.status) ? (
                  <LoaderCircle size={14} className="spin" />
                ) : (
                  <Check size={13} />
                )}
              </span>
              <b>{s.status.toLowerCase()}</b>
              <small>{new Date(s.time).toLocaleTimeString("en-GB")}</small>
            </div>
          ))}
        </div>
        {run.cleanup && (
          <div className="cleanup">
            <CheckCircle2 size={15} />
            {run.cleanup}
          </div>
        )}
      </section>
      <section className="panel">
        <div className="panel-head">
          <h2>Per-case outcomes</h2>
          <select
            aria-label="Filter outcomes"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            <option>All outcomes</option>
            <option>Violations only</option>
          </select>
        </div>
        {!run.results.length ? (
          <Empty
            icon={Activity}
            title={
              running(run.status) ? "Evaluation in progress" : "No case results"
            }
            text={
              running(run.status)
                ? "The synthetic adapter is processing the paired test corpus."
                : "This run ended before evaluation results were recorded."
            }
          />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Case</th>
                  <th>Category</th>
                  <th>Baseline</th>
                  <th>Defended</th>
                  <th>Latency</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {results.map((r) => (
                  <React.Fragment key={r.id}>
                    <tr>
                      <td>
                        <button
                          className="table-name"
                          onClick={() =>
                            setSelected(selected === r.id ? null : r.id)
                          }
                        >
                          {r.id} · {r.name}
                        </button>
                      </td>
                      <td>{r.category}</td>
                      <td>
                        <span
                          className={
                            "outcome " +
                            (r.baseline === "Safe" ? "safe" : "unsafe")
                          }
                        >
                          {r.baseline}
                        </span>
                      </td>
                      <td>
                        <span
                          className={
                            "outcome " +
                            (r.defended === "Safe" ? "safe" : "unsafe")
                          }
                        >
                          {r.defended}
                        </span>
                      </td>
                      <td>
                        {r.latency} ms{" "}
                        <span className="muted">
                          {run.mode === "ollama" ? "paired" : "fixture"}
                        </span>
                      </td>
                      <td>
                        <button
                          className="icon-btn"
                          aria-label={"Inspect " + r.id}
                          onClick={() =>
                            setSelected(selected === r.id ? null : r.id)
                          }
                        >
                          <ChevronDown size={15} />
                        </button>
                      </td>
                    </tr>
                    {selected === r.id && (
                      <tr>
                        <td colSpan="6">
                          <div className="result-detail">
                            <b>
                              Defended response ·{" "}
                              {run.mode === "ollama"
                                ? "live local model"
                                : "synthetic fixture"}
                            </b>
                            {r.output ? (
                              <p>{r.output}</p>
                            ) : (
                              <p>Raw responses are restricted for this role.</p>
                            )}
                            {r.baselineOutput && (
                              <>
                                <b>Baseline response</b>
                                <p>{r.baselineOutput}</p>
                              </>
                            )}
                            {r.rubric && <p>{r.rubric}</p>}
                            <small>
                              Evaluator:{" "}
                              {run.mode === "ollama"
                                ? "exact-canary-v1"
                                : "fixture-rubric-v1"}{" "}
                              · Original outcome preserved
                            </small>
                            {run.reviews
                              ?.filter((review) => review.caseId === r.id)
                              .map((review) => (
                                <div className="review-note" key={review.id}>
                                  <CheckCircle2 size={14} />
                                  <div>
                                    <b>
                                      Reviewed as {review.outcome} ·{" "}
                                      {review.role}
                                    </b>
                                    {review.reason && <p>{review.reason}</p>}
                                    <small>{date(review.time)}</small>
                                  </div>
                                </div>
                              ))}
                            {canManage && !running(run.status) && (
                              <form
                                className="review-form"
                                onSubmit={(e) => {
                                  e.preventDefault();
                                  const f = new FormData(e.currentTarget);
                                  onReview(
                                    r.id,
                                    f.get("outcome"),
                                    f.get("reason"),
                                  );
                                  e.currentTarget.reset();
                                }}
                              >
                                <label>
                                  Analyst classification
                                  <select name="outcome">
                                    <option>Safe</option>
                                    <option>Violation</option>
                                  </select>
                                </label>
                                <label>
                                  Review reason
                                  <input
                                    name="reason"
                                    required
                                    minLength={5}
                                    maxLength={1000}
                                    placeholder="Explain your assessment…"
                                  />
                                </label>
                                <button className="secondary" type="submit">
                                  <Check size={14} />
                                  Append review
                                </button>
                              </form>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <div className="info-line">
        <Info size={16} />
        Model scores do not establish runtime isolation. No container or
        independent audit anchor was provisioned.
      </div>
    </>
  );
}
createRoot(document.getElementById("root")).render(<App />);
