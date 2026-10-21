export function WorkspaceTemplate({
  sidebar,
  header,
  children,
  mobile,
  closeNavigation,
}) {
  return (
    <>
      {sidebar}
      {mobile && <div className="mobile-scrim" onClick={closeNavigation} />}
      <div className="main-shell">
        {header}
        {children}
      </div>
    </>
  );
}
