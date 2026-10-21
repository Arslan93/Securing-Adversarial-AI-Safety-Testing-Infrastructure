import { Plus } from "lucide-react";
export function Empty({ icon: Icon, title, text, action }) {
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
