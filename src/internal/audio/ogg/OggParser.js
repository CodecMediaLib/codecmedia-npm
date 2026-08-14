import { CodecMediaException } from "../../../CodecMediaException.js";
import { ByteArrayReader } from "../../io/ByteArrayReader.js";
import { OggProbeInfo } from "./OggProbeInfo.js";

const OPUS_GRANULE_RATE = 48_000;

export class OggParser {
  static isLikelyOgg(data) {
    return data != null && data.length >= 4 &&
      data[0] === 0x4f && data[1] === 0x67 && data[2] === 0x67 && data[3] === 0x53;
  }

  static parse(data) {
    if (data == null || data.length < 27) {
      throw new CodecMediaException("Invalid OGG data: too small");
    }

    const firstPage = parsePageHeader(data, 0);
    if (firstPage == null) throw new CodecMediaException("Invalid OGG stream: missing OggS header");
    if (firstPage.version !== 0) throw new CodecMediaException(`Unsupported OGG bitstream version: ${firstPage.version}`);

    const identOffset = firstPage.headerSize;
    if (identOffset + firstPage.payloadSize > data.length || firstPage.payloadSize <= 0) {
      throw new CodecMediaException("Invalid OGG stream: incomplete first packet payload");
    }

    const ident = parseIdentificationPacket(data, identOffset, firstPage.payloadSize);
    const targetSerial = firstPage.serialNumber;
    let payloadBits = 0n;
    let maxGranule = 0n;
    let prevGranule = null;
    let prevSequence = null;
    const observedKbps = new Set();
    let hasCommentMetadata = false;

    let offset = 0;
    while (offset + 27 <= data.length) {
      const page = parsePageHeader(data, offset);
      if (page == null) {
        throw new CodecMediaException(`Invalid OGG page at byte ${offset}`);
      }
      if (page.version !== 0) throw new CodecMediaException(`Unsupported OGG bitstream version: ${page.version}`);

      if (page.serialNumber === targetSerial) {
        if (prevSequence != null && page.sequenceNumber !== prevSequence + 1) {
          throw new CodecMediaException("Invalid OGG stream: broken page sequence for target stream");
        }
        prevSequence = page.sequenceNumber;
        payloadBits += BigInt(page.payloadSize) * 8n;
        if (page.granulePosition > maxGranule && page.granulePosition !== 0xffffffffffffffffn) {
          maxGranule = page.granulePosition;
        }

        const payloadOffset = offset + page.headerSize;
        if (!hasCommentMetadata && containsCodecCommentSignal(data, payloadOffset, page.payloadSize, ident.codec)) {
          hasCommentMetadata = true;
        }

        if (prevGranule != null && page.granulePosition > prevGranule && page.granulePosition !== 0xffffffffffffffffn) {
          const granuleDelta = page.granulePosition - prevGranule;
          const granuleRate = ident.granuleRate || ident.sampleRate;
          if (granuleRate > 0) {
            const millis = Number((granuleDelta * 1000n) / BigInt(granuleRate));
            if (millis > 0) {
              const kbps = Math.floor((page.payloadSize * 8 * 1000) / millis / 1000);
              if (kbps > 0) observedKbps.add(kbps);
            }
          }
        }
        if (page.granulePosition !== 0xffffffffffffffffn) prevGranule = page.granulePosition;
      }
      offset += page.totalPageSize;
    }

    const granuleRate = ident.granuleRate || ident.sampleRate;
    const durationMillis = granuleRate > 0 && maxGranule > 0n
      ? Number((maxGranule * 1000n) / BigInt(granuleRate))
      : 0;
    const avgBitrate = durationMillis > 0
      ? Number((payloadBits * 1000n) / BigInt(durationMillis) / 1000n)
      : 0;
    const nominalKbps = ident.nominalBitrate > 0 ? Math.floor(ident.nominalBitrate / 1000) : 0;
    const bitrateKbps = avgBitrate > 0 ? avgBitrate : nominalKbps;
    const bitrateMode = ident.codec === "opus"
      ? "VBR"
      : detectVorbisBitrateMode(observedKbps, ident.nominalBitrate, hasCommentMetadata);

    return OggProbeInfo({
      codec: ident.codec,
      sampleRate: ident.sampleRate,
      channels: ident.channels,
      bitrateKbps,
      bitrateMode,
      durationMillis,
    });
  }

  static readCommentMetadata(data) {
    if (data == null || data.length < 27) throw new CodecMediaException("Invalid OGG data: too small");
    const firstPage = parsePageHeader(data, 0);
    if (firstPage == null) throw new CodecMediaException("Invalid OGG stream: missing OggS header");
    const identOffset = firstPage.headerSize;
    if (identOffset + firstPage.payloadSize > data.length || firstPage.payloadSize <= 0) {
      throw new CodecMediaException("Invalid OGG stream: incomplete first packet payload");
    }
    const ident = parseIdentificationPacket(data, identOffset, firstPage.payloadSize);

    let offset = 0;
    while (offset + 27 <= data.length) {
      const page = parsePageHeader(data, offset);
      if (page == null) break;
      const payloadOffset = offset + page.headerSize;
      const comments = parseCodecComments(data, payloadOffset, page.payloadSize, ident.codec);
      if (Object.keys(comments).length > 0) return comments;
      offset += page.totalPageSize;
    }
    return {};
  }
}

function detectVorbisBitrateMode(observedKbps, nominalBitrate, hasCommentMetadata) {
  if (observedKbps.size > 1) return "VBR";
  if (observedKbps.size === 1) return "CBR";
  if (nominalBitrate > 0 || hasCommentMetadata) return "UNKNOWN";
  return "UNKNOWN";
}

function parseIdentificationPacket(data, identOffset, payloadSize) {
  if (isVorbisIdentification(data, identOffset, payloadSize)) {
    if (payloadSize < 30) throw new CodecMediaException("Invalid OGG Vorbis stream: incomplete identification packet");
    const r = new ByteArrayReader(data);
    r.position(identOffset + 7);
    r.readU32LE();
    const channels = r.readU8();
    const sampleRate = r.readU32LE();
    const bitrateMaximum = r.readU32LE();
    const bitrateNominal = r.readU32LE();
    const bitrateMinimum = r.readU32LE();
    r.readU8();
    const framing = r.readU8();
    if (framing !== 1 || channels <= 0 || sampleRate <= 0) {
      throw new CodecMediaException("Invalid OGG Vorbis identification packet");
    }
    void bitrateMaximum; void bitrateMinimum;
    return { codec: "vorbis", sampleRate, channels, nominalBitrate: bitrateNominal, granuleRate: sampleRate };
  }

  if (isOpusIdentification(data, identOffset, payloadSize)) {
    if (payloadSize < 19) throw new CodecMediaException("Invalid OGG Opus stream: incomplete OpusHead packet");
    const r = new ByteArrayReader(data);
    r.position(identOffset + 8);
    const version = r.readU8();
    const channels = r.readU8();
    r.readU16LE();
    const inputSampleRate = r.readU32LE();
    if (version > 15 || channels <= 0) throw new CodecMediaException("Invalid OGG Opus identification packet");
    const sampleRate = inputSampleRate > 0 ? inputSampleRate : OPUS_GRANULE_RATE;
    return { codec: "opus", sampleRate, channels, nominalBitrate: 0, granuleRate: OPUS_GRANULE_RATE };
  }

  throw new CodecMediaException("Unsupported OGG codec: currently Vorbis and Opus are parsed");
}

function isVorbisIdentification(data, offset, payloadSize) {
  return payloadSize >= 7 && data[offset] === 0x01 && ascii(data, offset + 1, 6) === "vorbis";
}
function isOpusIdentification(data, offset, payloadSize) {
  return payloadSize >= 8 && ascii(data, offset, 8) === "OpusHead";
}

function parsePageHeader(data, offset) {
  if (offset < 0 || offset + 27 > data.length || ascii(data, offset, 4) !== "OggS") return null;
  const r = new ByteArrayReader(data);
  r.position(offset + 4);
  const version = r.readU8();
  const headerType = r.readU8();
  const granulePosition = r.readU64LE();
  const serialNumber = r.readU32LE();
  const sequenceNumber = r.readU32LE();
  r.readU32LE();
  const segmentCount = r.readU8();
  if (offset + 27 + segmentCount > data.length) return null;
  let payloadSize = 0;
  for (let i = 0; i < segmentCount; i++) payloadSize += data[offset + 27 + i];
  const headerSize = 27 + segmentCount;
  const totalPageSize = headerSize + payloadSize;
  if (offset + totalPageSize > data.length) return null;
  return { version, headerType, granulePosition, serialNumber, sequenceNumber, segmentCount, payloadSize, totalPageSize, headerSize };
}

function containsCodecCommentSignal(data, offset, size, codec) {
  if (offset < 0 || size <= 0 || offset + size > data.length) return false;
  const start = codec === "vorbis" && data[offset] === 0x03 && ascii(data, offset + 1, 6) === "vorbis"
    ? offset + 7
    : codec === "opus" && ascii(data, offset, 8) === "OpusTags"
      ? offset + 8 : -1;
  return start >= 0 && parseCommentListForSignals(data, start, offset + size, codec === "vorbis");
}

function parseCodecComments(data, offset, size, codec) {
  if (offset < 0 || size <= 0 || offset + size > data.length) return {};
  if (codec === "vorbis" && size >= 11 && data[offset] === 0x03 && ascii(data, offset + 1, 6) === "vorbis") {
    return parseCommentMap(data, offset + 7, offset + size, true);
  }
  if (codec === "opus" && size >= 12 && ascii(data, offset, 8) === "OpusTags") {
    return parseCommentMap(data, offset + 8, offset + size, false);
  }
  return {};
}

function parseCommentMap(data, pos, end, vorbis) {
  const vendorLen = readU32LEAt(data, pos, end); if (vendorLen == null) return {};
  pos += 4; if (pos + vendorLen > end) return {}; pos += vendorLen;
  const count = readU32LEAt(data, pos, end); if (count == null || count > 1_000_000) return {};
  pos += 4;
  const raw = new Map();
  for (let i = 0; i < count; i++) {
    const len = readU32LEAt(data, pos, end); if (len == null) return {};
    pos += 4; if (pos + len > end) return {};
    const text = Buffer.from(data).subarray(pos, pos + len).toString("utf8");
    const eq = text.indexOf("=");
    if (eq > 0) {
      const key = text.slice(0, eq).trim().toUpperCase();
      const value = text.slice(eq + 1).trim();
      if (value && !raw.has(key)) raw.set(key, value);
    }
    pos += len;
  }
  const out = {};
  putFirst(out, "title", raw, "TITLE"); putFirst(out, "artist", raw, "ARTIST");
  putFirst(out, "album", raw, "ALBUM"); putFirst(out, "comment", raw, "COMMENT");
  putFirst(out, "genre", raw, "GENRE"); putFirst(out, "date", raw, "DATE", "YEAR");
  if (!vorbis) putFirst(out, "encoder", raw, "ENCODER", "ENCODER_OPTIONS");
  return out;
}

function putFirst(out, key, raw, ...keys) {
  for (const k of keys) { const value = raw.get(k); if (value) { out[key] ??= value; return; } }
}

function parseCommentListForSignals(data, pos, end, vorbis) {
  const vendorLen = readU32LEAt(data, pos, end); if (vendorLen == null) return false;
  pos += 4; if (pos + vendorLen > end) return false; pos += vendorLen;
  const count = readU32LEAt(data, pos, end); if (count == null || count > 1_000_000) return false;
  pos += 4;
  for (let i = 0; i < count; i++) {
    const len = readU32LEAt(data, pos, end); if (len == null) return false;
    pos += 4; if (pos + len > end) return false;
    const text = Buffer.from(data).subarray(pos, pos + len).toString("ascii");
    const eq = text.indexOf("=");
    if (eq > 0) {
      const key = text.slice(0, eq).toUpperCase();
      if (key.startsWith("REPLAYGAIN_") || key.startsWith("TRACKTOTAL") || key.startsWith("ALBUMGAIN") ||
          (!vorbis && (key.startsWith("R128_TRACK_GAIN") || key.startsWith("R128_ALBUM_GAIN")))) return true;
    }
    pos += len;
  }
  return false;
}

function readU32LEAt(data, offset, end) {
  if (offset < 0 || offset + 4 > end || offset + 4 > data.length) return null;
  return Buffer.from(data).readUInt32LE(offset);
}
function ascii(data, offset, len) {
  if (offset < 0 || offset + len > data.length) return "";
  return Buffer.from(data).subarray(offset, offset + len).toString("ascii");
}
