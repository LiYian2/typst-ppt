import { Text } from "@codemirror/state";
import { describe, expect, it, vi } from "vitest";
import {
  createSemanticTokensRequester,
  decodeSemanticTokens,
  type SemanticTokensResponse,
} from "./tinymistSemanticTokens";

describe("Tinymist semantic tokens", () => {
  it("decodes relative LSP token literals into CodeMirror decorations", () => {
    const document = Text.of(["#let title = \"hello\"", "#show title"]);
    const decorations = decodeSemanticTokens(
      [0, 0, 4, 0, 0, 0, 6, 5, 1, 0, 1, 0, 5, 2, 0],
      document,
      { tokenTypes: ["keyword", "string", "function"], tokenModifiers: [] },
    );
    const ranges: Array<{ from: number; to: number; className: string }> = [];
    decorations.between(0, document.length, (from, to, value) => {
      ranges.push({ from, to, className: value.spec.class ?? "" });
    });

    expect(ranges).toEqual([
      { from: 0, to: 4, className: "cm-tinymist-token-keyword" },
      { from: 6, to: 11, className: "cm-tinymist-token-string" },
      { from: 21, to: 26, className: "cm-tinymist-token-function" },
    ]);
  });

  it("does not apply an older response after a newer request", async () => {
    vi.useFakeTimers();
    const appliedRanges: Array<Array<[number, number]>> = [];
    const responses: Array<(value: SemanticTokensResponse) => void> = [];
    const requester = createSemanticTokensRequester({
      request: () => new Promise<SemanticTokensResponse>((resolve) => responses.push(resolve)),
      getDocument: () => Text.of(["#let value = 1"]),
      getLegend: () => ({ tokenTypes: ["keyword"], tokenModifiers: [] }),
      apply: (decorations) => {
        const ranges: Array<[number, number]> = [];
        decorations.between(0, 100, (from, to) => {
          ranges.push([from, to]);
        });
        appliedRanges.push(ranges);
      },
      debounceMs: 0,
    });

    requester.schedule();
    vi.advanceTimersByTime(0);
    await Promise.resolve();
    requester.schedule();
    vi.advanceTimersByTime(0);
    await Promise.resolve();
    responses[0]({ data: [0, 0, 4, 0, 0] });
    responses[1]({ data: [0, 0, 5, 0, 0] });
    await Promise.resolve();

    expect(appliedRanges).toEqual([[[0, 5]]]);
    requester.dispose();
    vi.useRealTimers();
  });
});
