/**
 * ValidationOptions
 * Port of me.tamkungz.codecmedia.options.ValidationOptions
 *
 * @typedef {Object} ValidationOptions
 * @property {boolean} strict   - Enable strict parser-level checks
 * @property {number}  maxBytes - Maximum allowed file size in bytes
 */

/**
 * Creates a ValidationOptions object.
 *
 * @param {object} fields
 * @param {boolean} fields.strict
 * @param {number}  fields.maxBytes
 * @returns {ValidationOptions}
 */
export function ValidationOptions({ strict, maxBytes }) {
  return Object.freeze({ strict, maxBytes });
}

/**
 * Default ValidationOptions — mirrors Java's ValidationOptions.defaults()
 * strict=false, maxBytes=500MB
 *
 * @returns {ValidationOptions}
 */
ValidationOptions.defaults = function () {
  return ValidationOptions({ strict: false, maxBytes: 500 * 1024 * 1024 });
};