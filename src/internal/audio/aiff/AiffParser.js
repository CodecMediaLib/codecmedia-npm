import { CodecMediaException } from "../../../CodecMediaException.js";

const TEXT_CHUNK_TO_METADATA = Object.freeze({
  NAME: "title",
  AUTH: "artist",
  "(c) ": "copyright",
  ANNO: "comment",
});

export class AiffParser {
  static isLikelyAiff(bytes) {
    return bytes != null && bytes.length >= 12 &&
      ascii(bytes, 0, 4) === "FORM" &&
      (ascii(bytes, 8, 4) === "AIFF" || ascii(bytes, 8, 4) === "AIFC");
  }

  static parse(bytes) {
    if (!AiffParser.isLikelyAiff(bytes)) {
      throw new CodecMediaException("Not an AIFF file");
    }

    const aifc = bytes[11] === 0x43;
    let offset = 12;
    let channels = null;
    let bitsPerSample = null;
    let sampleRate = null;
    let frameCount = null;

    while (offset + 8 <= bytes.length) {
      const chunkId = ascii(bytes, offset, 4);
      const chunkSize = readBeInt(bytes, offset + 4);
      if (chunkSize < 0) throw new CodecMediaException(`Invalid AIFF chunk size: ${chunkSize}`);

      const chunkDataStart = offset + 8;
      if (chunkDataStart + chunkSize > bytes.length) {
        throw new CodecMediaException(`AIFF chunk exceeds file bounds: ${chunkId}`);
      }

      if (chunkId === "COMM") {
        if (chunkSize < 18) throw new CodecMediaException("AIFF COMM chunk too small");
        channels = readBeShort(bytes, chunkDataStart);
        frameCount = readBeUInt32(bytes, chunkDataStart + 2);
        bitsPerSample = readBeShort(bytes, chunkDataStart + 6);
        sampleRate = decodeExtended80ToIntHz(bytes, chunkDataStart + 8);
        if (aifc) {
          if (chunkSize < 22) throw new CodecMediaException("AIFC COMM chunk missing compression type");
          const compressionType = ascii(bytes, chunkDataStart + 18, 4);
          if (compressionType !== "NONE" && compressionType !== "sowt") {
            throw new CodecMediaException(`Unsupported AIFC compression type: ${compressionType}`);
          }
        }
      }

      offset = chunkDataStart + ((chunkSize & 1) === 0 ? chunkSize : chunkSize + 1);
    }

    if (channels == null || bitsPerSample == null || sampleRate == null || frameCount == null) {
      throw new CodecMediaException("AIFF missing required COMM chunk fields");
    }
    if (channels <= 0 || bitsPerSample <= 0 || sampleRate <= 0 || frameCount < 0) {
      throw new CodecMediaException("Invalid AIFF format values");
    }

    const durationMillis = Math.floor((frameCount * 1000) / sampleRate);
    const byteRate = Math.floor((sampleRate * channels * bitsPerSample) / 8);
    const bitrateKbps = Math.floor((byteRate * 8) / 1000);
    return Object.freeze({ durationMillis, bitrateKbps, sampleRate, channels, bitrateMode: "CBR" });
  }

  static readTextMetadata(bytes) {
    if (!AiffParser.isLikelyAiff(bytes)) {
      throw new CodecMediaException("Not an AIFF file");
    }

    const out = {};
    let offset = 12;
    while (offset + 8 <= bytes.length) {
      const chunkId = ascii(bytes, offset, 4);
      const chunkSize = readBeInt(bytes, offset + 4);
      if (chunkSize < 0) throw new CodecMediaException(`Invalid AIFF chunk size: ${chunkSize}`);

      const chunkDataStart = offset + 8;
      const chunkDataEnd = chunkDataStart + chunkSize;
      if (chunkDataEnd < chunkDataStart || chunkDataEnd > bytes.length) {
        throw new CodecMediaException(`AIFF chunk exceeds file bounds: ${chunkId}`);
      }

      const key = TEXT_CHUNK_TO_METADATA[chunkId];
      if (key != null) {
        let end = chunkDataEnd;
        while (end > chunkDataStart && [0, 0x20, 0x0a, 0x0d].includes(bytes[end - 1])) end--;
        const value = Buffer.from(bytes).subarray(chunkDataStart, end).toString("utf8").trim();
        if (value) out[key] = value;
      }

      offset = chunkDataStart + ((chunkSize & 1) === 0 ? chunkSize : chunkSize + 1);
    }
    return out;
  }
}

function decodeExtended80ToIntHz(bytes, offset) {
  if (offset + 10 > bytes.length) throw new CodecMediaException("Unexpected end of AIFF data");
  const exp = ((bytes[offset] & 0x7f) << 8) | (bytes[offset + 1] & 0xff);
  let mantissa = 0n;
  for (let i = 0; i < 8; i++) {
    mantissa = (mantissa << 8n) | BigInt(bytes[offset + 2 + i] & 0xff);
  }
  if (exp === 0 || mantissa === 0n) return 0;

  const shift = exp - 16383 - 63;
  const value = shift >= 0
    ? mantissa << BigInt(Math.min(shift, 30))
    : mantissa >> BigInt(Math.min(-shift, 63));
  if (value <= 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new CodecMediaException("Unsupported AIFF sample rate encoding");
  }
  return Number(value);
}

function ascii(bytes, offset, length) {
  if (offset + length > bytes.length) throw new CodecMediaException("Unexpected end of AIFF data");
  return Buffer.from(bytes).subarray(offset, offset + length).toString("ascii");
}

function readBeShort(bytes, offset) {
  if (offset + 2 > bytes.length) throw new CodecMediaException("Unexpected end of AIFF data");
  return ((bytes[offset] & 0xff) << 8) | (bytes[offset + 1] & 0xff);
}

function readBeInt(bytes, offset) {
  if (offset + 4 > bytes.length) throw new CodecMediaException("Unexpected end of AIFF data");
  return ((bytes[offset] & 0xff) << 24) |
    ((bytes[offset + 1] & 0xff) << 16) |
    ((bytes[offset + 2] & 0xff) << 8) |
    (bytes[offset + 3] & 0xff);
}

function readBeUInt32(bytes, offset) {
  return readBeInt(bytes, offset) >>> 0;
}
