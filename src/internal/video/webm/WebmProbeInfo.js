/**
 * WebmProbeInfo
 * Port of me.tamkungz.codecmedia.internal.video.webm.WebmProbeInfo
 *
 * @typedef {Object} WebmProbeInfo
 * @property {number|null}  durationMillis
 * @property {number|null}  width
 * @property {number|null}  height
 * @property {string|null}  videoCodec
 * @property {string|null}  audioCodec
 * @property {number|null}  sampleRate
 * @property {number|null}  channels
 * @property {number|null}  frameRate
 * @property {number|null}  videoBitrateKbps
 * @property {number|null}  audioBitrateKbps
 * @property {number|null}  bitDepth
 * @property {string|null}  displayAspectRatio
 */

/**
 * @param {Partial<WebmProbeInfo>} fields
 * @returns {WebmProbeInfo}
 */
export function WebmProbeInfo({
  durationMillis     = null,
  width              = null,
  height             = null,
  videoCodec         = null,
  audioCodec         = null,
  sampleRate         = null,
  channels           = null,
  frameRate          = null,
  videoBitrateKbps   = null,
  audioBitrateKbps   = null,
  bitDepth           = null,
  displayAspectRatio = null,
} = {}) {
  return Object.freeze({
    durationMillis,
    width,
    height,
    videoCodec,
    audioCodec,
    sampleRate,
    channels,
    frameRate,
    videoBitrateKbps,
    audioBitrateKbps,
    bitDepth,
    displayAspectRatio,
  });
}