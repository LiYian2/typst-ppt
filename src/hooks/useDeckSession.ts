import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  getDocument,
  GlobalWorkerOptions,
  type PDFDocumentLoadingTask,
  type PDFDocumentProxy,
} from "pdfjs-dist";
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { api } from "../lib/api";
import { navigate, type NavigationAction } from "../lib/navigation";
import type { BuildSnapshot, PresentationState } from "../types";

GlobalWorkerOptions.workerSrc = pdfWorker;

export function useDeckSession() {
  const [build, setBuild] = useState<BuildSnapshot | null>(null);
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [currentPage, setCurrentPageLocal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadedOutputPath = useRef<string | null>(null);
  const loadingOutputPath = useRef<string | null>(null);
  const pdfRequest = useRef(0);
  const documentRef = useRef<PDFDocumentProxy | null>(null);
  const loadingTaskRef = useRef<PDFDocumentLoadingTask | null>(null);
  const pageRef = useRef(0);

  const loadPdf = useCallback(async (snapshot: BuildSnapshot) => {
    if (!snapshot.outputPath) return;
    if (loadedOutputPath.current === snapshot.outputPath) return;
    if (loadingOutputPath.current === snapshot.outputPath) return;

    loadingOutputPath.current = snapshot.outputPath;
    const request = ++pdfRequest.current;
    try {
      const raw = await api.pdfBytes();
      const bytes = raw instanceof ArrayBuffer ? new Uint8Array(raw) : new Uint8Array(raw);
      const nextTask = getDocument({ data: bytes });
      const nextDocument = await nextTask.promise;
      if (request !== pdfRequest.current) {
        await nextTask.destroy();
        return;
      }
      const previousTask = loadingTaskRef.current;
      documentRef.current = nextDocument;
      loadingTaskRef.current = nextTask;
      loadedOutputPath.current = snapshot.outputPath;
      setDocument(nextDocument);
      if (previousTask) void previousTask.destroy();

      const clamped = navigate(pageRef.current, nextDocument.numPages, {
        type: "go",
        page: pageRef.current,
      });
      if (clamped !== pageRef.current) {
        pageRef.current = clamped;
        setCurrentPageLocal(clamped);
        await api.setCurrentPage(clamped);
      }
    } finally {
      if (loadingOutputPath.current === snapshot.outputPath) loadingOutputPath.current = null;
    }
  }, []);

  const acceptBuild = useCallback(
    async (snapshot: BuildSnapshot) => {
      setBuild(snapshot);
      setError(null);
      if (snapshot.outputPath) {
        try {
          await loadPdf(snapshot);
        } catch (reason) {
          setError(errorMessage(reason));
        }
      }
    },
    [loadPdf],
  );

  useEffect(() => {
    let disposed = false;
    const unlisteners: Array<() => void> = [];

    const initialise = async () => {
      const [unlistenBuild, unlistenPresentation] = await Promise.all([
        listen<BuildSnapshot>("deck-build", (event) => {
          if (!disposed) void acceptBuild(event.payload);
        }),
        listen<PresentationState>("presentation-state", (event) => {
          if (!disposed) {
            pageRef.current = event.payload.currentPage;
            setCurrentPageLocal(event.payload.currentPage);
          }
        }),
      ]);
      if (disposed) {
        unlistenBuild();
        unlistenPresentation();
        return;
      }
      unlisteners.push(unlistenBuild, unlistenPresentation);

      const snapshot = await api.sessionSnapshot();
      if (snapshot && !disposed) await acceptBuild(snapshot);
      try {
        const presentation = await api.presentationState();
        if (!disposed) {
          pageRef.current = presentation.currentPage;
          setCurrentPageLocal(presentation.currentPage);
        }
      } catch {
        // No deck is open on first launch.
      }
    };

    void initialise().catch((reason) => setError(errorMessage(reason)));
    return () => {
      disposed = true;
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, [acceptBuild]);

  useEffect(
    () => () => {
      if (loadingTaskRef.current) void loadingTaskRef.current.destroy();
    },
    [],
  );

  const openDeck = useCallback(
    async (path: string) => {
      setLoading(true);
      setError(null);
      loadedOutputPath.current = null;
      loadingOutputPath.current = null;
      pdfRequest.current += 1;
      const previousTask = loadingTaskRef.current;
      documentRef.current = null;
      loadingTaskRef.current = null;
      setDocument(null);
      if (previousTask) void previousTask.destroy();
      try {
        const snapshot = await api.loadDeck(path);
        await acceptBuild(snapshot);
        pageRef.current = 0;
        setCurrentPageLocal(0);
      } catch (reason) {
        setError(errorMessage(reason));
      } finally {
        setLoading(false);
      }
    },
    [acceptBuild],
  );

  const rebuild = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await acceptBuild(await api.rebuild());
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setLoading(false);
    }
  }, [acceptBuild]);

  const move = useCallback(
    async (action: NavigationAction) => {
      if (!documentRef.current) return;
      const next = navigate(pageRef.current, documentRef.current.numPages, action);
      if (next === pageRef.current) return;
      pageRef.current = next;
      setCurrentPageLocal(next);
      try {
        await api.setCurrentPage(next);
      } catch (reason) {
        setError(errorMessage(reason));
      }
    },
    [],
  );

  return {
    build,
    document,
    pageCount: document?.numPages ?? 0,
    currentPage,
    loading,
    error,
    openDeck,
    rebuild,
    move,
  };
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}
