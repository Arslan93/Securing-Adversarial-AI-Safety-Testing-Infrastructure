import { NoWorkspaceScreen } from "./pages/NoWorkspaceScreen.jsx";
import { AccountScreen } from "./pages/AccountScreen.jsx";
import { Sidebar } from "./components/organisms/Sidebar.jsx";
import { AppHeader } from "./components/organisms/AppHeader.jsx";
import { WorkspaceTemplate } from "./components/templates/WorkspaceTemplate.jsx";
import {
  Plus,
  ArrowRight,
  Lock,
  TriangleAlert,
  X,
  Shield,
  CheckCircle2,
} from "lucide-react";
import { Logo } from "./components/molecules/Logo.jsx";
import { useWorkbench } from "./hooks/useWorkbench.js";
import { OverviewScreen } from "./pages/OverviewScreen.jsx";
import { WorkspacesScreen } from "./pages/WorkspacesScreen.jsx";
import { CampaignsScreen } from "./pages/CampaignsScreen.jsx";
import { RunScreen } from "./pages/RunScreen.jsx";
import { LibraryScreen } from "./pages/LibraryScreen.jsx";
import { PoliciesScreen } from "./pages/PoliciesScreen.jsx";
import { AuditScreen } from "./pages/AuditScreen.jsx";
import { AdminScreen } from "./pages/AdminScreen.jsx";
import { CampaignDialog } from "./components/organisms/CampaignDialog.jsx";
import { LoginScreen } from "./pages/LoginScreen.jsx";
export default function App() {
  const {
    campaignConfig,
    resumeDraft,
    cloneRun,
    exportReport,
    mfaChallenge,
    selectedDatasetId,
    setSelectedDatasetId,
    policyDraft,
    onNewVersion,
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
  } = useWorkbench();
  if (initializing)
    return (
      <div className="startup-state" role="status">
        <Logo />
        <p>Connecting to your local workspace…</p>
      </div>
    );
  if (!auth)
    return (
      <LoginScreen
        mfaChallenge={mfaChallenge}
        config={config}
        connectionError={connectionError}
        sessionNotice={sessionNotice}
        retry={bootstrap}
        login={login}
        busy={busy}
        error={error}
      />
    );
  if (!data.workspaces.length)
    return <NoWorkspaceScreen data={data} logout={logout} />;
  return (
    <div className="app">
      <WorkspaceTemplate
        sidebar={
          <Sidebar
            {...{
              mobile,
              ws,
              setSelectedWs,
              setDetail,
              data,
              canPolicy,
              page,
              navigate,
              runs,
              logout,
            }}
          />
        }
        header={
          <AppHeader
            {...{
              page,
              data,
              search,
              setSearch,
              setPage,
              setDetail,
              setMobile,
              navigate,
            }}
          />
        }
        mobile={mobile}
        closeNavigation={() => setMobile(false)}
      >
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
                      Workspaces:
                        "Evaluation settings and intended boundaries.",
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
            <strong>
              {config?.pilotMode
                ? "Restricted synthetic pilot"
                : "Local demo environment"}
            </strong>
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
          {connectionError && (
            <div className="connection-banner" role="alert">
              <TriangleAlert size={17} />
              <span>{connectionError} Displayed data may be out of date.</span>
              <button className="secondary" onClick={refresh}>
                Retry connection
              </button>
            </div>
          )}
          {error && (
            <div className="error alert" role="alert">
              <TriangleAlert size={17} />
              {error}
              <button aria-label="Dismiss error" onClick={() => setError("")}>
                <X size={16} />
              </button>
            </div>
          )}
          <OverviewScreen
            metricMode={metricMode}
            setMetricMode={setMetricMode}
            page={page}
            runs={runs}
            period={period}
            setPeriod={setPeriod}
            filtered={filtered}
            openRun={openRun}
            navigate={navigate}
            permitted={permitted}
            setModal={setModal}
            data={data}
          />
          <WorkspacesScreen
            page={page}
            data={data}
            setSelectedWs={setSelectedWs}
            navigate={navigate}
          />
          <CampaignsScreen
            drafts={(data.drafts || []).filter((d) => d.workspaceId === ws.id)}
            resumeDraft={resumeDraft}
            act={act}
            busy={busy}
            page={page}
            detail={detail}
            runs={runs}
            status={status}
            setStatus={setStatus}
            filtered={filtered}
            openRun={openRun}
            permitted={permitted}
            setModal={setModal}
          />
          {detail?.error && (
            <div className="error alert" role="alert">
              <TriangleAlert size={16} />
              {detail.error}
            </div>
          )}
          <RunScreen
            cloneRun={cloneRun}
            exportReport={exportReport}
            busy={busy}
            detail={detail}
            page={page}
            act={act}
            setDetail={setDetail}
            setToast={setToast}
            exportRun={exportRun}
            permitted={permitted}
            setModal={setModal}
          />
          <LibraryScreen
            ws={ws}
            selectedDatasetId={selectedDatasetId}
            setSelectedDatasetId={setSelectedDatasetId}
            act={act}
            setToast={setToast}
            casesLoading={casesLoading}
            page={page}
            data={data}
            caseList={caseList}
          />
          <PoliciesScreen
            onNewVersion={onNewVersion}
            page={page}
            canPolicy={canPolicy}
            data={data}
            setModal={setModal}
            setToast={setToast}
          />
          <AuditScreen
            page={page}
            verifyFile={verifyFile}
            verify={verify}
            data={data}
            runs={runs}
            exportRun={exportRun}
          />
          <AccountScreen page={page} data={data} />
          <AdminScreen
            refresh={refresh}
            config={config}
            page={page}
            data={data}
            ws={ws}
            navigate={navigate}
          />
          <footer className="page-footer">
            <span>
              <Shield size={12} />
              Bayora · Isolation-first evaluation
            </span>
            <span>Controlled demo / No security attestation</span>
          </footer>
        </main>
      </WorkspaceTemplate>
      {modal && (
        <CampaignDialog
          pilotMode={config?.pilotMode}
          campaignConfig={campaignConfig}
          selectedDatasetId={selectedDatasetId}
          policyDraft={policyDraft}
          setModal={setModal}
          modal={modal}
          formSubmit={formSubmit}
          initialFocus={initialFocus}
          ws={ws}
          data={data}
          modelMode={modelMode}
          setModelMode={setModelMode}
          refreshModels={refreshModels}
          models={models}
          error={error}
          busy={busy}
        />
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
