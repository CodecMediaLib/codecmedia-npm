/**
 * WavProbeInfo
 * Port of me.tamkungz.codecmedia.internal.audio.wav.WavProbeInfo
 *
 * @typedef {Object} WavProbeInfo
 * @property {string} codec
 * @property {number} durationMillis
 * @property {number} bitrateKbps
 * @property {number} sampleRate
 * @property {number} channels
 * @property {number} bitsPerSample
 * @property {"CBR"|"VBR"|"CVBR"|"UNKNOWN"} bitrateMode
 */

/**
 * @param {Partial<WavProbeInfo>} fields
 * @returns {WavProbeInfo}
 */
export function WavProbeInfo({
  codec = "pcm",
  durationMillis = 0,
  bitrateKbps = 0,
  sampleRate = 0,
  channels = 0,
  bitsPerSample = 0,
  bitrateMode = "UNKNOWN",
} = {}) {
  return Object.freeze({
    codec,
    durationMillis,
    bitrateKbps,
    sampleRate,
    channels,
    bitsPerSample,
    bitrateMode,
  });
}

