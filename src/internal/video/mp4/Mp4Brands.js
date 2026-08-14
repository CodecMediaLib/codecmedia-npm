/**
 * Shared MP4-family major-brand allowlist.
 *
 * Keep this as the single source of truth for MP4 sniffing so
 * engine routing and parser validation stay consistent.
 */

export const MP4_MAJOR_BRANDS = new Set([
  "isom", "iso2", "mp41", "mp42",
  "m4v ", "m4a ", "M4A ",
  "avc1", "dash", "mp4 ",
  "M4B ", "M4P ", "M4V ", "qt  ",
]);

/** @param {string} brand */
export function isSupportedMp4MajorBrand(brand) {
  return MP4_MAJOR_BRANDS.has(brand);
}

