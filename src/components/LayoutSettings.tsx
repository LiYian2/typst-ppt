import { useEffect } from "react";
import { X } from "lucide-react";
import {
  LAYOUT_KINDS,
  PANE_CONTENTS,
  type LayoutKind,
  type PaneContent,
} from "../lib/layout";

interface LayoutSettingsProps {
  open: boolean;
  kind: LayoutKind;
  assignments: PaneContent[];
  onKindChange: (kind: LayoutKind) => void;
  onAssignmentChange: (index: number, content: PaneContent) => void;
  onClose: () => void;
}

const LAYOUT_LABELS: Record<LayoutKind, string> = {
  single: "Single",
  double: "Double",
  "triple-left": "Triple Left",
  "triple-right": "Triple Right",
};

const SLOT_LABELS: Record<LayoutKind, string[]> = {
  single: ["Main pane"],
  double: ["Left pane", "Right pane"],
  "triple-left": ["Large left", "Top right", "Bottom right"],
  "triple-right": ["Top left", "Bottom left", "Large right"],
};

const CONTENT_LABELS: Record<PaneContent, string> = {
  current: "Current slide",
  next: "Next slide",
  notes: "Speaker notes",
};

export function LayoutSettings({
  open,
  kind,
  assignments,
  onKindChange,
  onAssignmentChange,
  onClose,
}: LayoutSettingsProps) {
  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose, open]);

  if (!open) return null;

  return (
    <div className="layout-dialog-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="layout-dialog" role="dialog" aria-modal="true" aria-labelledby="layout-dialog-title">
        <header className="layout-dialog__header">
          <div>
            <p className="eyebrow">Presenter display</p>
            <h2 id="layout-dialog-title">Layout</h2>
          </div>
          <button className="icon-button" aria-label="Close layout settings" onClick={onClose}>
            <X size={19} />
          </button>
        </header>

        <div className="layout-dialog__body">
          <div className="layout-choice-grid" role="radiogroup" aria-label="Presenter arrangement">
            {LAYOUT_KINDS.map((layoutKind) => (
              <button
                className={`layout-choice ${kind === layoutKind ? "layout-choice--active" : ""}`}
                type="button"
                role="radio"
                aria-checked={kind === layoutKind}
                key={layoutKind}
                onClick={() => onKindChange(layoutKind)}
              >
                <LayoutThumbnail kind={layoutKind} />
                <span>{LAYOUT_LABELS[layoutKind]}</span>
              </button>
            ))}
          </div>

          <div className="layout-assignment-section">
            <div>
              <h3>Pane content</h3>
              <p>Choose what appears in each area of this arrangement.</p>
            </div>
            <div className="layout-assignment-list">
              {SLOT_LABELS[kind].map((label, index) => (
                <label className="layout-assignment" key={label}>
                  <span>{label}</span>
                  <select
                    value={assignments[index]}
                    onChange={(event) => onAssignmentChange(index, event.target.value as PaneContent)}
                  >
                    {PANE_CONTENTS.map((content) => (
                      <option
                        value={content}
                        key={content}
                      >
                        {CONTENT_LABELS[content]}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          </div>

          {kind !== "single" && (
            <p className="layout-resize-hint">
              After closing this window, drag the vertical divider to resize the panes. Arrow keys work when the divider is focused.
            </p>
          )}
        </div>
      </section>
    </div>
  );
}

function LayoutThumbnail({ kind }: { kind: LayoutKind }) {
  if (kind === "single") {
    return <span className="layout-thumbnail layout-thumbnail--single"><i /></span>;
  }
  if (kind === "double") {
    return <span className="layout-thumbnail layout-thumbnail--double"><i /><i /></span>;
  }
  if (kind === "triple-right") {
    return <span className="layout-thumbnail layout-thumbnail--triple-right"><i /><i /><i /></span>;
  }
  return <span className="layout-thumbnail layout-thumbnail--triple-left"><i /><i /><i /></span>;
}
