/**
 * Create playback options.
 * @param {object} [fields]
 * @param {boolean} [fields.dryRun=false]
 * @param {boolean} [fields.allowExternalApp=true]
 */
export function PlaybackOptions({ dryRun = false, allowExternalApp = true } = {}) {
  return Object.freeze({ dryRun, allowExternalApp });
}

PlaybackOptions.defaults = function () {
  return PlaybackOptions();
};
