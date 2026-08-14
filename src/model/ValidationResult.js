/**
 * ValidationResult
 * Port of me.tamkungz.codecmedia.model.ValidationResult
 *
 * @typedef {Object} ValidationResult
 * @property {boolean}  valid    - Whether validation passed
 * @property {string[]} warnings - Non-fatal warnings
 * @property {string[]} errors   - Fatal errors
 */

/**
 * Creates a ValidationResult object (mirrors Java record constructor).
 *
 * @param {object} fields
 * @param {boolean}  fields.valid
 * @param {string[]} [fields.warnings]
 * @param {string[]} [fields.errors]
 * @returns {ValidationResult}
 */
export function ValidationResult({ valid, warnings = [], errors = [] }) {
  return Object.freeze({
    valid,
    warnings: Object.freeze([...warnings]),
    errors:   Object.freeze([...errors]),
  });
}