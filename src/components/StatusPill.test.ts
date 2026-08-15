import { describe, expect, it } from "vitest";
import { pdfReadyLabel } from "../lib/buildStatus";

describe("presentation build status", () => {
  it("labels elapsed time as PDF readiness rather than editor preview latency", () => {
    expect(pdfReadyLabel(1147)).toBe("PDF ready · 1147 ms");
  });
});
