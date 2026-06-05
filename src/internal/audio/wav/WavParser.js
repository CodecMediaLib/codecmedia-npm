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
    if (!bytes || bytes.length < 12) {
      throw new CodecMediaException("Invalid WAV data: too small");
    }

    const riffId = ascii(bytes, 0, 4);
    const waveId = ascii(bytes, 8, 4);
    if (waveId !== WAVE || (riffId !== RIFF && riffId !== RF64 && riffId !== RIFX)) {
      throw new CodecMediaException("Not a WAV/RIFF file");
    }

    const littleEndian = riffId !== RIFX;

    let offset = 12;
    let channels = null;
    let sampleRate = null;
    let bitsPerSample = null;
    let blockAlign = null;
    let byteRate = null;
    let dataBytes = 0n;
    let sawData = false;

    while (offset + 8 <= bytes.length) {
      const chunkId = ascii(bytes, offset, 4);
      const chunkSizeU32 = readU32(bytes, offset + 4, littleEndian);
      const chunkSize = BigInt(chunkSizeU32);
      const chunkDataStart = offset + 8;

      if (chunkDataStart > bytes.length) {
        throw new CodecMediaException("Invalid WAV chunk layout");
      }

      const remaining = BigInt(bytes.length - chunkDataStart);
      if (chunkSize > remaining) {
        throw new CodecMediaException(`WAV chunk exceeds file bounds: ${chunkId}`);
      }

      if (chunkId === "fmt ") {
        if (chunkSizeU32 < 16) {
          throw new CodecMediaException("WAV fmt chunk is too small");
        }

        const formatTag = readU16(bytes, chunkDataStart + 0, littleEndian);
        channels = readU16(bytes, chunkDataStart + 2, littleEndian);
        sampleRate = readU32(bytes, chunkDataStart + 4, littleEndian);
        byteRate = readU32(bytes, chunkDataStart + 8, littleEndian);
        blockAlign = readU16(bytes, chunkDataStart + 12, littleEndian);
        bitsPerSample = readU16(bytes, chunkDataStart + 14, littleEndian);

        // WAVE_FORMAT_EXTENSIBLE stores the valid bits/sample at +18 (if present),
        // and we can keep container bitsPerSample from +14 for stream math.
        // formatTag accepted broadly (PCM/IEEE float/alaw/mulaw/extensible/etc.)
        if (formatTag === 0 || channels <= 0 || sampleRate <= 0) {
          throw new CodecMediaException("Invalid WAV format values");
        }
      } else if (chunkId === "data") {
        sawData = true;
        dataBytes += chunkSize;
      }

      const padded = Number(chunkSize + (chunkSize & 1n));
      offset = chunkDataStart + padded;
    }

    if (!sawData) {
      throw new CodecMediaException("WAV is missing data chunk");
    }
    if (channels == null || sampleRate == null || bitsPerSample == null) {
      throw new CodecMediaException("WAV is missing required fmt chunk");
    }
    if (channels <= 0 || sampleRate <= 0 || bitsPerSample <= 0) {
      throw new CodecMediaException("Invalid WAV format values");
    }

    let effectiveByteRate = byteRate && byteRate > 0 ? BigInt(byteRate) : 0n;
    if (effectiveByteRate <= 0n && blockAlign && blockAlign > 0) {
      effectiveByteRate = BigInt(sampleRate) * BigInt(blockAlign);
    }
    if (effectiveByteRate <= 0n) {
      effectiveByteRate = (BigInt(sampleRate) * BigInt(channels) * BigInt(bitsPerSample)) / 8n;
    }
    if (effectiveByteRate <= 0n) {
      throw new CodecMediaException("Invalid WAV byte rate");
    }

    const durationMillis = Number((dataBytes * 1000n) / effectiveByteRate);
    const bitrateKbps = Number((effectiveByteRate * 8n) / 1000n);

    return WavProbeInfo({
      codec: "pcm",
      durationMillis,
      bitrateKbps,
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
    let offset = 12;
    while (offset + 8 <= bytes.length) {
      const chunkId = ascii(bytes, offset, 4);
      const chunkSize = readU32(bytes, offset + 4, true);
      const chunkDataStart = offset + 8;
      const chunkDataEnd = chunkDataStart + chunkSize;
      if (chunkDataEnd < chunkDataStart || chunkDataEnd > bytes.length) {
        throw new CodecMediaException(`WAV chunk exceeds file bounds: ${chunkId}`);
      }

      if (chunkId === "LIST" && chunkSize >= 4) {
        const listType = ascii(bytes, chunkDataStart, 4);
        if (listType === "INFO") {
          readInfoListEntries(bytes, chunkDataStart + 4, chunkDataEnd, out);
        }
      }

      const padded = chunkSize % 2 === 0 ? chunkSize : chunkSize + 1;
      offset = chunkDataStart + padded;
    }

    return out;
  }

  static writeInfoMetadata(bytes, metadataEntries) {
    if (!WavParser.isLikelyWav(bytes)) {
      throw new CodecMediaException("Not a WAV/RIFF file");
    }
    if (ascii(bytes, 0, 4) === RF64) {
      throw new CodecMediaException("RF64 metadata writing is not supported");
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

function readInfoListEntries(bytes, offset, limit, out) {
  let pos = offset;
  while (pos + 8 <= limit) {
    const id = ascii(bytes, pos, 4);
    const size = readU32(bytes, pos + 4, true);
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

