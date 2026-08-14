/**
 * PlaybackOptions
 * Port of me.tamkungz.codecmedia.options.PlaybackOptions
 *
 * @typedef {Object} PlaybackOptions
 * @property {boolean} dryRun          - If true, simulate playback without actually launching
 * @property {boolean} allowExternalApp - If true, allow opening with system default app
 */

/**
 * Creates a PlaybackOptions object.
 *
 * @param {object} fields
 * @param {boolean} fields.dryRun
 * @param {boolean} fields.allowExternalApp
 * @returns {PlaybackOptions}
 */
export function PlaybackOptions({ dryRun, allowExternalApp }) {
  return Object.freeze({ dryRun, allowExternalApp });
}

/**
 * Default PlaybackOptions — mirrors Java's PlaybackOptions.defaults()
 * dryRun=false, allowExternalApp=true
 *
 * @returns {PlaybackOptions}
 */
PlaybackOptions.defaults = function () {
  return PlaybackOptions({ dryRun: false, allowExternalApp: true });
};