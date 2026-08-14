/**
 * Mp4ProbeInfo
 * Port of me.tamkungz.codecmedia.internal.video.mp4.Mp4ProbeInfo
 *
 * @typedef {Object} Mp4ProbeInfo
 * @property {number|null}  durationMillis
 * @property {number|null}  width
 * @property {number|null}  height
 * @property {string}       majorBrand
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
 * @param {Partial<Mp4ProbeInfo>} fields
 * @returns {Mp4ProbeInfo}
 */
export function Mp4ProbeInfo({
  durationMillis     = null,
  width              = null,
  height             = null,
  majorBrand         = "",
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
    majorBrand,
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