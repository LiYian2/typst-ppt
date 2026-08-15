import { describe, expect, it } from "vitest";
import { reportsPinnedTinymistVersion } from "./tinymist-version.mjs";

describe("Tinymist release version output", () => {
  it("accepts release metadata with or without a v prefix", () => {
    expect(reportsPinnedTinymistVersion("Build Git Describe: v0.15.2", "0.15.2")).toBe(true);
    expect(reportsPinnedTinymistVersion("tinymist 0.15.2", "0.15.2")).toBe(true);
  });

  it("rejects a different semantic version", () => {
    expect(reportsPinnedTinymistVersion("tinymist 0.15.1", "0.15.2")).toBe(false);
  });
});
