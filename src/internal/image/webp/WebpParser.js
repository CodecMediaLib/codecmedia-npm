import { CodecMediaException } from "../../../CodecMediaException.js";

const ASSUMED_WEBP_BIT_DEPTH = 8;
const RIFF_HEADER_SIZE = 12;
const CHUNK_HEADER_SIZE = 8;
const FIRST_CHUNK_OFFSET = RIFF_HEADER_SIZE;
const FIRST_CHUNK_DATA_OFFSET = FIRST_CHUNK_OFFSET + CHUNK_HEADER_SIZE;

export class WebpParser {
  static isLikelyWebp(bytes) {
    if (bytes == null || bytes.length < RIFF_HEADER_SIZE) return false;
    const magic = ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP";
    if (!magic) return false;
    const riffDeclaredSize = readLeUInt32Unchecked(bytes, 4);
    return riffDeclaredSize + 8 <= bytes.length;
  }

  static parse(bytes) {
    if (!WebpParser.isLikelyWebp(bytes)) {
      throw new CodecMediaException("Not a WebP file");
    }
    if (bytes.length < FIRST_CHUNK_DATA_OFFSET) {
      throw new CodecMediaException("WebP is too small");
    }

    const chunkType = ascii(bytes, FIRST_CHUNK_OFFSET, 4);
    if (chunkType === "VP8 ") return parseVp8(bytes);
    if (chunkType === "VP8L") return parseVp8L(bytes);
    if (chunkType === "VP8X") return parseVp8X(bytes);
    throw new CodecMediaException(`Unsupported WebP chunk type: ${chunkType}`);
  }
}

function parseVp8X(bytes) {
  ensureFirstChunkPayload(bytes, 10, "VP8X");
  const widthMinus1 = (bytes[24] & 0xff) | ((bytes[25] & 0xff) << 8) | ((bytes[26] & 0xff) << 16);
  const heightMinus1 = (bytes[27] & 0xff) | ((bytes[28] & 0xff) << 8) | ((bytes[29] & 0xff) << 16);
  return ensurePositive(widthMinus1 + 1, heightMinus1 + 1, ASSUMED_WEBP_BIT_DEPTH, "VP8X");
}

function parseVp8L(bytes) {
  ensureFirstChunkPayload(bytes, 5, "VP8L");
  if ((bytes[20] & 0xff) !== 0x2f) {
    throw new CodecMediaException("Invalid WebP VP8L signature byte");
  }
  const b1 = bytes[21] & 0xff;
  const b2 = bytes[22] & 0xff;
  const b3 = bytes[23] & 0xff;
  const b4 = bytes[24] & 0xff;
  const widthMinus1 = b1 | ((b2 & 0x3f) << 8);
  const heightMinus1 = ((b2 >> 6) & 0x03) | (b3 << 2) | ((b4 & 0x0f) << 10);
  return ensurePositive(widthMinus1 + 1, heightMinus1 + 1, ASSUMED_WEBP_BIT_DEPTH, "VP8L");
}

function parseVp8(bytes) {
  ensureFirstChunkPayload(bytes, 10, "VP8");
  if ((bytes[FIRST_CHUNK_DATA_OFFSET] & 0x01) !== 0) {
    throw new CodecMediaException("Invalid WebP VP8 frame type: expected key frame");
  }
  if ((bytes[23] & 0xff) !== 0x9d || (bytes[24] & 0xff) !== 0x01 || (bytes[25] & 0xff) !== 0x2a) {
    throw new CodecMediaException("Invalid WebP VP8 frame start code");
  }
  const width = ((bytes[27] & 0x3f) << 8) | (bytes[26] & 0xff);
  const height = ((bytes[29] & 0x3f) << 8) | (bytes[28] & 0xff);
  return ensurePositive(width, height, ASSUMED_WEBP_BIT_DEPTH, "VP8");
}

function ensureFirstChunkPayload(bytes, requiredPayloadBytes, variant) {
  const payloadLength = readLeUInt32(bytes, 16);
  const payloadStart = FIRST_CHUNK_DATA_OFFSET;
  const payloadEnd = payloadStart + payloadLength;
  if (payloadLength < requiredPayloadBytes) {
    throw new CodecMediaException(`Invalid WebP ${variant} chunk length`);
  }
  if (payloadEnd > bytes.length || payloadStart + requiredPayloadBytes > bytes.length) {
    throw new CodecMediaException(`Invalid WebP ${variant} chunk bounds`);
  }
}

function ensurePositive(width, height, bitDepth, variant) {
  if (width <= 0 || height <= 0) {
    throw new CodecMediaException(`WebP ${variant} has invalid dimensions`);
  }
  return Object.freeze({ width, height, bitDepth });
}

function ascii(bytes, offset, length) {
  if (offset + length > bytes.length) return "";
  return Buffer.from(bytes).subarray(offset, offset + length).toString("ascii");
}

function readLeUInt32(bytes, offset) {
  if (offset < 0 || offset + 4 > bytes.length) {
    throw new CodecMediaException("Unexpected end of WebP data");
  }
  return readLeUInt32Unchecked(bytes, offset);
}

function readLeUInt32Unchecked(bytes, offset) {
  return (bytes[offset] & 0xff) +
    ((bytes[offset + 1] & 0xff) << 8) +
    ((bytes[offset + 2] & 0xff) << 16) +
    ((bytes[offset + 3] & 0xff) * 0x1000000);
}
