import type { Completion } from "@codemirror/autocomplete";
import { HighlightStyle, StreamLanguage, type StreamParser } from "@codemirror/language";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { tags } from "@lezer/highlight";

interface TypstStreamState {
  blockComment: boolean;
  quote: string | null;
}

const keywords = new Set([
  "and", "as", "auto", "break", "context", "continue", "else", "false", "for",
  "if", "import", "in", "let", "none", "not", "or", "return", "set",
  "show", "true", "while",
]);

export const typstFallbackCompletions: Completion[] = [
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
    if (stream.peek() === '"') {
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

export const typstLanguage = StreamLanguage.define(typstParser);
export const typstHighlight = HighlightStyle.define([
  { tag: tags.keyword, color: "#d6a5ff" },
  { tag: [tags.function(tags.variableName), tags.variableName], color: "#d8dee9" },
  { tag: tags.string, color: "#a8d279" },
  { tag: tags.number, color: "#f3ba76" },
  { tag: tags.comment, color: "#68707d", fontStyle: "italic" },
  { tag: [tags.heading, tags.labelName], color: "#8fd5ff", fontWeight: "650" },
  { tag: [tags.link, tags.meta], color: "#b8f23c" },
  { tag: tags.operator, color: "#ff91a4" },
]);

export function typstEditorAccessExtensions(readOnly: boolean): Extension {
  return [EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)];
}
