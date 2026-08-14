/**
 * PngCodec
 * Port of me.tamkungz.codecmedia.internal.image.png.PngCodec
 *
 * Note: The Java version decodes to a BufferedImage using ImageIO.
 * In Node.js there is no built-in equivalent, so this codec uses raw PNG bytes
 * as the in-memory image representation for transcode compatibility:
 *   - decode()      → reads and validates PNG bytes, returns Buffer
 *   - decodeBytes() → validates raw PNG bytes, returns same payload
 *   - probe()       → parses metadata (PngProbeInfo)
 *   - encode()      → validates and writes raw PNG bytes to disk
 *
 * If full pixel-level decode/encode is needed, integrate a library such as
 * `sharp` or `pngjs` and extend these methods accordingly.
 */
import fs from "fs";
import { CodecMediaException } from "../../../CodecMediaException.js";
import { PngParser } from "./PngParser.js";

export class PngCodec {
  /**
   * Decode from file path.
   * @param {string} input
   * @returns {Buffer}
   * @throws {CodecMediaException}
   */
  static decode(input) {
    let bytes;
    try {
      bytes = fs.readFileSync(input);
    } catch (e) {
      throw new CodecMediaException(`Failed to decode PNG: ${input}`, e);
    }
    return PngCodec.decodeBytes(bytes, input);
  }

  /**
   * Decode from raw Buffer.
   * @param {Buffer | Uint8Array} bytes
   * @param {string} [sourceRef] - path reference for error messages
   * @returns {Buffer | Uint8Array}
   * @throws {CodecMediaException}
   */
  static decodeBytes(bytes, sourceRef = "<buffer>") {
    if (!bytes || bytes.length === 0) {
      throw new CodecMediaException("PNG data is empty");
    }
    const info = PngParser.parse(bytes);
    validateDecodedInfo(info, sourceRef);
    return bytes;
  }

  /**
   * Parse PNG metadata from raw bytes.
   * @param {Buffer | Uint8Array} bytes
   * @param {string} [sourceRef]
   * @returns {import("./PngProbeInfo.js").PngProbeInfo}
   */
  static probe(bytes, sourceRef = "<buffer>") {
    const info = PngParser.parse(bytes);
    validateDecodedInfo(info, sourceRef);
    return info;
  }

  /**
   * Write PNG data to file.
   * @param {Buffer | Uint8Array} encodedPngData
   * @param {string} output
   * @throws {CodecMediaException}
   */
  static encode(encodedPngData, output) {
    PngCodec.decodeBytes(encodedPngData, output);
    try {
      fs.writeFileSync(output, encodedPngData);
    } catch (e) {
      throw new CodecMediaException(`Failed to encode PNG: ${output}`, e);
    }
  }
}

// ─── Private helpers ──────────────────────────────────────────────────────────

/**
 * Validate probe info returned by the parser.
 * Mirrors the checks in Java's validateDecodedImage().
 * @param {import("./PngProbeInfo.js").PngProbeInfo} info
 * @param {string} input
 * @throws {CodecMediaException}
 */
function validateDecodedInfo(info, input) {
  if (info.width <= 0 || info.height <= 0) {
    throw new CodecMediaException(`Decoded PNG has invalid dimensions: ${input}`);
  }
  if (info.bitDepth <= 0) {
    throw new CodecMediaException(`Decoded PNG has invalid bit depth: ${input}`);
  }
}
