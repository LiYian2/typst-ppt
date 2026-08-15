import { autocompletion, completeFromList, type Completion } from "@codemirror/autocomplete";
import { HighlightStyle, StreamLanguage, syntaxHighlighting, type StreamParser } from "@codemirror/language";
import { lintGutter, setDiagnostics, type Diagnostic } from "@codemirror/lint";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { basicSetup } from "codemirror";
import { useEffect, useRef } from "react";

interface TypstEditorProps {
  value: string;
  diagnostics: string[];
  onChange: (value: string) => void;
  onSave: () => void;
}

interface TypstStreamState {
  blockComment: boolean;
  quote: string | null;
}

const keywords = new Set([
  "and", "as", "auto", "break", "context", "continue", "else", "false", "for",
  "if", "import", "in", "include", "let", "none", "not", "or", "return", "set",
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

export function TypstEditor({ value, diagnostics, onChange, onSave }: TypstEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const initialValueRef = useRef(value);
  const changeRef = useRef(onChange);
  const saveRef = useRef(onSave);

  changeRef.current = onChange;
  saveRef.current = onSave;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const state = EditorState.create({
      doc: initialValueRef.current,
      extensions: [
        basicSetup,
        typstLanguage,
        syntaxHighlighting(typstHighlight),
        autocompletion({ override: [completeFromList(completions)] }),
        lintGutter(),
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
        }),
      ],
    });
    const view = new EditorView({ state, parent: host });
    viewRef.current = view;
    return () => {
      viewRef.current = null;
      view.destroy();
    };
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch(setDiagnostics(view.state, parseDiagnostics(diagnostics, view.state.doc)));
  }, [diagnostics]);

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
