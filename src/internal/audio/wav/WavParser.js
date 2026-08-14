/**
 * WavParser
 * Port + hardening of me.tamkungz.codecmedia.internal.audio.wav.WavParser
 */
import { CodecMediaException } from "../../../CodecMediaException.js";
import { WavProbeInfo } from "./WavProbeInfo.js";

const RIFF = "RIFF";
const RF64 = "RF64";
const RIFX = "RIFX";
const WAVE = "WAVE";
const INFO_TO_METADATA = Object.freeze({
  INAM: "title",
  IART: "artist",
  IPRD: "album",
  ICMT: "comment",
  ICRD: "date",
  IGNR: "genre",
});
const METADATA_WRITE_ORDER = ["title", "artist", "album", "comment", "date", "genre"];

export class WavParser {
  /**
   * @param {Buffer | Uint8Array} bytes
   * @returns {import("./WavProbeInfo.js").WavProbeInfo}
   */
  static parse(bytes) {
    if (!WavParser.isLikelyWav(bytes)) {
      throw new CodecMediaException("Not a WAV/RIFF file");
    }

    const riffId = ascii(bytes, 0, 4);
    const littleEndian = riffId !== RIFX;
    const isRf64 = riffId === RF64;
    let offset = 12;
    let audioFormat = null;
    let channels = null;
    let sampleRate = null;
    let byteRate = null;
    let bitsPerSample = null;
    let dataSize = null;
    let ds64DataSize = null;

    while (offset + 8 <= bytes.length) {
      const chunkId = ascii(bytes, offset, 4);
      const chunkSize = readU32(bytes, offset + 4, littleEndian);
      const chunkDataStart = offset + 8;
      const chunkDataEnd = chunkDataStart + chunkSize;

      if (chunkDataEnd < chunkDataStart || chunkDataEnd > bytes.length) {
        if (!(isRf64 && chunkId === "data" && chunkSize === 0xffffffff && ds64DataSize != null)) {
          throw new CodecMediaException(`WAV chunk exceeds file bounds: ${chunkId}`);
        }
      }

      if (chunkId === "ds64") {
        if (!isRf64 || chunkSize < 16 || chunkDataStart + 16 > bytes.length) {
          throw new CodecMediaException("Invalid RF64 ds64 chunk");
        }
        const value = Buffer.from(bytes).readBigUInt64LE(chunkDataStart + 8);
        if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
          throw new CodecMediaException("RF64 data size is too large");
        }
        ds64DataSize = Number(value);
      } else if (chunkId === "fmt ") {
        if (chunkSize < 16) throw new CodecMediaException("WAV fmt chunk is too small");
        audioFormat = readU16(bytes, chunkDataStart, littleEndian);
        channels = readU16(bytes, chunkDataStart + 2, littleEndian);
        sampleRate = readU32(bytes, chunkDataStart + 4, littleEndian);
        byteRate = readU32(bytes, chunkDataStart + 8, littleEndian);
        bitsPerSample = readU16(bytes, chunkDataStart + 14, littleEndian);
        validateSupportedAudioFormat(audioFormat, bytes, chunkDataStart, chunkSize, littleEndian);
      } else if (chunkId === "data") {
        if (isRf64 && chunkSize === 0xffffffff) {
          if (ds64DataSize == null) {
            throw new CodecMediaException("RF64 data chunk uses 0xFFFFFFFF size but ds64 is missing");
          }
          dataSize = ds64DataSize;
        } else {
          dataSize = chunkSize;
        }
      }

      let effectiveChunkSize = chunkSize;
      if (isRf64 && chunkId === "data" && chunkSize === 0xffffffff) {
        const available = bytes.length - chunkDataStart;
        const expected = ds64DataSize ?? available;
        if (expected < 0 || expected > available) {
          throw new CodecMediaException("RF64 data chunk exceeds file bounds");
        }
        effectiveChunkSize = expected;
      }

      const padded = effectiveChunkSize + (effectiveChunkSize & 1);
      const nextOffset = chunkDataStart + padded;
      if (!Number.isSafeInteger(nextOffset) || nextOffset < chunkDataStart || nextOffset > bytes.length) {
        throw new CodecMediaException(`WAV chunk exceeds file bounds: ${chunkId}`);
      }
      offset = nextOffset;
    }

    if (audioFormat == null || channels == null || sampleRate == null || bitsPerSample == null || dataSize == null) {
      throw new CodecMediaException("WAV is missing required fmt/data chunks");
    }
    if (channels <= 0 || sampleRate <= 0 || bitsPerSample <= 0) {
      throw new CodecMediaException("Invalid WAV format values");
    }

    const computedByteRate = Math.floor(sampleRate * channels * bitsPerSample / 8);
    const effectiveByteRate = byteRate > 0 ? byteRate : computedByteRate;
    if (effectiveByteRate <= 0) throw new CodecMediaException("Invalid WAV byte rate");

    return WavProbeInfo({
      codec: audioFormat === 0x0003 ? "pcm-float" : "pcm",
      durationMillis: Math.floor((dataSize * 1000) / effectiveByteRate),
      bitrateKbps: Math.floor((effectiveByteRate * 8) / 1000),
      sampleRate,
      channels,
      bitsPerSample,
      bitrateMode: "CBR",
    });
  }

  /**
   * @param {Buffer | Uint8Array} bytes
   * @returns {boolean}
   */
  static isLikelyWav(bytes) {
    if (!bytes || bytes.length < 12) return false;
    const riffId = ascii(bytes, 0, 4);
    if (riffId !== RIFF && riffId !== RF64 && riffId !== RIFX) return false;
    return ascii(bytes, 8, 4) === WAVE;
  }

  static readInfoMetadata(bytes) {
    if (!WavParser.isLikelyWav(bytes)) {
      throw new CodecMediaException("Not a WAV/RIFF file");
    }

    const out = {};
    const riffId = ascii(bytes, 0, 4);
    const littleEndian = riffId !== RIFX;
    const isRf64 = riffId === RF64;
    let ds64DataSize = null;
    let offset = 12;
    while (offset + 8 <= bytes.length) {
      const chunkId = ascii(bytes, offset, 4);
      const rawChunkSize = readU32(bytes, offset + 4, littleEndian);
      const chunkDataStart = offset + 8;

      if (chunkId === "ds64") {
        if (!isRf64 || rawChunkSize < 16 || chunkDataStart + 16 > bytes.length) {
          throw new CodecMediaException("Invalid RF64 ds64 chunk");
        }
        const value = Buffer.from(bytes).readBigUInt64LE(chunkDataStart + 8);
        if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
          throw new CodecMediaException("RF64 data size is too large");
        }
        ds64DataSize = Number(value);
      }

      let chunkSize = rawChunkSize;
      if (isRf64 && chunkId === "data" && rawChunkSize === 0xffffffff) {
        if (ds64DataSize == null) {
          throw new CodecMediaException("RF64 data chunk uses 0xFFFFFFFF size but ds64 is missing");
        }
        chunkSize = ds64DataSize;
      }

      const chunkDataEnd = chunkDataStart + chunkSize;
      if (!Number.isSafeInteger(chunkDataEnd) || chunkDataEnd < chunkDataStart || chunkDataEnd > bytes.length) {
        throw new CodecMediaException(`WAV chunk exceeds file bounds: ${chunkId}`);
      }

      if (chunkId === "LIST" && chunkSize >= 4) {
        const listType = ascii(bytes, chunkDataStart, 4);
        if (listType === "INFO") {
          readInfoListEntries(bytes, chunkDataStart + 4, chunkDataEnd, out, littleEndian);
        }
      }

      const padded = chunkSize + (chunkSize & 1);
      const nextOffset = chunkDataStart + padded;
      if (!Number.isSafeInteger(nextOffset) || nextOffset < chunkDataStart || nextOffset > bytes.length) {
        throw new CodecMediaException(`WAV chunk exceeds file bounds: ${chunkId}`);
      }
      offset = nextOffset;
    }

    return out;
  }

  static writeInfoMetadata(bytes, metadataEntries) {
    if (!WavParser.isLikelyWav(bytes)) {
      throw new CodecMediaException("Not a WAV/RIFF file");
    }
    const container = ascii(bytes, 0, 4);
    if (container === RF64 || container === RIFX) {
      throw new CodecMediaException(`${container} metadata writing is not supported`);
    }

    const keptChunks = [];
    let offset = 12;
    while (offset + 8 <= bytes.length) {
      const chunkId = ascii(bytes, offset, 4);
      const chunkSize = readU32(bytes, offset + 4, true);
      const chunkDataStart = offset + 8;
      const chunkDataEnd = chunkDataStart + chunkSize;
      if (chunkDataEnd < chunkDataStart || chunkDataEnd > bytes.length) {
        throw new CodecMediaException(`WAV chunk exceeds file bounds: ${chunkId}`);
      }

      let isInfoList = false;
      if (chunkId === "LIST" && chunkSize >= 4) {
        isInfoList = ascii(bytes, chunkDataStart, 4) === "INFO";
      }

      const padded = chunkSize % 2 === 0 ? chunkSize : chunkSize + 1;
      const nextOffset = chunkDataStart + padded;
      if (!isInfoList) {
        keptChunks.push(Buffer.from(bytes).subarray(offset, nextOffset));
      }
      offset = nextOffset;
    }

    const infoChunk = buildInfoListChunk(metadataEntries);
    const total = 12 + keptChunks.reduce((sum, chunk) => sum + chunk.length, 0) +
      (infoChunk == null ? 0 : infoChunk.length);
    if (total > 0x7fffffff) {
      throw new CodecMediaException("WAV file is too large after metadata write");
    }

    const out = Buffer.alloc(total);
    out.write("RIFF", 0, "ascii");
    out.writeUInt32LE(total - 8, 4);
    out.write("WAVE", 8, "ascii");
    let outOffset = 12;
    for (const chunk of keptChunks) {
      chunk.copy(out, outOffset);
      outOffset += chunk.length;
    }
    if (infoChunk != null) {
      infoChunk.copy(out, outOffset);
    }
    return out;
  }
}


function validateSupportedAudioFormat(audioFormat, bytes, fmtOffset, fmtChunkSize, littleEndian) {
  const PCM = 0x0001;
  const IEEE_FLOAT = 0x0003;
  const EXTENSIBLE = 0xfffe;
  if (audioFormat === PCM || audioFormat === IEEE_FLOAT) return;
  if (audioFormat !== EXTENSIBLE) {
    throw new CodecMediaException(`Unsupported WAV audio format: 0x${audioFormat.toString(16)}`);
  }
  if (fmtChunkSize < 40) throw new CodecMediaException("Invalid WAV extensible fmt chunk");
  const cbSize = readU16(bytes, fmtOffset + 16, littleEndian);
  if (cbSize < 22) throw new CodecMediaException("Invalid WAV extensible fmt extension size");

  const subFormatOffset = fmtOffset + 24;
  const subType = readU16(bytes, subFormatOffset, littleEndian);
  // KSDATAFORMAT_SUBTYPE_PCM / IEEE_FLOAT GUID tail. RIFX extensible is rare; the GUID itself remains byte-defined.
  const validGuid = bytes[subFormatOffset + 2] === 0x00 && bytes[subFormatOffset + 3] === 0x00 &&
    bytes[subFormatOffset + 4] === 0x00 && bytes[subFormatOffset + 5] === 0x00 &&
    bytes[subFormatOffset + 6] === 0x10 && bytes[subFormatOffset + 7] === 0x00 &&
    bytes[subFormatOffset + 8] === 0x80 && bytes[subFormatOffset + 9] === 0x00 &&
    bytes[subFormatOffset + 10] === 0x00 && bytes[subFormatOffset + 11] === 0xaa &&
    bytes[subFormatOffset + 12] === 0x00 && bytes[subFormatOffset + 13] === 0x38 &&
    bytes[subFormatOffset + 14] === 0x9b && bytes[subFormatOffset + 15] === 0x71;
  if (!validGuid || (subType !== PCM && subType !== IEEE_FLOAT)) {
    throw new CodecMediaException(`Unsupported WAV extensible sub-format: 0x${subType.toString(16)}`);
  }
}

function ascii(bytes, offset, len) {
  if (offset < 0 || offset + len > bytes.length) return "";
  return Buffer.from(bytes).subarray(offset, offset + len).toString("ascii");
}

function readU16(bytes, offset, littleEndian) {
  if (offset < 0 || offset + 2 > bytes.length) {
    throw new CodecMediaException("Unexpected end of WAV data");
  }
  return littleEndian
    ? ((bytes[offset] & 0xff) | ((bytes[offset + 1] & 0xff) << 8))
    : (((bytes[offset] & 0xff) << 8) | (bytes[offset + 1] & 0xff));
}

function readU32(bytes, offset, littleEndian) {
  if (offset < 0 || offset + 4 > bytes.length) {
    throw new CodecMediaException("Unexpected end of WAV data");
  }
  const b0 = bytes[offset] & 0xff;
  const b1 = bytes[offset + 1] & 0xff;
  const b2 = bytes[offset + 2] & 0xff;
  const b3 = bytes[offset + 3] & 0xff;

  return littleEndian
    ? (b0 | (b1 << 8) | (b2 << 16) | (b3 << 24)) >>> 0
    : (b3 | (b2 << 8) | (b1 << 16) | (b0 << 24)) >>> 0;
}

function readInfoListEntries(bytes, offset, limit, out, littleEndian = true) {
  let pos = offset;
  while (pos + 8 <= limit) {
    const id = ascii(bytes, pos, 4);
    const size = readU32(bytes, pos + 4, littleEndian);
    const dataStart = pos + 8;
    const dataEnd = dataStart + size;
    if (dataEnd < dataStart || dataEnd > limit) {
      throw new CodecMediaException(`WAV INFO chunk exceeds LIST bounds: ${id}`);
    }

    const key = INFO_TO_METADATA[id];
    if (key != null) {
      let effectiveEnd = dataEnd;
      while (effectiveEnd > dataStart && bytes[effectiveEnd - 1] === 0) {
        effectiveEnd--;
      }
      const value = Buffer.from(bytes).subarray(dataStart, effectiveEnd).toString("utf8").trim();
      if (value) out[key] = value;
    }

    const padded = size % 2 === 0 ? size : size + 1;
    pos = dataStart + padded;
  }
}

function buildInfoListChunk(metadataEntries) {
  if (metadataEntries == null || Object.keys(metadataEntries).length === 0) {
    return null;
  }

  const parts = [Buffer.from("INFO", "ascii")];
  for (const metadataKey of METADATA_WRITE_ORDER) {
    const value = metadataEntries[metadataKey];
    if (value == null) continue;
    const infoId = metadataToInfoId(metadataKey);
    if (infoId == null) continue;

    const valueBytes = Buffer.from(String(value), "utf8");
    const dataSize = valueBytes.length + 1;
    const header = Buffer.alloc(8);
    header.write(infoId, 0, "ascii");
    header.writeUInt32LE(dataSize, 4);
    parts.push(header, valueBytes, Buffer.from([0]));
    if (dataSize % 2 !== 0) parts.push(Buffer.from([0]));
  }

  const payload = Buffer.concat(parts);
  if (payload.length <= 4) return null;

  const header = Buffer.alloc(8);
  header.write("LIST", 0, "ascii");
  header.writeUInt32LE(payload.length, 4);
  const chunks = [header, payload];
  if (payload.length % 2 !== 0) chunks.push(Buffer.from([0]));
  return Buffer.concat(chunks);
}

function metadataToInfoId(metadataKey) {
  for (const [infoId, key] of Object.entries(INFO_TO_METADATA)) {
    if (key === metadataKey) return infoId;
  }
  return null;
}

