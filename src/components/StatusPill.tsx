import { Check, CircleAlert, LoaderCircle } from "lucide-react";
import type { BuildSnapshot } from "../types";
import { pdfReadyLabel } from "../lib/buildStatus";

export function StatusPill({ build, loading }: { build: BuildSnapshot | null; loading: boolean }) {
  if (loading) {
    return (
      <span className="status-pill status-pill--building">
        <LoaderCircle size={14} className="spin" /> Building
      </span>
    );
  }
  if (!build) return <span className="status-pill">No deck</span>;
  if (build.status === "error") {
    return (
      <span className="status-pill status-pill--error">
        <CircleAlert size={14} /> Build error · last good PDF
      </span>
    );
  }
  return (
    <span
      className="status-pill status-pill--ready"
      title="Typst PDF compilation and speaker-note extraction time"
    >
      <Check size={14} /> {pdfReadyLabel(build.elapsedMs)}
    </span>
  );
}
