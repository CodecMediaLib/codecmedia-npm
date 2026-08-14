/**
 * PngParser
 * Port of me.tamkungz.codecmedia.internal.image.png.PngParser
 */
import { CodecMediaException } from "../../../CodecMediaException.js";
import { PngProbeInfo } from "./PngProbeInfo.js";

const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export class PngParser {
  /**
   * Check whether the given bytes start with the PNG signature.
   * @param {Buffer | Uint8Array} bytes
   * @returns {boolean}
   */
  static isLikelyPng(bytes) {
    if (bytes == null || bytes.length < PNG_SIGNATURE.length) return false;
    for (let i = 0; i < PNG_SIGNATURE.length; i++) {
      if (bytes[i] !== PNG_SIGNATURE[i]) return false;
    }
    return true;
  }

  /**
   * Parse raw PNG bytes and return probe metadata from the IHDR chunk.
   * @param {Buffer | Uint8Array} bytes
   * @returns {PngProbeInfo}
   * @throws {CodecMediaException}
   */
  static parse(bytes) {
    if (!PngParser.isLikelyPng(bytes)) {
      throw new CodecMediaException("Not a PNG file");
    }

    if (bytes.length < 33) {
      throw new CodecMediaException("PNG is too small");
    }

    const ihdrLength = readBeInt(bytes, 8);
    if (ihdrLength !== 13) {
      throw new CodecMediaException(`Invalid IHDR length: ${ihdrLength}`);
    }

    if (!(bytes[12] === 0x49 && bytes[13] === 0x48 && bytes[14] === 0x44 && bytes[15] === 0x52)) {
      // 'I','H','D','R'
      throw new CodecMediaException("PNG missing IHDR chunk");
    }

    const width     = readBeInt(bytes, 16);
    const height    = readBeInt(bytes, 20);
    const bitDepth  = bytes[24] & 0xff;
    const colorType = bytes[25] & 0xff;

    if (width <= 0 || height <= 0) {
      throw new CodecMediaException("PNG has invalid dimensions");
    }
    if (![1, 2, 4, 8, 16].includes(bitDepth)) {
      throw new CodecMediaException(`PNG has invalid bit depth: ${bitDepth}`);
    }
    const validCombination =
      (colorType === 0 && [1, 2, 4, 8, 16].includes(bitDepth)) ||
      (colorType === 2 && [8, 16].includes(bitDepth)) ||
      (colorType === 3 && [1, 2, 4, 8].includes(bitDepth)) ||
      (colorType === 4 && [8, 16].includes(bitDepth)) ||
      (colorType === 6 && [8, 16].includes(bitDepth));
    if (!validCombination) {
      throw new CodecMediaException(`PNG has invalid bit depth/color type combination: bitDepth=${bitDepth}, colorType=${colorType}`);
    }

    return PngProbeInfo({ width, height, bitDepth, colorType });
  }
}

// ─── Byte utilities ───────────────────────────────────────────────────────────

/**
 * Read a big-endian 32-bit signed integer.
 * @param {Buffer | Uint8Array} bytes
 * @param {number} offset
 * @returns {number}
 * @throws {CodecMediaException}
 */
function readBeInt(bytes, offset) {
  if (offset + 4 > bytes.length) {
    throw new CodecMediaException("Unexpected end of PNG data");
  }
  return (
    ((bytes[offset]     & 0xff) << 24) |
    ((bytes[offset + 1] & 0xff) << 16) |
    ((bytes[offset + 2] & 0xff) <<  8) |
     (bytes[offset + 3] & 0xff)
  );
}