import { highlightTree, tags } from "@lezer/highlight";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import {
  typstEditorAccessExtensions,
  typstHighlight,
  typstLanguage,
} from "../lib/typstEditorSupport";

describe("Typst editor fallback highlighting", () => {
  it("does not treat an apostrophe in prose as the start of a multiline string", () => {
    const source = "Dean's List\n#let value = 42\n#show value";
    const highlighted: Array<{ from: number; to: number; classes: string }> = [];
    highlightTree(typstLanguage.parser.parse(source), typstHighlight, (from, to, classes) => {
      highlighted.push({ from, to, classes });
    });

    const afterApostrophe = source.indexOf("'") + 1;
    const stringClass = typstHighlight.style([tags.string]);
    expect(highlighted.filter((span) => span.from >= afterApostrophe && span.classes === stringClass))
      .toEqual([]);
  });

  it("makes dependency source state non-editable", () => {
    const state = EditorState.create({ extensions: typstEditorAccessExtensions(true) });
    expect(state.readOnly).toBe(true);
    expect(state.facet(EditorView.editable)).toBe(false);
  });
});
