export function reportsPinnedTinymistVersion(output, version) {
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|\\D)v?${escaped}(?:\\D|$)`).test(output);
}
