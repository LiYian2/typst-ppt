import type { LSPClient } from "@codemirror/lsp-client";
import { StateEffect, StateField, Text } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import type { SemanticTokensLegend } from "vscode-languageserver-protocol";
import type { Extension } from "@codemirror/state";

export interface SemanticTokensResponse {
  data?: number[];
  resultId?: string;
}

export interface SemanticTokensRequesterOptions {
  request: (params: { textDocument: { uri: string } }) => Promise<SemanticTokensResponse>;
  getDocument: () => Text;
  getLegend: () => SemanticTokensLegend;
  apply: (decorations: DecorationSet) => void;
  uri?: string;
  debounceMs?: number;
}

/** Decode the LSP relative token stream into a CodeMirror decoration set. */
export function decodeSemanticTokens(
  data: readonly number[],
  document: Text,
  legend: SemanticTokensLegend,
): DecorationSet {
  const ranges: Array<{ from: number; to: number; decoration: Decoration }> = [];
  let line = 0;
  let character = 0;
  for (let index = 0; index + 4 < data.length; index += 5) {
    const deltaLine = finiteNumber(data[index]);
    const deltaStart = finiteNumber(data[index + 1]);
    const length = finiteNumber(data[index + 2]);
    const tokenTypeIndex = finiteNumber(data[index + 3]);
    if (deltaLine > 0) {
      line += deltaLine;
      character = deltaStart;
    } else {
      character += deltaStart;
    }
    if (line < 0 || line >= document.lines || length <= 0) continue;
    const lineText = document.line(line + 1);
    const from = lineText.from + Math.min(character, lineText.length);
    const to = Math.min(lineText.to, from + length);
    if (to <= from) continue;
    const tokenType = legend.tokenTypes[tokenTypeIndex] ?? `type-${tokenTypeIndex}`;
    ranges.push({
      from,
      to,
      decoration: Decoration.mark({ class: `cm-tinymist-token-${className(tokenType)}` }),
    });
  }
  return Decoration.set(ranges.map((range) => range.decoration.range(range.from, range.to)), true);
}

/**
 * Schedule semantic-token requests while dropping responses for stale document
 * versions. This is public so protocol-peer tests can observe the same seam as
 * the CodeMirror extension without a DOM.
 */
export function createSemanticTokensRequester(options: SemanticTokensRequesterOptions) {
  const debounceMs = options.debounceMs ?? 80;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let serial = 0;
  let disposed = false;

  const run = async (requestSerial: number) => {
    const document = options.getDocument();
    let response: SemanticTokensResponse;
    try {
      response = await options.request({ textDocument: { uri: options.uri ?? "" } });
    } catch {
      return;
    }
    if (disposed || requestSerial !== serial) return;
    const data = response.data;
    if (!data) return;
    options.apply(decodeSemanticTokens(data, document, options.getLegend()));
  };

  return {
    schedule() {
      if (disposed) return;
      const requestSerial = ++serial;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        void run(requestSerial);
      }, debounceMs);
    },
    dispose() {
      disposed = true;
      serial += 1;
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}

const semanticTokensEffect = StateEffect.define<DecorationSet>();
const semanticTokensField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, transaction) {
    let next = transaction.docChanged ? value.map(transaction.changes) : value;
    for (const effect of transaction.effects) {
      if (effect.is(semanticTokensEffect)) next = effect.value;
    }
    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});

/** CodeMirror extension used by TypstEditor when a Tinymist client is active. */
export function tinymistSemanticTokens(client: LSPClient, uri: string): Extension {
  const plugin = ViewPlugin.fromClass(class {
    private readonly requester;

    constructor(private readonly view: EditorView) {
      this.requester = createSemanticTokensRequester({
        uri,
        request: async (params) => {
          client.sync();
          return client.request("textDocument/semanticTokens/full", params) as Promise<SemanticTokensResponse>;
        },
        getDocument: () => view.state.doc,
        getLegend: () => semanticLegend(client),
        apply: (decorations) => {
          if (!this.view.dom.isConnected) return;
          this.view.dispatch({ effects: semanticTokensEffect.of(decorations) });
        },
      });
      this.requester.schedule();
    }

    update(update: ViewUpdate) {
      if (update.docChanged) this.requester.schedule();
    }

    destroy() {
      this.requester.dispose();
    }
  });
  return [semanticTokensField, plugin];
}

function semanticLegend(client: LSPClient): SemanticTokensLegend {
  const provider = client.serverCapabilities?.semanticTokensProvider;
  if (provider && "legend" in provider) return provider.legend;
  return { tokenTypes: [], tokenModifiers: [] };
}

function finiteNumber(value: number): number {
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

function className(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-");
  return normalized || "unknown";
}
