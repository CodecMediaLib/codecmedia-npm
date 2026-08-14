/**
 * ConversionResult
 * Port of me.tamkungz.codecmedia.model.ConversionResult
 *
 * @typedef {Object} ConversionResult
 * @property {string}  outputFile - Output file path
 * @property {string}  format     - Output format (e.g. "mp4")
 * @property {boolean} reencoded  - Whether re-encoding was performed
 */

/**
 * Creates a ConversionResult object (mirrors Java record constructor).
 *
 * @param {object} fields
 * @param {string}  fields.outputFile
 * @param {string}  fields.format
 * @param {boolean} fields.reencoded
 * @returns {ConversionResult}
 */
export function ConversionResult({ outputFile, format, reencoded }) {
  return Object.freeze({ outputFile, format, reencoded });
}