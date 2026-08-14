/**
 * ProbeResult
 * Port of me.tamkungz.codecmedia.model.ProbeResult
 *
 * @typedef {Object} ProbeResult
 * @property {string}                    input         - Input file path
 * @property {string}                    mimeType      - MIME type
 * @property {string}                    extension     - File extension (without dot)
 * @property {import("./MediaType.js").MediaType} mediaType - Media type category
 * @property {number|null}               durationMillis - Duration in milliseconds
 * @property {import("./StreamInfo.js").StreamInfo[]} streams - Detected streams
 * @property {Record<string, string>}    tags          - Basic embedded tags
 */

/**
 * Creates a ProbeResult object (mirrors Java record constructor).
 *
 * @param {object} fields
 * @param {string}       fields.input
 * @param {string}       fields.mimeType
 * @param {string}       fields.extension
 * @param {string}       fields.mediaType
 * @param {number|null}  [fields.durationMillis]
 * @param {Array}        [fields.streams]
 * @param {object}       [fields.tags]
 * @returns {ProbeResult}
 */
export function ProbeResult({
  input,
  mimeType,
  extension,
  mediaType,
  durationMillis = null,
  streams        = [],
  tags           = {},
}) {
  return Object.freeze({
    input,
    mimeType,
    extension,
    mediaType,
    durationMillis,
    streams: Object.freeze([...streams]),
    tags:    Object.freeze({ ...tags }),
  });
}