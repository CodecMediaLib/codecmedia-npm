/**
 * ExtractionResult
 * Port of me.tamkungz.codecmedia.model.ExtractionResult
 *
 * @typedef {Object} ExtractionResult
 * @property {string} outputFile - Output file path
 * @property {string} format     - Output format (e.g. "m4a")
 */

/**
 * Creates an ExtractionResult object (mirrors Java record constructor).
 *
 * @param {object} fields
 * @param {string} fields.outputFile
 * @param {string} fields.format
 * @returns {ExtractionResult}
 */
export function ExtractionResult({ outputFile, format }) {
  return Object.freeze({ outputFile, format });
}