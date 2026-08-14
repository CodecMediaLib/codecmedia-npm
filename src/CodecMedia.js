import { StubCodecMediaEngine } from "./internal/StubCodecMediaEngine.js";

/**
 * CodecMedia
 *
 * @example
 * import { CodecMedia } from "./CodecMedia.js";
 *
 * const engine = CodecMedia.createDefault({
 *   enableFfprobeEnhancement: false,
 * });
 *
 * const probe = engine.probe("./sample.mp4");
 */
export class CodecMedia {

  // Prevent instantiation — mirrors Java's private constructor
  constructor() {
    throw new Error("CodecMedia is not instantiable. Use CodecMedia.createDefault().");
  }

  /**
   * Creates and returns the default CodecMedia engine instance.
   *
   * @param {CreateDefaultOptions} [options={}]
   * @returns {import("./CodecMediaEngine.js").CodecMediaEngine}
   *
   * @example
   * const engine = CodecMedia.createDefault({ enableFfprobeEnhancement: true });
   */
  static createDefault(options = {}) {
    return new StubCodecMediaEngine(options);
  }
}

/**
 * @typedef {Object} CreateDefaultOptions
 * @property {boolean} [enableFfprobeEnhancement=false]
 *   Opt-in to enrich MOV/MP4/WebM probe output using ffprobe when available.
 * @property {Function} [imageToImageTranscodeConverter]
 *   Optional override for image-to-image transcode conversion behavior.
 */