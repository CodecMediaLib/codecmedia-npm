/**
 * Create conversion options.
 * @param {object} [fields]
 * @param {string} [fields.targetFormat=""]
 * @param {string} [fields.preset="balanced"]
 * @param {boolean} [fields.overwrite=false]
 */
export function ConversionOptions({ targetFormat = "", preset = "balanced", overwrite = false } = {}) {
  return Object.freeze({ targetFormat, preset, overwrite });
}

ConversionOptions.defaults = function (targetFormat = "") {
  return ConversionOptions({ targetFormat, preset: "balanced", overwrite: false });
};
