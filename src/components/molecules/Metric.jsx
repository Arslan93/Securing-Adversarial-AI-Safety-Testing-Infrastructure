export function Metric({ icon: Icon, label, value, note, tone = "" }) {
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
