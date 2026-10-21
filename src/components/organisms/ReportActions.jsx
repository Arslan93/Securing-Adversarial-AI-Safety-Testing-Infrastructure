import { Download, FileText } from "lucide-react";
export function ReportActions({ onReport, busy }) {
  return (
    <div
      className="inline report-actions"
      aria-label="Download redacted reports"
    >
      <button
        className="secondary"
        disabled={busy}
        onClick={() => onReport("html")}
      >
        <FileText size={15} />
        Printable report
      </button>
      <button
        className="secondary"
        disabled={busy}
        onClick={() => onReport("csv")}
      >
        <Download size={15} />
        Case CSV
      </button>
    </div>
  );
}
