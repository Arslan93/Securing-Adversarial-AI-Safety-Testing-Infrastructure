import { useState, useRef, useEffect } from "react";
import { useLocalModels } from "./useLocalModels.js";
import { useSession } from "./useSession.js";
import { api, download, downloadText } from "../lib/api.js";
export function useWorkbench() {
  const {
    data,
    mfaChallenge,
    auth,
    config,
    initializing,
    connectionError,
    sessionNotice,
    refresh,
    bootstrap,
    clearSession,
    loginRole,
    logoutSession,
  } = useSession();
  const [selectedDatasetId, setSelectedDatasetId] = useState("");
  const [policyDraft, setPolicyDraft] = useState(null);
  const [campaignConfig, setCampaignConfig] = useState(null);
  const [metricMode, setMetricMode] = useState("synthetic-demo");
  const [casesLoading, setCasesLoading] = useState(false);
  const [page, setPage] = useState("Overview"),
    [modal, setModal] = useState(null),
    [toast, setToast] = useState(""),
    [error, setError] = useState(""),
    [search, setSearch] = useState(""),
    [detail, setDetail] = useState(null),
    [mobile, setMobile] = useState(false),
    [period, setPeriod] = useState("7D"),
    [selectedWs, setSelectedWs] = useState("ws-research"),
    [status, setStatus] = useState("All statuses"),
    [caseList, setCaseList] = useState([]),
    [verify, setVerify] = useState(null),
    [busy, setBusy] = useState(false),
    [modelMode, setModelMode] = useState("synthetic-demo");
  const { models, refreshModels } = useLocalModels(
    auth && modal === "campaign" && modelMode !== "synthetic-demo",
    clearSession,
    modelMode === "container-ollama",
  );
  const initialFocus = useRef(null),
    requestKey = useRef(crypto.randomUUID());
  useEffect(() => {
    if (modal === "campaign") {
      requestKey.current = crypto.randomUUID();
      if (config?.pilotMode) setModelMode("container-ollama");
    }
    if (!modal) {
      setPolicyDraft(null);
      setCampaignConfig(null);
    }
  }, [modal, config?.pilotMode]);
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
  useEffect(() => {
    if (!auth) {
      setMobile(false);
      setPage("Overview");
      setDetail(null);
      setModal(null);
      setCaseList([]);
      setSearch("");
      setError("");
      setToast("");
      setSelectedDatasetId("");
      setPolicyDraft(null);
    }
  }, [auth]);
  useEffect(() => {
    setDetail(null);
    setCaseList([]);
    setSelectedDatasetId("");
    setModal(null);
    setPage("Overview");
  }, [data?.user?.id, data?.organization?.id, data?.role]);
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [page, detail?.id]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 4500);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(() => {
    if (!auth || !detail?.id) return;
    let stopped = false,
      timer;
    const controller = new AbortController();
    const id = detail.id;
    const load = async () => {
      try {
        const next = await api("/runs/" + id, undefined, {
          signal: controller.signal,
        });
        if (!stopped) setDetail(next);
      } catch (e) {
        if (stopped) return;
        if (e.status === 401)
          clearSession("Your session expired. Sign in again to continue.");
        else if (e.status === 404) {
          setDetail(null);
          setError(
            "This run is no longer available. Return to the campaign list.",
          );
        } else setError(e.message);
      } finally {
        if (!stopped) timer = setTimeout(load, 1400);
      }
    };
    load();
    return () => {
      stopped = true;
      controller.abort();
      clearTimeout(timer);
    };
  }, [auth, detail?.id, clearSession]);
  useEffect(() => {
    if (
      page !== "Test library" ||
      !auth ||
      !["Admin", "Red"].includes(data?.role)
    )
      return;
    const controller = new AbortController();
    setCaseList([]);
    setCasesLoading(true);
    api(
      "/cases" +
        (selectedDatasetId
          ? "?datasetId=" + encodeURIComponent(selectedDatasetId)
          : ""),
      undefined,
      { signal: controller.signal },
    )
      .then((d) => setCaseList(d.cases))
      .catch((e) => {
        if (!controller.signal.aborted) {
          if (e.status === 401)
            clearSession("Your session expired. Sign in again to continue.");
          else setError(e.message);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setCasesLoading(false);
      });
    return () => controller.abort();
  }, [page, auth, data?.role, selectedDatasetId, clearSession]);
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
  const datasetWorkspace = useRef(null);
  useEffect(() => {
    if (ws?.id && datasetWorkspace.current !== ws.id) {
      datasetWorkspace.current = ws.id;
      setSelectedDatasetId(
        (data.datasets || []).find(
          (d) => !d.workspaceId || d.workspaceId === ws.id,
        )?.id || "",
      );
    }
  }, [ws?.id, data?.datasets]);
  const runs = (data?.runs || []).filter((r) => r.workspaceId === ws?.id);
  const filtered = runs.filter(
    (r) =>
      (r.name + " " + r.model + " " + r.id)
        .toLowerCase()
        .includes(search.toLowerCase()) &&
      (status === "All statuses" || r.status === status),
  );
  async function act(fn, { refreshAfter = true } = {}) {
    setBusy(true);
    setError("");
    try {
      await fn();
      if (refreshAfter) await refresh();
    } catch (e) {
      if (e.status === 401 && auth)
        clearSession("Your session expired. Sign in again to continue.");
      else setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function login(e) {
    e.preventDefault();
    setError("");
    const input = Object.fromEntries(new FormData(e.currentTarget));
    await act(() => loginRole(input), { refreshAfter: false });
  }
  async function logout() {
    await act(() => logoutSession(), { refreshAfter: false });
  }
  async function openRun(id) {
    try {
      setDetail(await api("/runs/" + id));
      setPage("Runs & findings");
    } catch (e) {
      if (e.status === 401)
        clearSession("Your session expired. Sign in again to continue.");
      else setError(e.message);
    }
  }
  async function exportRun(id) {
    await act(async () => {
      const pack = await api("/runs/" + id + "/export");
      download(pack, "bayora-evidence-" + id.slice(0, 8) + ".json");
      setToast("Evidence package downloaded");
    });
  }
  function resumeDraft(draft) {
    setCampaignConfig(draft);
    setModelMode(draft.mode);
    setModal("campaign");
  }
  async function cloneRun(id) {
    await act(
      async () => {
        resumeDraft(await api("/runs/" + id + "/configuration"));
      },
      { refreshAfter: false },
    );
  }
  async function exportReport(id, kind) {
    await act(
      async () => {
        const report = await api("/runs/" + id + "/report");
        downloadText(
          report[kind],
          `bayora-report-${id.slice(0, 8)}.${kind}`,
          kind === "html"
            ? "text/html;charset=utf-8"
            : "text/csv;charset=utf-8",
        );
        setToast(
          kind === "html"
            ? "Report downloaded. Open it and print to save as PDF."
            : "Redacted case outcomes downloaded",
        );
      },
      { refreshAfter: false },
    );
  }
  async function formSubmit(e) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const saveDraft = e.nativeEvent.submitter?.value === "save-draft";
    await act(async () => {
      if (modal === "campaign") {
        const configuration = {
          name: form.get("name"),
          workspaceId: form.get("workspace"),
          policyId: form.get("policy"),
          datasetId: form.get("dataset"),
          mode: modelMode,
          model: form.get("model"),
          localConsent: form.get("consent") === "on",
          parentId: campaignConfig?.parentId || null,
        };
        if (saveDraft) {
          await api(
            campaignConfig?.id ? "/drafts/" + campaignConfig.id : "/drafts",
            {
              ...configuration,
              version: campaignConfig?.version,
            },
          );
          setModal(null);
          setToast("Campaign draft saved. No evaluation started.");
          setPage("Campaigns");
          setDetail(null);
          return;
        }
        const result = await api("/runs", {
          ...configuration,
          draftId: campaignConfig?.id,
          draftVersion: campaignConfig?.version,
          requestKey: requestKey.current,
        });
        setToast(
          modelMode !== "synthetic-demo"
            ? "Campaign created. Live local evaluation started."
            : "Campaign created. Synthetic fixture evaluation started.",
        );
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
        setToast(
          "Workspace created. Network policy is recorded; runtime enforcement is not implemented.",
        );
      } else {
        await api("/policies", {
          name: form.get("name"),
          basePolicyId: policyDraft?.id || null,
          workspaceId: ws.id,
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

  return {
    campaignConfig,
    resumeDraft,
    cloneRun,
    exportReport,
    mfaChallenge,
    selectedDatasetId,
    setSelectedDatasetId,
    policyDraft,
    onNewVersion: (p) => {
      setPolicyDraft(p);
      setModal("policy");
    },
    config,
    initializing,
    connectionError,
    sessionNotice,
    bootstrap,
    refresh,
    logout,
    metricMode,
    setMetricMode,
    casesLoading,
    auth,
    login,
    busy,
    error,
    mobile,
    ws,
    setSelectedWs,
    setDetail,
    data,
    canPolicy,
    page,
    navigate,
    runs,
    act,
    setMobile,
    search,
    setSearch,
    setPage,
    detail,
    setModal,
    permitted,
    setError,
    period,
    setPeriod,
    filtered,
    openRun,
    status,
    setStatus,
    setToast,
    exportRun,
    caseList,
    verifyFile,
    verify,
    modal,
    formSubmit,
    initialFocus,
    modelMode,
    setModelMode,
    refreshModels,
    models,
    toast,
  };
}
