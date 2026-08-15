export function reportsPinnedTinymistVersion(output, version) {
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|\\D)v?${escaped}(?:\\D|$)`).test(output);
}

export function matchesPinnedTinymistMarker(marker, version, binarySha256) {
  return typeof marker === "object"
    && marker !== null
    && marker.version === version
    && marker.sha256 === binarySha256;
}
