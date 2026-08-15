import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Code2,
  Expand,
  ExternalLink,
  FileCode2,
  FolderOpen,
  LayoutDashboard,
  MonitorUp,
  Presentation,
  RefreshCw,
  RotateCcw,
} from "lucide-react";
import { IconButton } from "./components/IconButton";
import { EditorWorkspace } from "./components/EditorWorkspace";
import { LayoutSettings } from "./components/LayoutSettings";
import { PresenterWorkspace } from "./components/PresenterWorkspace";
import { StatusPill } from "./components/StatusPill";
import { useDeckSession } from "./hooks/useDeckSession";
import { useTimer } from "./hooks/useTimer";
import { api, chooseDeck } from "./lib/api";
import {
  defaultLayoutPreferences,
  parseLayoutPreferences,
  type LayoutKind,
  type PaneContent,
} from "./lib/layout";
import { actionForKey } from "./lib/navigation";

const LAYOUT_STORAGE_KEY = "typst-presenter.layout.v1";

export function PresenterApp() {
  const session = useDeckSession();
  const timer = useTimer();
  const { move, openDeck } = session;
  const { reset: resetTimer } = timer;
  const [actionError, setActionError] = useState<string | null>(null);
  const [typstStatus, setTypstStatus] = useState("Checking Typst…");
  const [layoutOpen, setLayoutOpen] = useState(false);
  const [editorMode, setEditorMode] = useState(false);
  const [audienceOpen, setAudienceOpen] = useState(false);
  const [layoutPreferences, setLayoutPreferences] = useState(loadLayoutPreferences);

  useEffect(() => {
    void api.typstStatus().then(setTypstStatus).catch((reason) => setTypstStatus(String(reason)));
  }, []);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen<boolean>("audience-state", (event) => {
      if (disposed) return;
      setAudienceOpen(event.payload);
      if (event.payload) setEditorMode(false);
    }).then((stop) => {
      if (disposed) stop();
      else unlisten = stop;
    });
    void api.audienceOpen().then((open) => {
      if (!disposed) setAudienceOpen(open);
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(layoutPreferences));
    } catch {
      // A locked-down WebView can deny storage; the in-memory layout still works.
    }
  }, [layoutPreferences]);

  const run = useCallback(async (action: () => Promise<unknown>) => {
    setActionError(null);
    try {
      await action();
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : String(reason));
    }
  }, []);

  const selectDeck = useCallback(async () => {
    const path = await chooseDeck();
    if (path) {
      resetTimer();
      await openDeck(path);
    }
  }, [openDeck, resetTimer]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (layoutOpen || editorMode) return;
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, select, textarea, [contenteditable=true]")) return;
      const action = actionForKey(event.key);
      if (action) {
        event.preventDefault();
        void move(action);
      } else if (event.key.toLowerCase() === "f") {
        event.preventDefault();
        void run(api.toggleAudienceFullscreen);
      } else if (event.key.toLowerCase() === "r") {
        event.preventDefault();
        resetTimer();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [editorMode, layoutOpen, move, resetTimer, run]);

  const note = useMemo(
    () => session.build?.notes.find((item) => item.page === session.currentPage),
    [session.build?.notes, session.currentPage],
  );
  const sourceName = session.build ? fileName(session.build.sourcePath) : null;
  const diagnostics = session.build?.status === "error" ? session.build.diagnostics : [];
  const visibleError = session.error ?? actionError;
  const layoutKind = layoutPreferences.kind;
  const layoutAssignments = layoutPreferences.assignments[layoutKind];

  const changeLayoutKind = useCallback((kind: LayoutKind) => {
    setLayoutPreferences((current) => ({ ...current, kind }));
  }, []);

  const changePaneContent = useCallback((index: number, content: PaneContent) => {
    setLayoutPreferences((current) => {
      const assignments = [...current.assignments[current.kind]];
      const duplicateIndex = assignments.indexOf(content);
      if (duplicateIndex >= 0 && duplicateIndex !== index) {
        assignments[duplicateIndex] = assignments[index];
      }
      assignments[index] = content;
      return {
        ...current,
        assignments: { ...current.assignments, [current.kind]: assignments },
      };
    });
  }, []);

  const changeSplit = useCallback((split: number) => {
    setLayoutPreferences((current) => ({
      ...current,
      splits: { ...current.splits, [current.kind]: split },
    }));
  }, []);

  if (!session.document && !session.build) {
    return (
      <main className="welcome-shell">
        <div className="welcome-glow" />
        <section className="welcome-card">
          <div className="brand-mark brand-mark--large">T</div>
          <p className="eyebrow">Typst Presenter</p>
          <h1>Your source keeps moving.<br />Your slides keep up.</h1>
          <p className="welcome-copy">
            Edit in any editor. The audience sees the last good PDF while your presenter view
            follows Touying notes, pauses, and every saved change.
          </p>
          <button className="primary-button" onClick={() => void selectDeck()} disabled={session.loading}>
            <FolderOpen size={18} /> Open a .typ deck
          </button>
          <div className="welcome-status">
            <span className={typstStatus.startsWith("typst ") ? "status-dot" : "status-dot status-dot--error"} />
            {typstStatus}
          </div>
          {visibleError && <p className="inline-error">{visibleError}</p>}
        </section>
      </main>
    );
  }

  return (
    <>
    <main className="app-shell">
      <header className="app-header">
        <div className="brand-cluster">
          <div className="brand-mark">T</div>
          <div>
            <div className="app-title">Typst Presenter</div>
            <div className="deck-name"><FileCode2 size={12} /> {sourceName ?? "No deck"}</div>
          </div>
        </div>

        <StatusPill build={session.build} loading={session.loading} />

        <div className="header-actions">
          <IconButton
            icon={<LayoutDashboard size={18} />}
            label="Configure presenter layout"
            onClick={() => setLayoutOpen(true)}
          />
          {!audienceOpen && (
            <button className="secondary-button mode-button" onClick={() => setEditorMode((value) => !value)}>
              {editorMode ? <Presentation size={17} /> : <Code2 size={17} />}
              {editorMode ? "Presenter view" : "Edit source"}
            </button>
          )}
          <IconButton icon={<FolderOpen size={18} />} label="Open deck" onClick={() => void selectDeck()} />
          <IconButton icon={<RefreshCw size={18} />} label="Rebuild now" onClick={() => void session.rebuild()} />
          <IconButton
            icon={<ExternalLink size={18} />}
            label="Open current PDF"
            onClick={() => void run(api.openCurrentPdf)}
            disabled={!session.document}
          />
          <button className="secondary-button" onClick={() => void run(api.openAudience)}>
            <MonitorUp size={17} /> Audience window
          </button>
          <IconButton
            icon={<Expand size={18} />}
            label="Toggle audience fullscreen (F)"
            onClick={() => void run(api.toggleAudienceFullscreen)}
          />
        </div>
      </header>

      {editorMode ? (
        <EditorWorkspace
          key={session.build?.sourcePath}
          build={session.build}
          document={session.document}
          currentPage={session.currentPage}
          note={note}
        />
      ) : (
        <PresenterWorkspace
          kind={layoutKind}
          assignments={layoutAssignments}
          split={layoutPreferences.splits[layoutKind]}
          document={session.document}
          currentPage={session.currentPage}
          pageCount={session.pageCount}
          note={note}
          onSplitChange={changeSplit}
        />
      )}

      {(diagnostics.length > 0 || visibleError) && (
        <section className="diagnostics" role="alert">
          <strong>{visibleError ? "Application error" : "Typst build failed — showing the last good PDF"}</strong>
          <pre>{visibleError ?? diagnostics.join("\n")}</pre>
        </section>
      )}

      <footer className="transport">
        <div className="timer-block">
          <span className="timer-label">Elapsed</span>
          <span className="timer-value">{timer.value}</span>
          <IconButton icon={<RotateCcw size={15} />} label="Reset timer (R)" onClick={timer.reset} />
        </div>

        <div className="transport-controls">
          <IconButton
            icon={<ChevronLeft size={24} />}
            label="Previous slide"
            onClick={() => void session.move({ type: "previous" })}
            disabled={session.currentPage <= 0}
          />
          <input
            aria-label="Current slide"
            className="slide-scrubber"
            type="range"
            min={0}
            max={Math.max(0, session.pageCount - 1)}
            value={Math.min(session.currentPage, Math.max(0, session.pageCount - 1))}
            onChange={(event) => void session.move({ type: "go", page: Number(event.target.value) })}
          />
          <IconButton
            icon={<ChevronRight size={24} />}
            label="Next slide"
            onClick={() => void session.move({ type: "next" })}
            disabled={session.currentPage >= session.pageCount - 1}
          />
        </div>

        <div className="build-meta">
          <span>rev {session.build?.revision ?? "—"}</span>
          <span>{session.build?.typstVersion ?? typstStatus}</span>
        </div>
      </footer>
    </main>
    <LayoutSettings
      open={layoutOpen}
      kind={layoutKind}
      assignments={layoutAssignments}
      onKindChange={changeLayoutKind}
      onAssignmentChange={changePaneContent}
      onClose={() => setLayoutOpen(false)}
    />
    </>
  );
}

function fileName(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

function loadLayoutPreferences() {
  try {
    return parseLayoutPreferences(localStorage.getItem(LAYOUT_STORAGE_KEY));
  } catch {
    return defaultLayoutPreferences();
  }
}
