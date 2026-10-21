import { running } from "../../lib/format.js";
export function Badge({ status }) {
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
