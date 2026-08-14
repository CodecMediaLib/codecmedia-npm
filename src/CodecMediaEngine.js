import { CodecMediaException } from "./CodecMediaException.js";

export class CodecMediaEngine {

  /**
   * Convenience alias of {@link probe}.
   *
   * @param {string} input - media file path
   * @returns {ProbeResult}
   * @throws {CodecMediaException}
   */
  // eslint-disable-next-line no-unused-vars
  get(input) {
    throw new CodecMediaException("get() is not implemented");
  }

  /**
   * Detects media format and returns technical stream/container information.
   *
   * @param {string} input - media file path
   * @returns {ProbeResult}
   * @throws {CodecMediaException}
   */
  // eslint-disable-next-line no-unused-vars
  probe(input) {
    throw new CodecMediaException("probe() is not implemented");
  }

  /**
   * Reads metadata associated with the file.
   * Includes sidecar metadata plus base probe fields.
   *
   * @param {string} input - media file path
   * @returns {Metadata}
   * @throws {CodecMediaException}
   */
  // eslint-disable-next-line no-unused-vars
  readMetadata(input) {
    throw new CodecMediaException("readMetadata() is not implemented");
  }

  /**
   * Writes metadata associated with the file.
   * Writes a sidecar .codecmedia.properties file next to the input.
   *
   * @param {string} input - media file path
   * @param {Metadata} metadata - metadata entries to persist
   * @returns {void}
   * @throws {CodecMediaException}
   */
  // eslint-disable-next-line no-unused-vars
  writeMetadata(input, metadata) {
    throw new CodecMediaException("writeMetadata() is not implemented");
  }

  /**
   * Extracts audio from an input media file into the given output directory.
   *
   * @param {string} input - source media file
   * @param {string} outputDir - target directory for extracted output
   * @param {AudioExtractOptions | null} options - extraction options
   * @returns {ExtractionResult}
   * @throws {CodecMediaException}
   */
  // eslint-disable-next-line no-unused-vars
  extractAudio(input, outputDir, options) {
    throw new CodecMediaException("extractAudio() is not implemented");
  }

  /**
   * Converts media according to the requested options.
   *
   * @param {string} input - source media file
   * @param {string} output - output media file path
   * @param {ConversionOptions | null} options - conversion options
   * @returns {ConversionResult}
   * @throws {CodecMediaException}
   */
  // eslint-disable-next-line no-unused-vars
  convert(input, output, options) {
    throw new CodecMediaException("convert() is not implemented");
  }

  /**
   * Starts playback/viewing for supported media.
   *
   * @param {string} input - source media file
   * @param {PlaybackOptions | null} options - playback options
   * @returns {PlaybackResult}
   * @throws {CodecMediaException}
   */
  // eslint-disable-next-line no-unused-vars
  play(input, options) {
    throw new CodecMediaException("play() is not implemented");
  }

  /**
   * Validates file existence and optional strict format constraints.
   *
   * @param {string} input - media file path
   * @param {ValidationOptions | null} options - validation options
   * @returns {ValidationResult}
   * @throws {CodecMediaException}
   */
  // eslint-disable-next-line no-unused-vars
  validate(input, options) {
    throw new CodecMediaException("validate() is not implemented");
  }
}

/**
 * @typedef {Object} ProbeResult
 * @typedef {Object} Metadata
 * @typedef {Object} ExtractionResult
 * @typedef {Object} ConversionResult
 * @typedef {Object} PlaybackResult
 * @typedef {Object} ValidationResult
 * @typedef {Object} AudioExtractOptions
 * @typedef {Object} ConversionOptions
 * @typedef {Object} PlaybackOptions
 * @typedef {Object} ValidationOptions
 */