/**
 * Metadata
 * Port of me.tamkungz.codecmedia.model.Metadata
 *
 * @typedef {Object} Metadata
 * @property {Record<string, string>} entries - Key-value metadata entries
 */

/**
 * Creates a Metadata object (mirrors Java record constructor).
 *
 * @param {object} fields
 * @param {Record<string, string>} fields.entries
 * @returns {Metadata}
 */
export function Metadata({ entries = {} }) {
  return Object.freeze({
    entries: Object.freeze({ ...entries }),
  });
}