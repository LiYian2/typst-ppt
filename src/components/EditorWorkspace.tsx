import { useCallback, useEffect, useRef, useState } from "react";
import type { EditorView } from "@codemirror/view";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { CircleCheck, LoaderCircle } from "lucide-react";
import type { BuildSnapshot, SpeakerNote, SourceDocument } from "../types";
import {
  tinymistPageScrollRequest,
  useTinymistSession,
  type TinymistSourceJump,
} from "../hooks/useTinymistSession";
import { api } from "../lib/api";
import { pdfPageCrop } from "../lib/pdfLayout";
import { uriToFilePath } from "../lib/tinymistTransport";
import { TinymistPreview, type TinymistPreviewStatus } from "./TinymistPreview";
import { TypstEditor } from "./TypstEditor";

interface EditorWorkspaceProps {
  build: BuildSnapshot | null;
  document: PDFDocumentProxy | null;
  currentPage: number;
  note?: SpeakerNote;
}

type SaveState = "saved" | "dirty" | "saving" | "error";

export function EditorWorkspace({
  build,
  document,
  currentPage,
  note,
}: EditorWorkspaceProps) {
  const [source, setSource] = useState<SourceDocument | null>(null);
  const [text, setText] = useState("");
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [navigationError, setNavigationError] = useState<string | null>(null);
  const [jump, setJump] = useState<TinymistSourceJump | null>(null);
  const [cropSecondScreen, setCropSecondScreen] = useState(false);
  const textRef = useRef("");
  const sourceRef = useRef<SourceDocument | null>(null);
  const timerRef = useRef<number | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const pendingViewRef = useRef<{
    path: string;
    resolve: (view: EditorView | null) => void;
  } | null>(null);

  const setActiveSource = useCallback((next: SourceDocument) => {
    sourceRef.current = next;
    textRef.current = next.text;
    setSource(next);
    setText(next.text);
    setSaveState("saved");
    setLoadError(null);
    setNavigationError(null);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void api.sourceDocument().then((next) => {
      if (cancelled) return;
      setActiveSource(next);
    }).catch((reason) => {
      if (!cancelled) setLoadError(errorMessage(reason));
    });
    return () => {
      cancelled = true;
      const active = sourceRef.current;
      if (timerRef.current !== null && active) void api.saveSource(textRef.current, active.path);
      pendingViewRef.current?.resolve(null);
    };
  }, [setActiveSource]);

  const saveNow = useCallback(async () => {
    if (!source) return;
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    setSaveState("saving");
    try {
      await api.saveSource(textRef.current, source.path);
      setSaveState("saved");
    } catch {
      setSaveState("error");
    }
  }, [source]);

  const openSource = useCallback(async (path: string, nextJump?: TinymistSourceJump | null) => {
    const active = sourceRef.current;
    if (active && pathsMatch(active.path, path)) {
      if (nextJump) setJump(nextJump);
      return active;
    }
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    if (active) await api.saveSource(textRef.current, active.path);
    const next = await api.sourceDocument(path);
    setActiveSource(next);
    setJump(nextJump ?? null);
    return next;
  }, [setActiveSource]);

  const handleSourceJump = useCallback((nextJump: TinymistSourceJump) => {
    const path = uriToFilePath(nextJump.filepath) ?? nextJump.filepath;
    void openSource(path, nextJump).catch((reason) => setNavigationError(errorMessage(reason)));
  }, [openSource]);

  const handleOpenUri = useCallback(async (uri: string): Promise<EditorView | null> => {
    const path = uriToFilePath(uri);
    if (!path) return null;
    if (sourceRef.current && pathsMatch(sourceRef.current.path, path) && viewRef.current) {
      return viewRef.current;
    }
    pendingViewRef.current?.resolve(null);
    return new Promise<EditorView | null>((resolve) => {
      pendingViewRef.current = { path, resolve };
      void openSource(path).catch((reason) => {
        if (pendingViewRef.current?.resolve === resolve) pendingViewRef.current = null;
        setNavigationError(errorMessage(reason));
        resolve(null);
      });
    });
  }, [openSource]);

  const handleViewReady = useCallback((view: EditorView | null) => {
    viewRef.current = view;
    const pending = pendingViewRef.current;
    const active = sourceRef.current;
    if (!view || !pending || !active || !pathsMatch(active.path, pending.path)) return;
    pendingViewRef.current = null;
    pending.resolve(view);
  }, []);

  const tinymist = useTinymistSession(build?.sourcePath ?? null, handleSourceJump, handleOpenUri);

  useEffect(() => {
    if (!tinymist.client || !tinymist.previewUrl) return;
    void tinymist.client.request("workspace/executeCommand", tinymistPageScrollRequest(currentPage)).catch(() => {
      // Preview scroll sync is best-effort and never affects the PDF presentation path.
    });
  }, [currentPage, tinymist.client, tinymist.previewUrl]);

  useEffect(() => {
    let cancelled = false;
    if (!document || currentPage < 0 || currentPage >= document.numPages) {
      setCropSecondScreen(false);
      return;
    }
    void document.getPage(currentPage + 1).then((page) => {
      if (cancelled) return;
      const viewport = page.getViewport({ scale: 1 });
      setCropSecondScreen(pdfPageCrop(viewport.width, viewport.height).cropped);
    }).catch(() => {
      if (!cancelled) setCropSecondScreen(false);
    });
    return () => {
      cancelled = true;
    };
  }, [currentPage, document]);

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
          <span className="editor-file-name">
            {fileName(source.path)}
            {navigationError && <span className="editor-nav-error" role="alert">{navigationError}</span>}
          </span>
          <span className={`save-state save-state--${saveState}`}>
            {saveState === "saving" && <LoaderCircle className="spin" size={11} />}
            {saveState === "saved" && <CircleCheck size={11} />}
            {saveLabel(saveState)}
          </span>
        </div>
        <TypstEditor
          value={text}
          path={source.path}
          client={tinymist.client}
          jump={jump}
          fallbackDiagnostics={build?.diagnostics ?? []}
          onViewReady={handleViewReady}
          onChange={changeText}
          onSave={() => void saveNow()}
        />
      </article>

      <section className="editor-preview">
        <article className="panel editor-slide-panel">
          <div className="panel-label">
            <span>Live slide preview</span>
            <span className={`tinymist-state tinymist-state--${tinymist.status.phase}`}>
              {tinymist.status.version ?? tinymistLabel(tinymist.status.phase)}
            </span>
          </div>
          <TinymistPreview
            url={tinymist.previewUrl}
            status={previewStatus(tinymist.status.phase)}
            error={tinymist.error}
            cropSecondScreen={cropSecondScreen}
          />
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

function previewStatus(phase: string): TinymistPreviewStatus {
  if (phase === "ready") return "ready";
  if (phase === "error" || phase === "unavailable") return "error";
  if (phase === "checking" || phase === "starting") return "starting";
  return "idle";
}

function tinymistLabel(phase: string): string {
  if (phase === "checking") return "Checking Tinymist…";
  if (phase === "starting") return "Starting Tinymist…";
  if (phase === "unavailable") return "Tinymist unavailable";
  if (phase === "error") return "Tinymist error";
  return "Tinymist";
}

function pathsMatch(left: string, right: string): boolean {
  const normalizedLeft = left.replaceAll("\\", "/").replace(/\/$/, "");
  const normalizedRight = right.replaceAll("\\", "/").replace(/\/$/, "");
  return normalizedLeft === normalizedRight || normalizedLeft.toLowerCase() === normalizedRight.toLowerCase();
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
