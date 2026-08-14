/**
 * AudioExtractOptions
 * Port of me.tamkungz.codecmedia.options.AudioExtractOptions
 *
 * @typedef {Object} AudioExtractOptions
 * @property {string}      targetFormat - Target audio format (e.g. "m4a")
 * @property {number|null} bitrateKbps  - Target bitrate in kbps
 * @property {number|null} streamIndex  - Stream index to extract (0-based)
 */

/**
 * Creates an AudioExtractOptions object.
 *
 * @param {object} fields
 * @param {string}      fields.targetFormat
 * @param {number|null} [fields.bitrateKbps]
 * @param {number|null} [fields.streamIndex]
 * @returns {AudioExtractOptions}
 */
export function AudioExtractOptions({ targetFormat, bitrateKbps = null, streamIndex = null }) {
  return Object.freeze({ targetFormat, bitrateKbps, streamIndex });
}

/**
 * Default AudioExtractOptions — mirrors Java's AudioExtractOptions.defaults()
 * targetFormat="m4a", bitrateKbps=192, streamIndex=0
 *
 * @param {string|null} [targetFormat]
 * @returns {AudioExtractOptions}
 */
AudioExtractOptions.defaults = function (targetFormat = null) {
  const effective =
    typeof targetFormat === "string" && targetFormat.trim().length > 0
      ? targetFormat.trim()
      : "m4a";
  return AudioExtractOptions({ targetFormat: effective, bitrateKbps: 192, streamIndex: 0 });
};