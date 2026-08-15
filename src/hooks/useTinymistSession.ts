import { LSPClient, languageServerExtensions } from "@codemirror/lsp-client";
import type { EditorView } from "@codemirror/view";
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import {
  createTauriTinymistChannel,
  createTinymistInitializationTransport,
  createTinymistTransport,
  filePathToUri,
  TINYMIST_SEMANTIC_TOKEN_TYPES,
} from "../lib/tinymistTransport";
import { createTinymistWorkspace } from "../lib/tinymistWorkspace";

const PREVIEW_TASK_ID = "typst-presenter-editor";

export type TinymistPhase = "idle" | "checking" | "starting" | "ready" | "unavailable" | "error";

export interface TinymistStatus {
  available: boolean;
  version?: string;
  executable?: string;
  error?: string;
  phase: TinymistPhase;
}

export interface TinymistSourceJump {
  filepath: string;
  start: readonly [line: number, character: number] | null;
  end: readonly [line: number, character: number] | null;
}

export interface TinymistSessionInfo {
  generation: number;
  rootPath: string;
  sourcePath: string;
}

export interface TinymistPreviewResult {
  staticServerAddr?: string;
  staticServerPort?: number;
  dataPlanePort?: number;
  isPrimary?: boolean;
}

export function useTinymistSession(
  sourcePath: string | null,
  onSourceJump?: (jump: TinymistSourceJump) => void,
  onOpenUri?: (uri: string) => Promise<EditorView | null> | EditorView | null,
) {
  const [client, setClient] = useState<LSPClient | null>(null);
  const [status, setStatus] = useState<TinymistStatus>({ available: false, phase: "idle" });
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const jumpRef = useRef(onSourceJump);
  const openUriRef = useRef(onOpenUri);
  jumpRef.current = onSourceJump;
  openUriRef.current = onOpenUri;

  useEffect(() => {
    let cancelled = false;
    let activeClient: LSPClient | null = null;
    let activeChannel: Awaited<ReturnType<typeof createTauriTinymistChannel>> | null = null;

    const cleanup = async () => {
      if (activeClient) {
        try {
          await activeClient.request("workspace/executeCommand", {
            command: "tinymist.doKillPreview",
            arguments: [PREVIEW_TASK_ID],
          });
        } catch {
          // Tinymist may already have disposed the preview task.
        }
        activeClient.disconnect();
        activeClient = null;
      }
      activeChannel?.dispose();
      activeChannel = null;
      try {
        await invoke<void>("stop_tinymist");
      } catch {
        // A missing/expired backend process is already stopped.
      }
    };

    const start = async () => {
      if (!sourcePath) {
        setClient(null);
        setPreviewUrl(null);
        setError(null);
        setStatus({ available: false, phase: "idle" });
        return;
      }
      setStatus((current) => ({ ...current, phase: "checking", error: undefined }));
      setError(null);
      setPreviewUrl(null);
      let availability: Omit<TinymistStatus, "phase">;
      try {
        availability = await invoke<Omit<TinymistStatus, "phase">>("tinymist_status");
      } catch (reason) {
        if (!cancelled) {
          const message = errorMessage(reason);
          setStatus({ available: false, phase: "error", error: message });
          setError(message);
          setClient(null);
        }
        return;
      }
      if (cancelled) return;
      setStatus({ ...availability, phase: availability.available ? "starting" : "unavailable" });
      if (!availability.available) {
        setClient(null);
        setError(availability.error ?? "Tinymist is unavailable.");
        return;
      }

      let info: TinymistSessionInfo;
      try {
        info = await invoke<TinymistSessionInfo>("start_tinymist");
      } catch (reason) {
        if (!cancelled) {
          const message = errorMessage(reason);
          setStatus((current) => ({ ...current, phase: "error", error: message }));
          setError(message);
          setClient(null);
        }
        return;
      }
      if (cancelled) return;

      try {
        activeChannel = await createTauriTinymistChannel();
        const baseTransport = createTinymistTransport(activeChannel, info.generation, (reason) => {
          if (!cancelled) setError(errorMessage(reason));
        });
        const rootUri = filePathToUri(info.rootPath);
        const extensions = [
          ...languageServerExtensions(),
          {
            clientCapabilities: {
              general: { positionEncodings: ["utf-16"] },
              textDocument: {
                semanticTokens: {
                  dynamicRegistration: false,
                  requests: { range: true, full: { delta: true } },
                  tokenTypes: TINYMIST_SEMANTIC_TOKEN_TYPES,
                  tokenModifiers: [],
                  formats: ["relative"],
                  overlappingTokenSupport: true,
                  multilineTokenSupport: false,
                },
              },
            },
          },
        ];
        activeClient = new LSPClient({
          rootUri,
          workspace: (nextClient) => createTinymistWorkspace(nextClient, (uri) => openUriRef.current?.(uri) ?? null),
          extensions,
          notificationHandlers: {
            "tinymist/preview/scrollSource": (_nextClient, params) => {
              const jump = sourceJumpFromParams(params);
              if (jump) jumpRef.current?.(jump);
              return true;
            },
          },
        });
        const transport = createTinymistInitializationTransport(baseTransport, rootUri);
        activeClient.connect(transport);
        await activeClient.initializing;
        if (cancelled) return;
        setClient(activeClient);

        const result = await activeClient.request<
          { command: string; arguments: unknown[] },
          TinymistPreviewResult
        >("workspace/executeCommand", {
          command: "tinymist.doStartPreview",
          arguments: [[
            "--task-id",
            PREVIEW_TASK_ID,
            "--data-plane-host",
            "127.0.0.1:0",
            "--preview-mode",
            "slide",
            "--partial-rendering",
            "--no-open",
            info.sourcePath,
          ]],
        });
        const url = parsePreviewUrl(result);
        if (cancelled) return;
        setPreviewUrl(url);
        setStatus((current) => ({ ...current, phase: "ready", error: undefined }));
      } catch (reason) {
        if (!cancelled) {
          const message = errorMessage(reason);
          setStatus((current) => ({ ...current, phase: "error", error: message }));
          setError(message);
        }
      }
    };

    void start();
    return () => {
      cancelled = true;
      setClient(null);
      setPreviewUrl(null);
      void cleanup();
    };
  }, [sourcePath]);

  return { client, status, previewUrl, error };
}

export function parsePreviewUrl(result: TinymistPreviewResult | string): string {
  const address = typeof result === "string"
    ? result
    : result.staticServerAddr ?? (result.staticServerPort ? `127.0.0.1:${result.staticServerPort}` : "");
  if (!address) throw new Error("Tinymist did not return a preview server address.");
  const candidate = address.includes("://") ? address : `http://${address}`;
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error(`Tinymist returned an invalid preview address: ${address}`);
  }
  if (parsed.protocol !== "http:") throw new Error("Tinymist preview must use HTTP loopback.");
  if (!isLoopbackHost(parsed.hostname)) throw new Error("Tinymist preview address is not loopback.");
  return parsed.origin;
}

export function sourceJumpFromParams(params: unknown): TinymistSourceJump | null {
  if (!isRecord(params) || typeof params.filepath !== "string") return null;
  return {
    filepath: params.filepath,
    start: sourcePosition(params.start),
    end: sourcePosition(params.end),
  };
}

function sourcePosition(value: unknown): readonly [line: number, character: number] | null {
  if (Array.isArray(value) && value.length >= 2 && value.every((part) => typeof part === "number")) {
    return [value[0], value[1]];
  }
  if (isRecord(value) && typeof value.line === "number" && typeof value.character === "number") {
    return [value.line, value.character];
  }
  return null;
}

function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}
