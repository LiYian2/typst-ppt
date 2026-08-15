import { describe, expect, it } from "vitest";
import { matchesPinnedTinymistMarker, reportsPinnedTinymistVersion } from "./tinymist-version.mjs";

describe("Tinymist release version output", () => {
  it("accepts release metadata with or without a v prefix", () => {
    expect(reportsPinnedTinymistVersion("Build Git Describe: v0.15.2", "0.15.2")).toBe(true);
    expect(reportsPinnedTinymistVersion("tinymist 0.15.2", "0.15.2")).toBe(true);
  });

  it("rejects a different semantic version", () => {
    expect(reportsPinnedTinymistVersion("tinymist 0.15.1", "0.15.2")).toBe(false);
  });

  it("accepts only a marker for the requested version and exact binary digest", () => {
    const marker = { version: "0.15.2", sha256: "abc123" };
    expect(matchesPinnedTinymistMarker(marker, "0.15.2", "abc123")).toBe(true);
    expect(matchesPinnedTinymistMarker(marker, "0.15.1", "abc123")).toBe(false);
    expect(matchesPinnedTinymistMarker(marker, "0.15.2", "changed")).toBe(false);
  });
});
