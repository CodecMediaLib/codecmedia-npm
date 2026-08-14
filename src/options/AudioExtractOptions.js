/**
 * Create audio extraction options.
 * @param {object} [fields]
 * @param {string} [fields.targetFormat=""]
 * @param {number|null} [fields.bitrateKbps=null]
 * @param {number|null} [fields.streamIndex=null]
 */
export function AudioExtractOptions({ targetFormat = "", bitrateKbps = null, streamIndex = null } = {}) {
  return Object.freeze({ targetFormat, bitrateKbps, streamIndex });
}

AudioExtractOptions.defaults = function (targetFormat = null) {
  const effective = typeof targetFormat === "string" && targetFormat.trim()
    ? targetFormat.trim()
    : "m4a";
  return AudioExtractOptions({ targetFormat: effective, bitrateKbps: 192, streamIndex: 0 });
};
