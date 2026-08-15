import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { Transport } from "@codemirror/lsp-client";

export interface TinymistMessage {
  generation: number;
  message: string;
}

/**
 * The browser-facing boundary around the Rust Tinymist process.  Keeping this
 * small makes the JSON-RPC transport testable with a fake protocol peer while
 * the production implementation remains a thin Tauri adapter.
 */
export interface TinymistChannel {
  send: (generation: number, message: string) => Promise<void>;
  subscribe: (handler: (event: TinymistMessage) => void) => (() => void);
  dispose: () => void;
}

export interface TinymistTransport extends Transport {
  readonly generation: number;
}

/**
 * Adapt generation-tagged backend events to CodeMirror's synchronous
 * Transport interface.  `send` deliberately owns the promise rejection so a
 * failed Tauri invoke never becomes an unhandled rejection in LSPClient.
 */
export function createTinymistTransport(
  channel: TinymistChannel,
  generation: number,
  reportError: (error: unknown) => void = (error) => console.error("Tinymist transport error", error),
): TinymistTransport {
  const handlers = new Set<(value: string) => void>();
  let removeChannelSubscription: (() => void) | null = null;

  const ensureSubscription = () => {
    if (removeChannelSubscription || handlers.size === 0) return;
    removeChannelSubscription = channel.subscribe((event) => {
      if (event.generation !== generation) return;
      for (const handler of handlers) handler(event.message);
    });
  };

  return {
    generation,
    send(message) {
      try {
        // The backend invoke is async, while Transport.send is intentionally
        // synchronous.  Explicitly observing the rejection keeps this seam
        // safe even when LSPClient cannot await it.
        void channel.send(generation, message).catch(reportError);
      } catch (error) {
        reportError(error);
      }
    },
    subscribe(handler) {
      handlers.add(handler);
      ensureSubscription();
    },
    unsubscribe(handler) {
      handlers.delete(handler);
      if (handlers.size === 0 && removeChannelSubscription) {
        removeChannelSubscription();
        removeChannelSubscription = null;
      }
    },
  };
}

interface JsonRpcMessage {
  jsonrpc?: string;
  method?: string;
  params?: Record<string, unknown>;
  [key: string]: unknown;
}

const TINYMIST_INITIALIZATION_OPTIONS = {
  customizedShowDocument: true,
  semanticTokens: "enable",
  preview: {
    refresh: "onType",
    partialRendering: true,
  },
};

export const TINYMIST_SEMANTIC_TOKEN_TYPES = [
  "namespace", "type", "class", "enum", "interface", "struct", "typeParameter",
  "parameter", "variable", "property", "enumMember", "event", "function", "method",
  "macro", "keyword", "modifier", "comment", "string", "number", "regexp", "operator",
  "decorator",
];

/**
 * Wrap a Transport so the initialize request advertises Tinymist-specific
 * options.  @codemirror/lsp-client intentionally keeps initializationOptions
 * generic, therefore this adapter is the narrowest place to inject them.
 */
export function createTinymistInitializationTransport(
  base: Transport,
  rootUri: string,
): Transport {
  return {
    send(message) {
      let parsed: JsonRpcMessage;
      try {
        parsed = JSON.parse(message) as JsonRpcMessage;
      } catch {
        base.send(message);
        return;
      }
      if (parsed.method !== "initialize" || !parsed.params) {
        base.send(message);
        return;
      }

      const params = parsed.params;
      const previousCapabilities = isRecord(params.capabilities) ? params.capabilities : {};
      const previousGeneral = isRecord(previousCapabilities.general) ? previousCapabilities.general : {};
      const previousTextDocument = isRecord(previousCapabilities.textDocument)
        ? previousCapabilities.textDocument
        : {};
      const previousSemanticTokens = isRecord(previousTextDocument.semanticTokens)
        ? previousTextDocument.semanticTokens
        : {};

      const next: JsonRpcMessage = {
        ...parsed,
        params: {
          ...params,
          rootUri,
          initializationOptions: {
            ...TINYMIST_INITIALIZATION_OPTIONS,
            ...(isRecord(params.initializationOptions) ? params.initializationOptions : {}),
            preview: {
              ...TINYMIST_INITIALIZATION_OPTIONS.preview,
              ...(isRecord(params.initializationOptions) && isRecord(params.initializationOptions.preview)
                ? params.initializationOptions.preview
                : {}),
            },
          },
          capabilities: {
            ...previousCapabilities,
            general: {
              ...previousGeneral,
              positionEncodings: mergeStringArray(previousGeneral.positionEncodings, ["utf-16"]),
            },
            textDocument: {
              ...previousTextDocument,
              semanticTokens: {
                ...previousSemanticTokens,
                dynamicRegistration: false,
                requests: {
                  ...(isRecord(previousSemanticTokens.requests) ? previousSemanticTokens.requests : {}),
                  range: true,
                  full: { delta: true },
                },
                tokenTypes: mergeStringArray(previousSemanticTokens.tokenTypes, TINYMIST_SEMANTIC_TOKEN_TYPES),
                tokenModifiers: mergeStringArray(previousSemanticTokens.tokenModifiers, []),
              },
            },
          },
        },
      };
      base.send(JSON.stringify(next));
    },
    subscribe: base.subscribe.bind(base),
    unsubscribe: base.unsubscribe.bind(base),
  };
}

export function filePathToUri(path: string): string {
  const normalized = path.replaceAll("\\", "/");
  if (normalized.startsWith("//")) {
    const [host, ...segments] = normalized.slice(2).split("/");
    return `file://${host}/${segments.map((segment) => encodeURIComponent(segment)).join("/")}`;
  }
  const absolute = normalized.startsWith("/") ? normalized : `/${normalized}`;
  const encoded = absolute
    .split("/")
    .map((segment, index) => (index === 0 ? "" : encodeURIComponent(segment)))
    .join("/");
  return `file://${encoded}`;
}

/** Resolve a file URI for definition callbacks without trusting arbitrary URLs. */
export function uriToFilePath(uri: string): string | null {
  try {
    const parsed = new URL(uri);
    if (parsed.protocol !== "file:") return null;
    const pathname = decodeURIComponent(parsed.pathname);
    if (parsed.hostname && parsed.hostname !== "localhost") return `//${parsed.hostname}${pathname}`;
    return /^\/[A-Za-z]:\//.test(pathname) ? pathname.slice(1) : pathname;
  } catch {
    return null;
  }
}

/**
 * The production channel listens before connecting the LSP client, ensuring
 * the initialize response cannot race event subscription.
 */
export async function createTauriTinymistChannel(): Promise<TinymistChannel> {
  const handlers = new Set<(event: TinymistMessage) => void>();
  const unlisten = await listen<TinymistMessage>("tinymist-message", (event) => {
    for (const handler of handlers) handler(event.payload);
  });
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    handlers.clear();
    void unlisten();
  };
  return {
    send: (generation, message) => invoke<void>("send_tinymist_message", { generation, message }),
    subscribe: (handler) => {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
    dispose,
  };
}

/** A small test/integration helper for channels that expose an async listener. */
export async function createAsyncTinymistChannel(
  subscribe: (handler: (event: TinymistMessage) => void) => Promise<UnlistenFn>,
  send: (generation: number, message: string) => Promise<void>,
): Promise<TinymistChannel> {
  const handlers = new Set<(event: TinymistMessage) => void>();
  const unlisten = await subscribe((event) => {
    for (const handler of handlers) handler(event);
  });
  return {
    send,
    subscribe: (handler) => {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
    dispose: () => {
      handlers.clear();
      void unlisten();
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mergeStringArray(value: unknown, extra: string[]): string[] {
  const existing = Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  return Array.from(new Set([...existing, ...extra]));
}
