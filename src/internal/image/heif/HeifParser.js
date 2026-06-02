import { CodecMediaException } from "../../../CodecMediaException.js";

const FULL_BOX_HEADER_SIZE = 4;
const MAX_BOX_SEARCH_DEPTH = 64;

export class HeifParser {
  static isLikelyHeif(bytes) {
    return bytes != null && bytes.length >= 12 &&
      readAscii(bytes, 4, 4) === "ftyp" &&
      isHeifBrand(readAscii(bytes, 8, 4));
  }

  static parse(bytes) {
    if (!HeifParser.isLikelyHeif(bytes)) {
      throw new CodecMediaException("Not a HEIF/HEIC file");
    }
    const majorBrand = readAscii(bytes, 8, 4);
    const ispe = findBoxData(bytes, "ispe");
    const pixi = findBoxData(bytes, "pixi");
    const width = extractIspeWidth(ispe);
    const height = extractIspeHeight(ispe);
    const bitDepth = extractPixiBitDepth(pixi);
    return Object.freeze({ majorBrand, width, height, bitDepth });
  }
}

function isHeifBrand(brand) {
  return ["heic", "heix", "hevc", "hevx", "mif1", "msf1", "heif", "avif", "avis"].includes(brand);
}

function extractIspeWidth(ispe) {
  if (ispe == null || ispe.payloadOffset + 12 > ispe.boxEnd) return null;
  const width = readBeInt(ispe.bytes, ispe.payloadOffset + 4);
  return width > 0 ? width : null;
}

function extractIspeHeight(ispe) {
  if (ispe == null || ispe.payloadOffset + 12 > ispe.boxEnd) return null;
  const height = readBeInt(ispe.bytes, ispe.payloadOffset + 8);
  return height > 0 ? height : null;
}

function extractPixiBitDepth(pixi) {
  if (pixi == null) return null;
  const bytes = pixi.bytes;
  const payloadOffset = pixi.payloadOffset;
  const version = bytes[payloadOffset] & 0xff;
  if (version !== 0) return null;
  const dataOffset = payloadOffset + FULL_BOX_HEADER_SIZE;
  if (dataOffset + 1 > pixi.boxEnd) return null;
  const channelCount = bytes[dataOffset] & 0xff;
  if (channelCount <= 0 || dataOffset + 1 + channelCount > pixi.boxEnd) return null;
  let minDepth = Number.MAX_SAFE_INTEGER;
  for (let i = 0; i < channelCount; i++) {
    const depth = bytes[dataOffset + 1 + i] & 0xff;
    if (depth > 0 && depth < minDepth) minDepth = depth;
  }
  return minDepth === Number.MAX_SAFE_INTEGER ? null : minDepth;
}

function findBoxData(bytes, boxType, startOffset = 0, endOffset = bytes.length, depth = 0) {
  if (depth > MAX_BOX_SEARCH_DEPTH) return null;
  let offset = startOffset > 0 ? startOffset : 0;
  while (offset + 8 <= endOffset) {
    const start = offset;
    let size = readU32AsNumber(bytes, offset);
    const type = readAscii(bytes, offset + 4, 4);
    let headerSize = 8;

    if (size === 1) {
      if (offset + 16 > endOffset) break;
      size = readU64AsSafeNumber(bytes, offset + 8);
      headerSize = 16;
    } else if (size === 0) {
      size = endOffset - offset;
    }

    if (size < headerSize) break;
    const end = offset + size;
    if (end > endOffset || end <= offset) break;

    if (boxType === type) {
      return { bytes, boxStart: start, payloadOffset: offset + headerSize, boxEnd: end };
    }

    if (isContainerType(type)) {
      let childStart = offset + headerSize;
      if (type === "meta" && childStart + FULL_BOX_HEADER_SIZE <= end) {
        childStart += FULL_BOX_HEADER_SIZE;
      }
      const nested = findBoxData(bytes, boxType, childStart, end, depth + 1);
      if (nested != null) return nested;
    }

    offset = end;
  }
  return null;
}

function isContainerType(type) {
  return [
    "meta", "moov", "trak", "mdia", "minf", "stbl", "dinf", "edts", "udta",
    "iprp", "ipco", "iinf", "iloc", "iref", "grpl", "strk", "meco", "mere",
    "traf", "mvex", "moof", "sinf", "schi", "hnti", "hinf", "wave", "ilst",
    "tref", "mfra", "jp2h", "res ", "uuid", "ipro", "sgrp", "fiin", "paen",
    "trgr", "kind", "ipma", "pitm",
  ].includes(type);
}

function readAscii(bytes, offset, length) {
  if (offset + length > bytes.length) return "";
  return Buffer.from(bytes).subarray(offset, offset + length).toString("ascii");
}

function readU32AsNumber(bytes, offset) {
  if (offset + 4 > bytes.length) return -1;
  return ((bytes[offset] & 0xff) * 0x1000000) +
    ((bytes[offset + 1] & 0xff) << 16) +
    ((bytes[offset + 2] & 0xff) << 8) +
    (bytes[offset + 3] & 0xff);
}

function readU64AsSafeNumber(bytes, offset) {
  if (offset + 8 > bytes.length) return -1;
  const value = (BigInt(bytes[offset] & 0xff) << 56n) |
    (BigInt(bytes[offset + 1] & 0xff) << 48n) |
    (BigInt(bytes[offset + 2] & 0xff) << 40n) |
    (BigInt(bytes[offset + 3] & 0xff) << 32n) |
    (BigInt(bytes[offset + 4] & 0xff) << 24n) |
    (BigInt(bytes[offset + 5] & 0xff) << 16n) |
    (BigInt(bytes[offset + 6] & 0xff) << 8n) |
    BigInt(bytes[offset + 7] & 0xff);
  return value > BigInt(Number.MAX_SAFE_INTEGER) ? -1 : Number(value);
}

function readBeInt(bytes, offset) {
  if (offset < 0 || offset + 4 > bytes.length) {
    throw new CodecMediaException("Unexpected end of HEIF data");
  }
  return ((bytes[offset] & 0xff) * 0x1000000) +
    ((bytes[offset + 1] & 0xff) << 16) +
    ((bytes[offset + 2] & 0xff) << 8) +
    (bytes[offset + 3] & 0xff);
}
