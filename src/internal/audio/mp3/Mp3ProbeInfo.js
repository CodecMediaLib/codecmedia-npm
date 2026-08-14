/**
 * Mp3ProbeInfo
 * Port of me.tamkungz.codecmedia.internal.audio.mp3.Mp3ProbeInfo
 *
 * @typedef {Object} Mp3ProbeInfo
 * @property {string}  codec          - always "mp3"
 * @property {number}  sampleRate     - e.g. 44100, 48000, 32000
 * @property {number}  channels       - 1 (mono) or 2 (stereo/joint-stereo/dual)
 * @property {number}  bitrateKbps    - average bitrate in kbps
 * @property {string}  bitrateMode    - "CBR" | "VBR" | "CVBR" | "UNKNOWN"
 * @property {number}  durationMillis - duration in milliseconds
 */

/**
 * @param {Partial<Mp3ProbeInfo>} fields
 * @returns {Mp3ProbeInfo}
 */
export function Mp3ProbeInfo({
  codec          = "mp3",
  sampleRate     = 0,
  channels       = 0,
  bitrateKbps    = 0,
  bitrateMode    = "UNKNOWN",
  durationMillis = 0,
} = {}) {
  return Object.freeze({ codec, sampleRate, channels, bitrateKbps, bitrateMode, durationMillis });
}