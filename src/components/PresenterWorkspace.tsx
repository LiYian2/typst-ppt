import { useRef, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { clampSplit, type LayoutKind, type PaneContent } from "../lib/layout";
import type { SpeakerNote } from "../types";
import { PdfPage } from "./PdfPage";

interface PresenterWorkspaceProps {
  kind: LayoutKind;
  assignments: PaneContent[];
  split: number;
  document: PDFDocumentProxy | null;
  currentPage: number;
  pageCount: number;
  note?: SpeakerNote;
  onSplitChange: (value: number) => void;
}

export function PresenterWorkspace({
  kind,
  assignments,
  split,
  document,
  currentPage,
  pageCount,
  note,
  onSplitChange,
}: PresenterWorkspaceProps) {
  const workspaceRef = useRef<HTMLElement>(null);
  const style = {
    "--left-pane": `${split}fr`,
    "--right-pane": `${100 - split}fr`,
  } as CSSProperties;

  const updateFromClientX = (clientX: number) => {
    const bounds = workspaceRef.current?.getBoundingClientRect();
    if (!bounds || bounds.width <= 0) return;
    onSplitChange(clampSplit(((clientX - bounds.left) / bounds.width) * 100));
  };

  const beginResize = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    updateFromClientX(event.clientX);
    globalThis.document.body.classList.add("is-resizing-layout");

    const resize = (moveEvent: globalThis.PointerEvent) => {
      updateFromClientX(moveEvent.clientX);
    };
    const finish = () => {
      globalThis.document.body.classList.remove("is-resizing-layout");
      window.removeEventListener("pointermove", resize);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
    };
    window.addEventListener("pointermove", resize);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
  };

  const resizeWithKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    event.stopPropagation();
    onSplitChange(clampSplit(split + (event.key === "ArrowLeft" ? -2 : 2)));
  };

  const divider = (
    <div
      className="workspace-divider"
      role="separator"
      aria-label="Resize presenter panes"
      aria-orientation="vertical"
      aria-valuemin={25}
      aria-valuemax={75}
      aria-valuenow={split}
      tabIndex={0}
      onPointerDown={beginResize}
      onKeyDown={resizeWithKeyboard}
    >
      <span />
    </div>
  );

  const pane = (content: PaneContent, key: string) => {
    if (content === "current") {
      return (
        <article className="panel workspace-pane current-panel" key={key}>
          <div className="panel-label">
            <span>On air</span>
            <span>{currentPage + 1} / {pageCount}</span>
          </div>
          <PdfPage document={document} page={currentPage} label="Current slide" />
        </article>
      );
    }

    if (content === "next") {
      return (
        <article className="panel workspace-pane next-panel" key={key}>
          <div className="panel-label">
            <span>Next</span>
            <span>{Math.min(currentPage + 2, pageCount)} / {pageCount}</span>
          </div>
          {currentPage + 1 < pageCount ? (
            <PdfPage document={document} page={currentPage + 1} label="Next slide" dimmed />
          ) : (
            <div className="end-card">End of deck</div>
          )}
        </article>
      );
    }

    return (
      <article className="panel workspace-pane notes-panel" key={key}>
        <div className="panel-label">
          <span>Speaker notes</span>
          {note?.label && <span>slide {note.label}{note.overlay ? ` · step ${note.overlay}` : ""}</span>}
        </div>
        <div className={note?.text ? "notes-copy" : "notes-copy notes-copy--empty"}>
          {note?.text || "No notes for this slide."}
        </div>
      </article>
    );
  };

  if (kind === "single") {
    return (
      <section className="presenter-workspace presenter-workspace--single" ref={workspaceRef}>
        {pane(assignments[0] ?? "current", "single")}
      </section>
    );
  }

  if (kind === "double") {
    return (
      <section className="presenter-workspace presenter-workspace--split" ref={workspaceRef} style={style}>
        {pane(assignments[0] ?? "current", "double-left")}
        {divider}
        {pane(assignments[1] ?? "notes", "double-right")}
      </section>
    );
  }

  if (kind === "triple-right") {
    return (
      <section className="presenter-workspace presenter-workspace--split" ref={workspaceRef} style={style}>
        <aside className="workspace-stack">
          {pane(assignments[0] ?? "next", "triple-right-top")}
          {pane(assignments[1] ?? "notes", "triple-right-bottom")}
        </aside>
        {divider}
        {pane(assignments[2] ?? "current", "triple-right-main")}
      </section>
    );
  }

  return (
    <section className="presenter-workspace presenter-workspace--split" ref={workspaceRef} style={style}>
      {pane(assignments[0] ?? "current", "triple-left-main")}
      {divider}
      <aside className="workspace-stack">
        {pane(assignments[1] ?? "next", "triple-left-top")}
        {pane(assignments[2] ?? "notes", "triple-left-bottom")}
      </aside>
    </section>
  );
}
