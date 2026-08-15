import { describe, expect, it } from "vitest";
import {
  isAllowedTinymistPreviewUrl,
  lspPositionToOffset,
  normalizeTinymistPreviewUrl,
  sourceJumpToSelection,
  type SourceJump,
} from "./sourceNavigation";

describe("source navigation", () => {
  it("maps a UTF-16 LSP position after CJK and emoji text", () => {
    const source = "中文 😀 hello\nnext";

    // LSP characters are UTF-16 code units, so the emoji occupies two units.
    expect(lspPositionToOffset(source, [0, 5])).toBe(5);
    expect(lspPositionToOffset(source, [0, source.indexOf("hello") + 2])).toBe(8);
  });

  it("clamps a character past the end of a valid line", () => {
    expect(lspPositionToOffset("abc\ndef", [1, 99])).toBe(7);
  });

  it("returns null for missing or invalid lines", () => {
    expect(lspPositionToOffset("abc", null)).toBeNull();
    expect(lspPositionToOffset("abc", [-1, 0])).toBeNull();
    expect(lspPositionToOffset("abc", [3, 0])).toBeNull();
  });

  it("turns a source jump into an ordered CodeMirror selection", () => {
    const jump: SourceJump = {
      filepath: "/tmp/deck.typ",
      start: [1, 4],
      end: [1, 1],
    };

    expect(sourceJumpToSelection("title\nhello", jump)).toEqual({
      filepath: "/tmp/deck.typ",
      from: 7,
      to: 10,
    });
  });

  it("uses a point selection when Tinymist omits one endpoint", () => {
    const jump: SourceJump = {
      filepath: "/tmp/deck.typ",
      start: [0, 2],
      end: null,
    };

    expect(sourceJumpToSelection("hello", jump)).toEqual({
      filepath: "/tmp/deck.typ",
      from: 2,
      to: 2,
    });
  });

  it("rejects a source jump whose positions cannot be mapped", () => {
    expect(sourceJumpToSelection("hello", {
      filepath: "",
      start: [0, 1],
      end: [0, 2],
    })).toBeNull();
    expect(sourceJumpToSelection("hello", {
      filepath: "/tmp/deck.typ",
      start: [9, 1],
      end: [9, 2],
    })).toBeNull();
  });
});

describe("Tinymist preview URL validation", () => {
  it("accepts only explicit loopback HTTP origins with a valid port", () => {
    expect(isAllowedTinymistPreviewUrl("http://127.0.0.1:23625/")).toBe(true);
    expect(isAllowedTinymistPreviewUrl("http://localhost:3000/")).toBe(true);
    expect(normalizeTinymistPreviewUrl("http://localhost:3000")).toBe("http://localhost:3000/");
  });

  it("rejects insecurely broad or malformed URLs", () => {
    const rejected = [
      "https://localhost:3000/",
      "http://0.0.0.0:3000/",
      "http://127.0.0.2:3000/",
      "http://localhost/",
      "http://localhost:0/",
      "http://localhost:65536/",
      "http://user:pass@localhost:3000/",
      "http://localhost:3000/preview/index.html",
      "http://localhost.evil.example:3000/",
    ];

    for (const url of rejected) {
      expect(isAllowedTinymistPreviewUrl(url), url).toBe(false);
      expect(normalizeTinymistPreviewUrl(url), url).toBeNull();
    }
  });
});
