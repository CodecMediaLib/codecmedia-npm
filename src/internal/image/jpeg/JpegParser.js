import { CodecMediaException } from "../../../CodecMediaException.js";

export class JpegParser {
  static isLikelyJpeg(bytes) {
    return bytes != null && bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8;
  }

  static parse(bytes) {
    if (!JpegParser.isLikelyJpeg(bytes)) {
      throw new CodecMediaException("Not a JPEG file");
    }

    let pos = 2;
    while (pos + 4 <= bytes.length) {
      const markerPrefixStart = pos;
      while (pos < bytes.length && bytes[pos] === 0xff) pos++;
      if (pos === markerPrefixStart) {
        throw new CodecMediaException("Invalid JPEG marker alignment");
      }
      if (pos >= bytes.length) {
        throw new CodecMediaException("Unexpected end of JPEG while reading marker");
      }

      const marker = bytes[pos++];
      if (marker === 0xd9 || marker === 0xda) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;

      if (pos + 2 > bytes.length) {
        throw new CodecMediaException("Unexpected end of JPEG while reading segment length");
      }
      const segmentLength = readBeShort(bytes, pos);
      if (segmentLength < 2) {
        throw new CodecMediaException(`Invalid JPEG segment length: ${segmentLength}`);
      }

      const segmentDataStart = pos + 2;
      const segmentDataLength = segmentLength - 2;
      const nextPos = segmentDataStart + segmentDataLength;
      if (nextPos > bytes.length) {
        throw new CodecMediaException("JPEG segment exceeds file bounds");
      }

      if (isSofMarker(marker)) {
        if (segmentDataLength < 6) {
          throw new CodecMediaException("Invalid SOF segment length");
        }
        const bitsPerSample = bytes[segmentDataStart];
        const height = readBeShort(bytes, segmentDataStart + 1);
        const width = readBeShort(bytes, segmentDataStart + 3);
        const channels = bytes[segmentDataStart + 5];

        if (width <= 0 || height <= 0) {
          throw new CodecMediaException("JPEG has invalid dimensions");
        }
        if (bitsPerSample !== 8 && bitsPerSample !== 12) {
          throw new CodecMediaException(`Invalid JPEG bit precision: ${bitsPerSample}`);
        }
        if (![1, 3, 4].includes(channels)) {
          throw new CodecMediaException(`Invalid JPEG component count: ${channels}`);
        }
        return Object.freeze({ width, height, bitsPerSample, channels });
      }

      pos = nextPos;
    }

    throw new CodecMediaException("JPEG SOF segment not found");
  }
}

function readBeShort(bytes, offset) {
  if (offset + 2 > bytes.length) {
    throw new CodecMediaException("Unexpected end of JPEG data");
  }
  return ((bytes[offset] & 0xff) << 8) | (bytes[offset + 1] & 0xff);
}

function isSofMarker(marker) {
  return marker === 0xc0 || marker === 0xc1 || marker === 0xc2 ||
    marker === 0xc3 || marker === 0xc5 || marker === 0xc6 ||
    marker === 0xc7 || marker === 0xc9 || marker === 0xca ||
    marker === 0xcb || marker === 0xcd || marker === 0xce ||
    marker === 0xcf;
}
