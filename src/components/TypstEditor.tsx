import { autocompletion, completeFromList, type Completion } from "@codemirror/autocomplete";
import { HighlightStyle, StreamLanguage, syntaxHighlighting, type StreamParser } from "@codemirror/language";
import { lintGutter, setDiagnostics, type Diagnostic } from "@codemirror/lint";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { basicSetup } from "codemirror";
import type { LSPClient } from "@codemirror/lsp-client";
import { useEffect, useRef } from "react";
import type { TinymistSourceJump } from "../hooks/useTinymistSession";
import { filePathToUri, uriToFilePath } from "../lib/tinymistTransport";
import { tinymistSemanticTokens } from "../lib/tinymistSemanticTokens";

export interface TypstEditorProps {
  value: string;
  /** Absolute source path used for the LSP textDocument URI. */
  path?: string;
  /** Active Tinymist client. When absent the editor uses its safe fallback. */
  client?: LSPClient | null;
  /** Source range sent by Tinymist's preview or definition navigation. */
  jump?: TinymistSourceJump | null;
  /** Compiler diagnostics used when Tinymist is unavailable. */
  fallbackDiagnostics?: string[];
  /** Exposes the active view so cross-file LSP navigation can finish after React mounts it. */
  onViewReady?: (view: EditorView | null) => void;
  /** @deprecated Kept as a compatibility alias while EditorWorkspace migrates. */
  diagnostics?: string[];
  onChange: (value: string) => void;
  onSave: () => void;
}

interface TypstStreamState {
  blockComment: boolean;
  quote: string | null;
}

const keywords = new Set([
  "and", "as", "auto", "break", "context", "continue", "else", "false", "for",
  "if", "import", "in", "let", "none", "not", "or", "return", "set",
  "show", "true", "while",
]);

const completions: Completion[] = [
  ...Array.from(keywords, (label) => ({ label, type: "keyword" })),
  ...[
    "align", "block", "box", "circle", "columns", "counter", "figure", "grid", "heading",
    "image", "link", "list", "page", "place", "read", "rect", "repeat", "rgb", "table",
    "text",
  ].map((label) => ({ label, type: "function" })),
  { label: "#let name = ", type: "snippet", apply: "#let name = " },
  { label: "#set text()", type: "snippet", apply: "#set text()" },
  { label: "#show: ", type: "snippet", apply: "#show: " },
];

const typstParser: StreamParser<TypstStreamState> = {
  startState: () => ({ blockComment: false, quote: null }),
  token(stream, state) {
    if (state.blockComment) {
      if (stream.skipTo("*/")) {
        stream.match("*/");
        state.blockComment = false;
      } else {
        stream.skipToEnd();
      }
      return "comment";
    }
    if (state.quote) {
      let escaped = false;
      while (!stream.eol()) {
        const value = stream.next();
        if (value === state.quote && !escaped) {
          state.quote = null;
          break;
        }
        escaped = value === "\\" && !escaped;
        if (value !== "\\") escaped = false;
      }
      return "string";
    }
    if (stream.eatSpace()) return null;
    if (stream.match("//")) {
      stream.skipToEnd();
      return "comment";
    }
    if (stream.match("/*")) {
      state.blockComment = true;
      return "comment";
    }
    if (stream.peek() === '"' || stream.peek() === "'") {
      state.quote = stream.next() ?? null;
      return "string";
    }
    if (stream.sol() && stream.match(/=+\s/)) return "heading";
    if (stream.sol() && stream.match(/[-+]\s/)) return "list";
    if (stream.match(/@[\w:-]+/)) return "link";
    if (stream.match(/<[^>]+>/)) return "labelName";
    if (stream.match(/\b(?:\d+(?:\.\d+)?)(?:pt|mm|cm|in|em|fr|%|deg)?\b/)) return "number";
    if (stream.match("#")) return "meta";
    if (stream.match(/[A-Za-z_][\w-]*/)) {
      return keywords.has(stream.current()) ? "keyword" : "variableName";
    }
    if (stream.match(/[()[\]{}.,:;]/)) return "punctuation";
    if (stream.match(/[+*/=<>!&|~-]+/)) return "operator";
    stream.next();
    return null;
  },
};

const typstLanguage = StreamLanguage.define(typstParser);
const typstHighlight = HighlightStyle.define([
  { tag: tags.keyword, color: "#d6a5ff" },
  { tag: [tags.function(tags.variableName), tags.variableName], color: "#d8dee9" },
  { tag: tags.string, color: "#a8d279" },
  { tag: tags.number, color: "#f3ba76" },
  { tag: tags.comment, color: "#68707d", fontStyle: "italic" },
  { tag: [tags.heading, tags.labelName], color: "#8fd5ff", fontWeight: "650" },
  { tag: [tags.link, tags.meta], color: "#b8f23c" },
  { tag: tags.operator, color: "#ff91a4" },
]);

export function TypstEditor({
  value,
  path,
  client,
  jump,
  fallbackDiagnostics,
  diagnostics,
  onViewReady,
  onChange,
  onSave,
}: TypstEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const valueRef = useRef(value);
  const changeRef = useRef(onChange);
  const saveRef = useRef(onSave);
  const readyRef = useRef(onViewReady);

  changeRef.current = onChange;
  saveRef.current = onSave;
  readyRef.current = onViewReady;
  valueRef.current = value;
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const fileUri = path ? filePathToUri(path) : null;
    const hasLanguageServer = Boolean(client && fileUri);
    const state = EditorState.create({
      doc: valueRef.current,
      extensions: [
        basicSetup,
        typstLanguage,
        syntaxHighlighting(typstHighlight),
        ...(hasLanguageServer && client && fileUri
          ? [client.plugin(fileUri, "typst"), tinymistSemanticTokens(client, fileUri)]
          : [autocompletion({ override: [completeFromList(completions)] }), lintGutter()]),
        keymap.of([{ key: "Mod-s", preventDefault: true, run: () => { saveRef.current(); return true; } }]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) changeRef.current(update.state.doc.toString());
        }),
        EditorView.theme({
          "&": { height: "100%", backgroundColor: "#0c0e12", color: "#e6e9ee" },
          ".cm-content": { caretColor: "#b8f23c", padding: "14px 0 40px" },
          ".cm-scroller": { overflow: "auto", fontFamily: '"SFMono-Regular", Consolas, monospace', fontSize: "12px", lineHeight: "1.62" },
          ".cm-gutters": { backgroundColor: "#0a0c0f", color: "#4f5661", border: "none", borderRight: "1px solid rgba(255,255,255,.06)" },
          ".cm-activeLine, .cm-activeLineGutter": { backgroundColor: "rgba(184,242,60,.045)" },
          ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": { backgroundColor: "rgba(99,159,255,.26)" },
          ".cm-tooltip": { backgroundColor: "#1b1e24", border: "1px solid rgba(255,255,255,.1)" },
          ".cm-tooltip-autocomplete > ul > li[aria-selected]": { backgroundColor: "rgba(184,242,60,.14)", color: "white" },
          ".cm-diagnostic-error": { borderLeftColor: "#ff6b6b" },
          ".cm-tinymist-token-keyword, .cm-tinymist-token-modifier": { color: "#d6a5ff" },
          ".cm-tinymist-token-function, .cm-tinymist-token-method, .cm-tinymist-token-macro": { color: "#8fd5ff" },
          ".cm-tinymist-token-string, .cm-tinymist-token-regexp": { color: "#a8d279" },
          ".cm-tinymist-token-number": { color: "#f3ba76" },
          ".cm-tinymist-token-comment": { color: "#68707d", fontStyle: "italic" },
          ".cm-tinymist-token-variable, .cm-tinymist-token-property, .cm-tinymist-token-parameter": { color: "#d8dee9" },
          ".cm-tinymist-token-type, .cm-tinymist-token-class, .cm-tinymist-token-interface, .cm-tinymist-token-struct": { color: "#72d5c8" },
          ".cm-tinymist-token-operator, .cm-tinymist-token-decorator": { color: "#ff91a4" },
        }),
      ],
    });
    const view = new EditorView({ state, parent: host });
    viewRef.current = view;
    readyRef.current?.(view);
    return () => {
      viewRef.current = null;
      readyRef.current?.(null);
      view.destroy();
    };
  }, [client, path]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || client) return;
    view.dispatch(setDiagnostics(view.state, parseDiagnostics(fallbackDiagnostics ?? diagnostics ?? [], view.state.doc)));
  }, [client, diagnostics, fallbackDiagnostics]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || !path || !jump || !pathsMatch(path, jump.filepath)) return;
    if (!jump.start) return;
    const from = offsetAt(view.state.doc, jump.start);
    const to = offsetAt(view.state.doc, jump.end ?? jump.start);
    view.dispatch({
      selection: { anchor: from, head: Math.max(from, to) },
      effects: EditorView.scrollIntoView(from, { y: "center" }),
    });
    view.focus();
  }, [jump, path]);

  return <div className="typst-editor" ref={hostRef} />;
}

function parseDiagnostics(messages: string[], doc: EditorState["doc"]): Diagnostic[] {
  return messages.flatMap((message) => {
    const match = message.match(/:(\d+):(\d+):\s+(error|warning):\s+(.+)$/);
    if (!match) return [];
    const lineNumber = Math.min(Number(match[1]), doc.lines);
    const line = doc.line(Math.max(1, lineNumber));
    const column = Math.max(0, Number(match[2]) - 1);
    const from = Math.min(line.to, line.from + column);
    return [{ from, to: Math.min(line.to, from + 1), severity: match[3] as "error" | "warning", message: match[4] }];
  });
}

function offsetAt(doc: EditorState["doc"], position: readonly [line: number, character: number]): number {
  const line = doc.line(Math.min(doc.lines, Math.max(1, position[0] + 1)));
  return Math.min(line.to, line.from + Math.max(0, position[1]));
}

function pathsMatch(left: string, right: string): boolean {
  const leftPath = uriToFilePath(left) ?? left;
  const rightPath = uriToFilePath(right) ?? right;
  const normalizedLeft = leftPath.replaceAll("\\", "/").replace(/\/$/, "");
  const normalizedRight = rightPath.replaceAll("\\", "/").replace(/\/$/, "");
  return normalizedLeft === normalizedRight || normalizedLeft.toLowerCase() === normalizedRight.toLowerCase();
}
