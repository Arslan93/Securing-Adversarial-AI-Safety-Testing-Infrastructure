import { Menu, Search, Bell } from "lucide-react";
export function AppHeader({
  page,
  data,
  search,
  setSearch,
  setPage,
  setDetail,
  setMobile,
  navigate,
}) {
  return (
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
        <span className="avatar small">
          {data.user?.name?.slice(0, 2).toUpperCase()}
        </span>
      </div>
    </header>
  );
}
