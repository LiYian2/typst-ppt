import { describe, expect, it } from "vitest";
import { pdfPageCrop } from "./pdfLayout";

describe("pdfPageCrop", () => {
  it("keeps ordinary 16:9 slides intact", () => {
    expect(pdfPageCrop(1600, 900)).toEqual({ visibleWidthRatio: 1, cropped: false });
  });

  it("shows only the slide half of a Touying side-by-side notes page", () => {
    expect(pdfPageCrop(3200, 900)).toEqual({ visibleWidthRatio: 0.5, cropped: true });
  });

  it("does not mistake a 21:9 slide for a dual-screen page", () => {
    expect(pdfPageCrop(2100, 900)).toEqual({ visibleWidthRatio: 1, cropped: false });
  });
});
