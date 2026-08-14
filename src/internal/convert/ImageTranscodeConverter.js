/**
 * ImageTranscodeConverter
 * Port of me.tamkungz.codecmedia.internal.convert.ImageTranscodeConverter
 *
 * Delegates encode/decode to image codec modules registered via registerParser().
 * Codec modules must expose static decode(input: string) and encode(image, output: string).
 */
import fs   from "fs";
import path from "path";
import { CodecMediaException } from "../../CodecMediaException.js";
import { ConversionResult }    from "../../model/ConversionResult.js";

const SUPPORTED_EXTENSIONS = new Set([
  "png", "jpg", "jpeg", "webp", "bmp", "tif", "tiff", "heif", "heic",
]);

export class ImageTranscodeConverter {
  /**
   * @param {import("./ConversionRequest.js").ConversionRequest} request
   * @returns {import("../model/ConversionResult.js").ConversionResult}
   * @throws {CodecMediaException}
   */
  convert(request) {
    const source = normalizeExt(request.sourceExtension);
    const target = normalizeExt(request.targetExtension);

    if (!SUPPORTED_EXTENSIONS.has(source) || !SUPPORTED_EXTENSIONS.has(target)) {
      throw new CodecMediaException(
        "image->image transcoding currently supports png/jpg/jpeg/webp/bmp/tiff/heif/heic"
      );
    }

    const { output, options } = request;

    try {
      const parent = path.dirname(output);
      if (parent) fs.mkdirSync(parent, { recursive: true });
    } catch (e) {
      throw new CodecMediaException(`Failed to prepare output path: ${output}`, e);
    }

    if (fs.existsSync(output) && !options.overwrite) {
      throw new CodecMediaException(`Output already exists and overwrite is disabled: ${output}`);
    }

    const inputImage = decodeByExtension(source, request.input);
    encodeByExtension(target, inputImage, output);

    return ConversionResult({ outputFile: output, format: target, reencoded: true });
  }
}

// ─── Codec dispatch ───────────────────────────────────────────────────────────

/** Lazy codec registry — populated by registerImageCodec() calls. */
const IMAGE_CODEC_REGISTRY = {};

/**
 * Register an image codec module for a given extension key.
 * The module must expose: static decode(inputPath) and static encode(image, outputPath[, ext]).
 * @param {string} ext  - lowercase extension without dot (e.g. "png")
 * @param {object} codec
 */
export function registerImageCodec(ext, codec) {
  IMAGE_CODEC_REGISTRY[ext] = codec;
}

/**
 * @param {string} ext
 * @param {string} inputPath
 * @returns {*} decoded image object
 * @throws {CodecMediaException}
 */
function decodeByExtension(ext, inputPath) {
  const codec = IMAGE_CODEC_REGISTRY[ext];
  if (!codec) throw new CodecMediaException(`No image codec registered for source extension: ${ext}`);
  try {
    return codec.decode(inputPath);
  } catch (e) {
    if (e instanceof CodecMediaException) throw e;
    throw new CodecMediaException(`Failed to decode image (${ext}): ${inputPath}`, e);
  }
}

/**
 * @param {string} ext
 * @param {*}      image
 * @param {string} outputPath
 * @throws {CodecMediaException}
 */
function encodeByExtension(ext, image, outputPath) {
  const codec = IMAGE_CODEC_REGISTRY[ext];
  if (!codec) throw new CodecMediaException(`No image codec registered for target extension: ${ext}`);
  try {
    // heif/heic codecs may need the extension hint
    codec.encode(image, outputPath, ext);
  } catch (e) {
    if (e instanceof CodecMediaException) throw e;
    throw new CodecMediaException(`Failed to encode image (${ext}): ${outputPath}`, e);
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normalizeExt(ext) {
  if (!ext) return "";
  const v = ext.trim().toLowerCase();
  return v.startsWith(".") ? v.slice(1) : v;
}