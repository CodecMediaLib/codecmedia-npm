import { CodecMediaException } from "../../../CodecMediaException.js";

export class BmpParser {
  static isLikelyBmp(bytes) {
    return bytes != null && bytes.length >= 26 && bytes[0] === 0x42 && bytes[1] === 0x4d;
  }

  static parse(bytes) {
    if (!BmpParser.isLikelyBmp(bytes)) {
      throw new CodecMediaException("Not a BMP file");
    }

    const dibHeaderSize = readU32LE(bytes, 14);
    if (dibHeaderSize < 12) {
      throw new CodecMediaException(`Unsupported BMP DIB header size: ${dibHeaderSize}`);
    }
    if (14 + dibHeaderSize > bytes.length) {
      throw new CodecMediaException("BMP DIB header truncated");
    }

    let width;
    let height;
    let bitsPerPixel;
    if (dibHeaderSize === 12) {
      width = readU16LE(bytes, 18);
      height = readU16LE(bytes, 20);
      bitsPerPixel = readU16LE(bytes, 24);
    } else {
      width = readI32LE(bytes, 18);
      height = Math.abs(readI32LE(bytes, 22));
      bitsPerPixel = readU16LE(bytes, 28);
    }

    if (width <= 0 || height <= 0) {
      throw new CodecMediaException("BMP has invalid dimensions");
    }
    if (![1, 2, 4, 8, 16, 24, 32].includes(bitsPerPixel)) {
      throw new CodecMediaException(`BMP has invalid bits-per-pixel: ${bitsPerPixel}`);
    }

    return Object.freeze({ width, height, bitsPerPixel });
  }
}

function readU16LE(bytes, offset) {
  if (offset + 2 > bytes.length) throw new CodecMediaException("Unexpected end of BMP data");
  return (bytes[offset] & 0xff) | ((bytes[offset + 1] & 0xff) << 8);
}

function readU32LE(bytes, offset) {
  if (offset + 4 > bytes.length) throw new CodecMediaException("Unexpected end of BMP data");
  return ((bytes[offset] & 0xff) |
    ((bytes[offset + 1] & 0xff) << 8) |
    ((bytes[offset + 2] & 0xff) << 16) |
    ((bytes[offset + 3] & 0xff) << 24)) >>> 0;
}

function readI32LE(bytes, offset) {
  if (offset + 4 > bytes.length) throw new CodecMediaException("Unexpected end of BMP data");
  return (bytes[offset] & 0xff) |
    ((bytes[offset + 1] & 0xff) << 8) |
    ((bytes[offset + 2] & 0xff) << 16) |
    ((bytes[offset + 3] & 0xff) << 24);
}
