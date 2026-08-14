/**
 * @typedef {Object} OggProbeInfo
 * @property {string} codec
 * @property {number} sampleRate
 * @property {number} channels
 * @property {number} bitrateKbps
 * @property {"CBR"|"VBR"|"UNKNOWN"} bitrateMode
 * @property {number} durationMillis
 */
export function OggProbeInfo({ codec, sampleRate, channels, bitrateKbps, bitrateMode, durationMillis }) {
  return Object.freeze({ codec, sampleRate, channels, bitrateKbps, bitrateMode, durationMillis });
}
