import {
  Database,
  ChevronDown,
  Settings,
  ChevronRight,
  LogOut,
} from "lucide-react";
import { Logo } from "../molecules/Logo.jsx";
import { nav } from "../../lib/navigation.js";
import { running } from "../../lib/format.js";
export function Sidebar({
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
}) {
  return (
    <aside className={mobile ? "sidebar open" : "sidebar"}>
      <Logo />
      <div className="workspace-switch">
        <Database size={18} />
        <div>
          <b>{data.organization?.name}</b>
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
        <button className="nav-item" onClick={() => navigate("Account")}>
          <Settings size={18} />
          Account & organizations
        </button>
        <button className="user" onClick={logout}>
          <span className="avatar">
            {data.user?.name?.slice(0, 2).toUpperCase()}
          </span>
          <span>
            <b>{data.user?.name}</b>
            <small>{data.role}</small>
          </span>
          <LogOut size={16} />
        </button>
      </div>
    </aside>
  );
}
