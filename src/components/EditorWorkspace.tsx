import { useCallback, useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { ChevronLeft, ChevronRight, CircleCheck, LoaderCircle } from "lucide-react";
import type { BuildSnapshot, SpeakerNote, SourceDocument } from "../types";
import { api } from "../lib/api";
import { IconButton } from "./IconButton";
import { PdfPage } from "./PdfPage";
import { TypstEditor } from "./TypstEditor";

interface EditorWorkspaceProps {
  build: BuildSnapshot | null;
  document: PDFDocumentProxy | null;
  currentPage: number;
  pageCount: number;
  note?: SpeakerNote;
  onPrevious: () => void;
  onNext: () => void;
}

type SaveState = "saved" | "dirty" | "saving" | "error";

export function EditorWorkspace({
  build,
  document,
  currentPage,
  pageCount,
  note,
  onPrevious,
  onNext,
}: EditorWorkspaceProps) {
  const [source, setSource] = useState<SourceDocument | null>(null);
  const [text, setText] = useState("");
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [loadError, setLoadError] = useState<string | null>(null);
  const textRef = useRef("");
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    void api.sourceDocument().then((next) => {
      if (cancelled) return;
      setSource(next);
      setText(next.text);
      textRef.current = next.text;
      setLoadError(null);
    }).catch((reason) => {
      if (!cancelled) setLoadError(errorMessage(reason));
    });
    return () => {
      cancelled = true;
      if (timerRef.current !== null) void api.saveSource(textRef.current);
    };
  }, []);

  const saveNow = useCallback(async () => {
    if (!source) return;
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    setSaveState("saving");
    try {
      await api.saveSource(textRef.current);
      setSaveState("saved");
    } catch {
      setSaveState("error");
    }
  }, [source]);

  const changeText = useCallback((next: string) => {
    textRef.current = next;
    setText(next);
    setSaveState("dirty");
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => void saveNow(), 420);
  }, [saveNow]);

  if (loadError) return <section className="editor-load-error">{loadError}</section>;
  if (!source) return <section className="editor-loading"><LoaderCircle className="spin" size={18} /> Loading source…</section>;

  return (
    <section className="editor-workspace">
      <article className="editor-code-panel">
        <div className="editor-panel-bar">
          <span>{fileName(source.path)}</span>
          <span className={`save-state save-state--${saveState}`}>
            {saveState === "saving" && <LoaderCircle className="spin" size={11} />}
            {saveState === "saved" && <CircleCheck size={11} />}
            {saveLabel(saveState)}
          </span>
        </div>
        <TypstEditor value={text} diagnostics={build?.diagnostics ?? []} onChange={changeText} onSave={() => void saveNow()} />
      </article>

      <section className="editor-preview">
        <article className="panel editor-slide-panel">
          <div className="panel-label">
            <span>Rendered slide</span>
            <span className="editor-page-controls">
              <IconButton icon={<ChevronLeft size={15} />} label="Previous slide" onClick={onPrevious} disabled={currentPage <= 0} />
              <span>{currentPage + 1} / {pageCount}</span>
              <IconButton icon={<ChevronRight size={15} />} label="Next slide" onClick={onNext} disabled={currentPage >= pageCount - 1} />
            </span>
          </div>
          <PdfPage document={document} page={currentPage} label="Rendered current slide" />
        </article>
        <article className="panel notes-panel editor-notes-panel">
          <div className="panel-label"><span>Speaker notes</span></div>
          <div className={note?.text ? "notes-copy" : "notes-copy notes-copy--empty"}>
            {note?.text || "No notes for this slide."}
          </div>
        </article>
      </section>
    </section>
  );
}

function fileName(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

function saveLabel(state: SaveState): string {
  if (state === "dirty") return "Unsaved";
  if (state === "saving") return "Saving…";
  if (state === "error") return "Save failed";
  return "Saved";
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}
