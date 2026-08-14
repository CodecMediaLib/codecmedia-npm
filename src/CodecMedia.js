import { StubCodecMediaEngine } from "./internal/StubCodecMediaEngine.js";

/** CodecMedia facade. */
export class CodecMedia {
  constructor() {
    throw new Error("CodecMedia is not instantiable. Use CodecMedia.createDefault().");
  }

  /**
   * Create the default synchronous engine.
   *
   * The core stays dependency-free. FFmpeg/ffprobe are used only when their
   * respective opt-in options are enabled; CodecMedia never downloads them.
   *
   * @param {CreateDefaultOptions} [options={}]
   * @returns {import("./CodecMediaEngine.js").CodecMediaEngine}
   */
  static createDefault(options = {}) {
    return new StubCodecMediaEngine(options);
  }
}

/**
 * @typedef {Object} CreateDefaultOptions
 * @property {boolean} [enableFfprobeEnhancement=false]
 *   Enrich native probe results with streams/duration reported by ffprobe.
 * @property {string} [ffprobePath="ffprobe"]
 *   ffprobe executable path or command name.
 * @property {boolean} [enableFfmpegConversion=false]
 *   Enable FFmpeg-backed conversion/extraction routes that the pure JS core
 *   cannot perform itself.
 * @property {string} [ffmpegPath="ffmpeg"]
 *   FFmpeg executable path or command name.
 * @property {boolean} [strictProbe=false]
 *   Throw parser errors instead of returning a coarse format fallback.
 * @property {boolean} [requireExternalTools=false]
 *   When ffprobe enhancement is enabled, fail instead of silently falling back
 *   to the native probe if ffprobe cannot be executed or returns invalid data.
 * @property {Function|{convert: Function}} [imageToImageTranscodeConverter]
 *   Custom image-to-image converter. It takes precedence over FFmpeg.
 * @property {{convert: Function}} [conversionHub]
 *   Full conversion-hub override for advanced integrations.
 */
