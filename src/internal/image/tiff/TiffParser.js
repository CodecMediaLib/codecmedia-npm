import { CodecMediaException } from "../../../CodecMediaException.js";

export class TiffParser {
  static isLikelyTiff(bytes) {
    return bytes != null && bytes.length >= 8 &&
      ((bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 42 && bytes[3] === 0) ||
       (bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[2] === 0 && bytes[3] === 42));
  }

  static parse(bytes) {
    if (!TiffParser.isLikelyTiff(bytes)) {
      throw new CodecMediaException("Not a TIFF file");
    }

    const littleEndian = bytes[0] === 0x49;
    const ifdOffset = readU32(bytes, 4, littleEndian);
    if (ifdOffset < 8 || ifdOffset + 2 > bytes.length) {
      throw new CodecMediaException("Invalid TIFF IFD offset");
    }

    const entryCount = readU16(bytes, ifdOffset, littleEndian);
    let pos = ifdOffset + 2;
    const maxEntries = Math.floor((bytes.length - pos) / 12);
    if (entryCount > maxEntries) {
      throw new CodecMediaException("TIFF IFD entry count exceeds available data");
    }

    let width = null;
    let height = null;
    let bitDepth = null;
    for (let i = 0; i < entryCount; i++) {
      if (pos + 12 > bytes.length) {
        throw new CodecMediaException("Invalid TIFF IFD entry bounds");
      }
      const tag = readU16(bytes, pos, littleEndian);
      const type = readU16(bytes, pos + 2, littleEndian);
      const count = readU32(bytes, pos + 4, littleEndian);
      const valueOrOffset = readU32(bytes, pos + 8, littleEndian);

      if ((tag === 256 || tag === 257) && count >= 1) {
        const v = readTagFirstShortOrLongValue(bytes, type, count, valueOrOffset, littleEndian);
        if (v != null && v > 0) {
          if (tag === 256) width = v;
          else height = v;
        }
      } else if (tag === 258 && count >= 1) {
        const v = readTagFirstShortOrLongValue(bytes, type, count, valueOrOffset, littleEndian);
        if (v != null && v > 0) bitDepth = v;
      }
      pos += 12;
    }

    if (width == null || height == null || width <= 0 || height <= 0) {
      throw new CodecMediaException("TIFF missing width/height tags");
    }
    return Object.freeze({ width, height, bitDepth });
  }
}

function readTagFirstShortOrLongValue(bytes, type, count, valueOrOffset, littleEndian) {
  if (type === 3) {
    if (count === 1) return littleEndian ? (valueOrOffset & 0xffff) : ((valueOrOffset >>> 16) & 0xffff);
    return readU16(bytes, valueOrOffset, littleEndian);
  }
  if (type === 4) {
    if (count === 1) return valueOrOffset;
    return readU32(bytes, valueOrOffset, littleEndian);
  }
  return null;
}

function readU16(bytes, offset, littleEndian) {
  if (offset + 2 > bytes.length) throw new CodecMediaException("Unexpected end of TIFF data");
  return littleEndian
    ? (bytes[offset] & 0xff) | ((bytes[offset + 1] & 0xff) << 8)
    : ((bytes[offset] & 0xff) << 8) | (bytes[offset + 1] & 0xff);
}

function readU32(bytes, offset, littleEndian) {
  if (offset + 4 > bytes.length) throw new CodecMediaException("Unexpected end of TIFF data");
  if (littleEndian) {
    return ((bytes[offset] & 0xff) |
      ((bytes[offset + 1] & 0xff) << 8) |
      ((bytes[offset + 2] & 0xff) << 16) |
      ((bytes[offset + 3] & 0xff) << 24)) >>> 0;
  }
  return (((bytes[offset] & 0xff) * 0x1000000) +
    ((bytes[offset + 1] & 0xff) << 16) +
    ((bytes[offset + 2] & 0xff) << 8) +
    (bytes[offset + 3] & 0xff)) >>> 0;
}
