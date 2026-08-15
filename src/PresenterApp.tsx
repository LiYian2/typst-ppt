import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Expand,
  ExternalLink,
  FileCode2,
  FolderOpen,
  MonitorUp,
  RefreshCw,
  RotateCcw,
} from "lucide-react";
import { IconButton } from "./components/IconButton";
import { PdfPage } from "./components/PdfPage";
import { StatusPill } from "./components/StatusPill";
import { useDeckSession } from "./hooks/useDeckSession";
import { useTimer } from "./hooks/useTimer";
import { api, chooseDeck } from "./lib/api";
import { actionForKey } from "./lib/navigation";

export function PresenterApp() {
  const session = useDeckSession();
  const timer = useTimer();
  const { move, openDeck } = session;
  const { reset: resetTimer } = timer;
  const [actionError, setActionError] = useState<string | null>(null);
  const [typstStatus, setTypstStatus] = useState("Checking Typst…");

  useEffect(() => {
    void api.typstStatus().then(setTypstStatus).catch((reason) => setTypstStatus(String(reason)));
  }, []);

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
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, [contenteditable=true]")) return;
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
  }, [move, resetTimer, run]);

  const note = useMemo(
    () => session.build?.notes.find((item) => item.page === session.currentPage),
    [session.build?.notes, session.currentPage],
  );
  const sourceName = session.build ? fileName(session.build.sourcePath) : null;
  const diagnostics = session.build?.status === "error" ? session.build.diagnostics : [];
  const visibleError = session.error ?? actionError;

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

      <section className="presenter-grid">
        <article className="panel current-panel">
          <div className="panel-label">
            <span>On air</span>
            <span>{session.currentPage + 1} / {session.pageCount}</span>
          </div>
          <PdfPage document={session.document} page={session.currentPage} label="Current slide" />
        </article>

        <aside className="side-stack">
          <article className="panel next-panel">
            <div className="panel-label">
              <span>Next</span>
              <span>{Math.min(session.currentPage + 2, session.pageCount)} / {session.pageCount}</span>
            </div>
            {session.currentPage + 1 < session.pageCount ? (
              <PdfPage document={session.document} page={session.currentPage + 1} label="Next slide" dimmed />
            ) : (
              <div className="end-card">End of deck</div>
            )}
          </article>

          <article className="panel notes-panel">
            <div className="panel-label">
              <span>Speaker notes</span>
              {note?.label && <span>slide {note.label}{note.overlay ? ` · step ${note.overlay}` : ""}</span>}
            </div>
            <div className={note?.text ? "notes-copy" : "notes-copy notes-copy--empty"}>
              {note?.text || "No notes for this slide."}
            </div>
          </article>
        </aside>
      </section>

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
  );
}

function fileName(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}
