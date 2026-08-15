import { describe, expect, it } from "vitest";
import { parsePreviewUrl, sourceJumpFromParams } from "./useTinymistSession";

describe("Tinymist preview session protocol", () => {
  it("accepts only loopback preview addresses", () => {
    expect(parsePreviewUrl({ staticServerAddr: "127.0.0.1:4242" })).toBe("http://127.0.0.1:4242");
    expect(parsePreviewUrl({ staticServerAddr: "http://localhost:4242" })).toBe("http://localhost:4242");
    expect(() => parsePreviewUrl({ staticServerAddr: "https://example.com:4242" })).toThrow(/loopback/);
  });

  it("normalizes Tinymist tuple source ranges to LSP positions", () => {
    expect(sourceJumpFromParams({
      filepath: "/deck/main.typ",
      start: [3, 2],
      end: [3, 8],
    })).toEqual({
      filepath: "/deck/main.typ",
      start: [3, 2],
      end: [3, 8],
    });
  });
});
