import { normalizeTinymistPreviewUrl } from "../lib/sourceNavigation";

export type TinymistPreviewStatus = "idle" | "starting" | "ready" | "error";

export interface TinymistPreviewProps {
  url: string | null;
  status: TinymistPreviewStatus;
  error?: string | null;
}

/**
 * Embed Tinymist's local Web/SVG preview in the editing workspace.
 *
 * The URL is validated at the UI boundary as well as in the backend-facing
 * helper. Presenter and audience surfaces intentionally do not use this
 * component; it is an editor-only preview path.
 */
export function TinymistPreview({ url, status, error }: TinymistPreviewProps) {
  const previewUrl = url ? normalizeTinymistPreviewUrl(url) : null;

  if (status === "ready" && previewUrl) {
    return (
      <section className="tinymist-preview tinymist-preview--ready" aria-label="Tinymist rendered slide preview">
        <iframe
          className="tinymist-preview__frame"
          src={previewUrl}
          title="Tinymist rendered slide preview"
          sandbox="allow-scripts allow-same-origin"
          referrerPolicy="no-referrer"
        />
      </section>
    );
  }

  const message = previewMessage(status, error, Boolean(url) && !previewUrl);
  const isError = status === "error" || (status === "ready" && Boolean(url) && !previewUrl);

  return (
    <section
      className={`tinymist-preview tinymist-preview--${isError ? "error" : status}`}
      aria-label="Tinymist rendered slide preview"
      aria-busy={status === "starting"}
    >
      <div className="tinymist-preview__status" role={isError ? "alert" : "status"} aria-live="polite">
        <strong>{statusTitle(status, isError)}</strong>
        <span>{message}</span>
      </div>
    </section>
  );
}

function statusTitle(status: TinymistPreviewStatus, isError: boolean): string {
  if (isError) return "Tinymist preview unavailable";
  if (status === "starting") return "Starting Tinymist preview";
  if (status === "ready") return "Tinymist preview waiting for a URL";
  return "Tinymist preview idle";
}

function previewMessage(status: TinymistPreviewStatus, error: string | null | undefined, invalidUrl: boolean): string {
  if (invalidUrl) {
    return "The preview URL was blocked because it is not a localhost Tinymist address. Restart the preview to obtain a safe URL.";
  }
  if (status === "starting") return "The local preview server is starting. This normally takes a few seconds.";
  if (status === "error") {
    const detail = error?.trim();
    return detail
      ? `${detail} Check that Tinymist is installed and restart the preview.`
      : "Check that Tinymist is installed and restart the preview.";
  }
  if (status === "ready") return "Tinymist did not provide a preview URL. Restart the preview from the editor.";
  return "Start Tinymist from the editor to render the current slide.";
}

export default TinymistPreview;
