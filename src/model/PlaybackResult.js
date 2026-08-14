/**
 * PlaybackResult
 * Port of me.tamkungz.codecmedia.model.PlaybackResult
 *
 * @typedef {Object} PlaybackResult
 * @property {boolean} started   - Whether playback was started
 * @property {string}  backend   - Backend used (e.g. "dry-run", "system")
 * @property {import("./MediaType.js").MediaType} mediaType - Media type that was played
 * @property {string}  message   - Human-readable status message
 */

/**
 * Creates a PlaybackResult object (mirrors Java record constructor).
 *
 * @param {object} fields
 * @param {boolean} fields.started
 * @param {string}  fields.backend
 * @param {string}  fields.mediaType
 * @param {string}  fields.message
 * @returns {PlaybackResult}
 */
export function PlaybackResult({ started, backend, mediaType, message }) {
  return Object.freeze({ started, backend, mediaType, message });
}