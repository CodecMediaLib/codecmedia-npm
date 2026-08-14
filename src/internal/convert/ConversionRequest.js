/**
 * ConversionRequest
 * Port of me.tamkungz.codecmedia.internal.convert.ConversionRequest
 *
 * @typedef {Object} ConversionRequest
 * @property {string} input
 * @property {string} output
 * @property {string} sourceExtension
 * @property {string} targetExtension
 * @property {string} sourceMediaType
 * @property {string} targetMediaType
 * @property {import("../options/ConversionOptions.js").ConversionOptions} options
 */

/**
 * @param {ConversionRequest} fields
 * @returns {ConversionRequest}
 */
export function ConversionRequest({
  input,
  output,
  sourceExtension,
  targetExtension,
  sourceMediaType,
  targetMediaType,
  options,
}) {
  return Object.freeze({ input, output, sourceExtension, targetExtension, sourceMediaType, targetMediaType, options });
}