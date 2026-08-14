/**
 * Create validation options.
 * @param {object} [fields]
 * @param {boolean} [fields.strict=false]
 * @param {number} [fields.maxBytes=524288000]
 */
export function ValidationOptions({ strict = false, maxBytes = 500 * 1024 * 1024 } = {}) {
  return Object.freeze({ strict, maxBytes });
}

ValidationOptions.defaults = function () {
  return ValidationOptions();
};
