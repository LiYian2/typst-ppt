import { useEffect } from "react";
import { PdfPage } from "./components/PdfPage";
import { useDeckSession } from "./hooks/useDeckSession";
import { api } from "./lib/api";
import { actionForKey } from "./lib/navigation";

export function AudienceApp() {
  const session = useDeckSession();
  const { move } = session;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const action = actionForKey(event.key);
      if (action) {
        event.preventDefault();
        void move(action);
      } else if (event.key.toLowerCase() === "f") {
        event.preventDefault();
        void api.toggleAudienceFullscreen();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [move]);

  return (
    <main
      className="audience-shell"
      onDoubleClick={() => void api.toggleAudienceFullscreen()}
      title="Double-click to toggle fullscreen"
    >
      <PdfPage document={session.document} page={session.currentPage} label="Audience slide" />
      {session.build?.status === "error" && (
        <span className="audience-build-warning" title="Build failed; showing the last good PDF" />
      )}
      {session.error && !session.document && <div className="audience-error">{session.error}</div>}
    </main>
  );
}
