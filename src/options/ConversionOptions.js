/**
 * ConversionOptions
 * Port of me.tamkungz.codecmedia.options.ConversionOptions
 *
 * @typedef {Object} ConversionOptions
 * @property {string}  targetFormat - Target format (e.g. "mp4", "png")
 * @property {string}  preset       - Encoding preset (e.g. "balanced", "fast")
 * @property {boolean} overwrite    - Whether to overwrite existing output file
 */

/**
 * Creates a ConversionOptions object.
 *
 * @param {object} fields
 * @param {string}  fields.targetFormat
 * @param {string}  fields.preset
 * @param {boolean} fields.overwrite
 * @returns {ConversionOptions}
 */
export function ConversionOptions({ targetFormat, preset, overwrite }) {
  return Object.freeze({ targetFormat, preset, overwrite });
}

/**
 * Default ConversionOptions — mirrors Java's ConversionOptions.defaults(targetFormat)
 * preset="balanced", overwrite=false
 *
 * @param {string} targetFormat
 * @returns {ConversionOptions}
 */
ConversionOptions.defaults = function (targetFormat) {
  return ConversionOptions({ targetFormat, preset: "balanced", overwrite: false });
};