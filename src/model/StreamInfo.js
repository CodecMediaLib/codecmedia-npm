/**
 * StreamInfo
 * Port of me.tamkungz.codecmedia.model.StreamInfo
 *
 * @typedef {Object} StreamInfo
 * @property {number}           index       - Stream index
 * @property {import("./StreamKind.js").StreamKind} kind - Stream kind (AUDIO/VIDEO/etc.)
 * @property {string}           codec       - Codec name
 * @property {number|null}      bitrateKbps - Bitrate in kbps
 * @property {number|null}      sampleRate  - Sample rate (audio)
 * @property {number|null}      channels    - Channel count (audio)
 * @property {number|null}      width       - Frame width (video)
 * @property {number|null}      height      - Frame height (video)
 * @property {number|null}      frameRate   - Frame rate (video)
 */

/**
 * Creates a StreamInfo object (mirrors Java record constructor).
 *
 * @param {object} fields
 * @param {number}      fields.index
 * @param {string}      fields.kind
 * @param {string}      fields.codec
 * @param {number|null} [fields.bitrateKbps]
 * @param {number|null} [fields.sampleRate]
 * @param {number|null} [fields.channels]
 * @param {number|null} [fields.width]
 * @param {number|null} [fields.height]
 * @param {number|null} [fields.frameRate]
 * @returns {StreamInfo}
 */
export function StreamInfo({
  index,
  kind,
  codec,
  bitrateKbps = null,
  sampleRate  = null,
  channels    = null,
  width       = null,
  height      = null,
  frameRate   = null,
}) {
  return Object.freeze({
    index,
    kind,
    codec,
    bitrateKbps,
    sampleRate,
    channels,
    width,
    height,
    frameRate,
  });
}