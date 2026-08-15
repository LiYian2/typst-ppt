import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";

interface PdfPageProps {
  document: PDFDocumentProxy | null;
  page: number;
  label: string;
  dimmed?: boolean;
}

export function PdfPage({ document, page, label, dimmed = false }: PdfPageProps) {
  const frameRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [rendering, setRendering] = useState(false);
  const [renderError, setRenderError] = useState<string | null>(null);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const observer = new ResizeObserver(([entry]) => {
      setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!document || !canvas || size.width < 2 || size.height < 2 || page < 0) return;
    if (page >= document.numPages) return;

    let cancelled = false;
    let task: RenderTask | null = null;
    setRendering(true);
    setRenderError(null);

    void document.getPage(page + 1).then((pdfPage) => {
      if (cancelled) return;
      const base = pdfPage.getViewport({ scale: 1 });
      const cssScale = Math.min(size.width / base.width, size.height / base.height);
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      const viewport = pdfPage.getViewport({ scale: cssScale * pixelRatio });
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) return;

      canvas.width = Math.max(1, Math.floor(viewport.width));
      canvas.height = Math.max(1, Math.floor(viewport.height));
      canvas.style.width = `${viewport.width / pixelRatio}px`;
      canvas.style.height = `${viewport.height / pixelRatio}px`;
      // The context-only API is the compatibility path documented by PDF.js.
      // Passing both values makes recent PDF.js releases ignore the supplied
      // context and ask WebKit for another one with different attributes, which
      // can leave a blank canvas in WKWebView.
      task = pdfPage.render({ canvas: null, canvasContext: context, viewport });
      return task.promise;
    }).then(() => {
      if (!cancelled) setRendering(false);
    }).catch((reason: unknown) => {
      if (cancelled || isRenderingCancelled(reason)) return;
      setRendering(false);
      setRenderError(errorMessage(reason));
    });

    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [document, page, size.height, size.width]);

  return (
    <div className={`pdf-page ${dimmed ? "pdf-page--dimmed" : ""}`} ref={frameRef} aria-label={label}>
      <canvas ref={canvasRef} />
      {rendering && <div className="pdf-page__loading">Rendering…</div>}
      {renderError && <div className="pdf-page__error" role="alert">{renderError}</div>}
      {!document && <div className="pdf-page__empty">No slide loaded</div>}
    </div>
  );
}

function isRenderingCancelled(reason: unknown): boolean {
  return reason instanceof Error && reason.name === "RenderingCancelledException";
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}
