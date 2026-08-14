/**
 * PngProbeInfo
 * Port of me.tamkungz.codecmedia.internal.image.png.PngProbeInfo
 *
 * @typedef {Object} PngProbeInfo
 * @property {number} width      - image width in pixels
 * @property {number} height     - image height in pixels
 * @property {number} bitDepth   - bit depth per channel (e.g. 8, 16)
 * @property {number} colorType  - PNG color type byte (0=grayscale, 2=RGB, 3=indexed, 4=grayscale+alpha, 6=RGBA)
 */

/**
 * @param {Partial<PngProbeInfo>} fields
 * @returns {PngProbeInfo}
 */
export function PngProbeInfo({
  width     = 0,
  height    = 0,
  bitDepth  = 0,
  colorType = 0,
} = {}) {
  return Object.freeze({ width, height, bitDepth, colorType });
}