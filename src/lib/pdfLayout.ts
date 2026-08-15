export interface PdfPageCrop {
  visibleWidthRatio: number;
  cropped: boolean;
}

const DUAL_SCREEN_MIN_ASPECT_RATIO = 2.55;

/**
 * Touying's second-screen mode places the slide and speaker notes side by side
 * on one extra-wide PDF page. The presenter already renders notes separately,
 * so only the left (slide) half should be visible in every PDF viewport.
 */
export function pdfPageCrop(width: number, height: number): PdfPageCrop {
  if (width > 0 && height > 0 && width / height >= DUAL_SCREEN_MIN_ASPECT_RATIO) {
    return { visibleWidthRatio: 0.5, cropped: true };
  }
  return { visibleWidthRatio: 1, cropped: false };
}
