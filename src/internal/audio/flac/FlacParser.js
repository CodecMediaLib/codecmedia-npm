import { CodecMediaException } from "../../../CodecMediaException.js";

const FLAC_MAGIC = Buffer.from("fLaC", "ascii");
const ID3V2_HEADER_SIZE = 10;
const FLAC_MAGIC_SCAN_LIMIT = 4096;

export class FlacParser {
  static isLikelyFlac(bytes) {
    return findFlacOffset(bytes) >= 0;
  }

  static parse(bytes) {
    const flacOffset = findFlacOffset(bytes);
    if (flacOffset < 0) throw new CodecMediaException("Not a FLAC file");

    let offset = flacOffset + FLAC_MAGIC.length;
    let streamInfoFound = false;
    let lastMetadataBlockFound = false;
    let sampleRate = 0;
    let channels = 0;
    let bitsPerSample = 0;
    let totalSamples = 0n;
    let audioStartOffset = -1;

    while (offset + 4 <= bytes.length) {
      const header = bytes[offset] & 0xff;
      const last = (header & 0x80) !== 0;
      const blockType = header & 0x7f;
      if (blockType === 0x7f) throw new CodecMediaException("Invalid FLAC metadata block type: 127 is reserved");
      const length = ((bytes[offset + 1] & 0xff) << 16) | ((bytes[offset + 2] & 0xff) << 8) | (bytes[offset + 3] & 0xff);
      offset += 4;

      if (offset + length > bytes.length) throw new CodecMediaException("Invalid FLAC metadata block length");

      if (blockType === 0) {
        if (length !== 34) {
          throw new CodecMediaException(`Invalid FLAC STREAMINFO block length: expected 34, got ${length}`);
        }
        const packed = readUInt64BE(bytes, offset + 10);
        sampleRate = Number((packed >> 44n) & 0xfffffn);
        channels = Number(((packed >> 41n) & 0x7n) + 1n);
        bitsPerSample = Number(((packed >> 36n) & 0x1fn) + 1n);
        totalSamples = packed & 0xfffffffffn;
        streamInfoFound = true;
      }

      offset += length;
      if (last) {
        lastMetadataBlockFound = true;
        audioStartOffset = offset;
        break;
      }
    }

    if (!lastMetadataBlockFound) throw new CodecMediaException("Invalid FLAC metadata: missing last-metadata-block flag");
    if (!streamInfoFound || sampleRate <= 0 || channels <= 0 || bitsPerSample <= 0) {
      throw new CodecMediaException("FLAC STREAMINFO is missing or invalid");
    }

    const durationMillis = totalSamples > 0n ? Number((totalSamples * 1000n) / BigInt(sampleRate)) : 0;
    const encodedAudioBytes = audioStartOffset >= 0 && audioStartOffset <= bytes.length ? bytes.length - audioStartOffset : 0;
    const avgBitrateKbps = durationMillis > 0 ? Math.floor((encodedAudioBytes * 8) / durationMillis) : 0;
    const pcmEquivalentKbps = Math.floor((sampleRate * channels * bitsPerSample) / 1000);
    const bitrateKbps = avgBitrateKbps > 0 ? avgBitrateKbps : pcmEquivalentKbps;

    return Object.freeze({
      codec: "flac",
      sampleRate,
      channels,
      bitsPerSample,
      bitrateKbps,
      bitrateMode: "VBR",
      durationMillis,
    });
  }

  static readVorbisCommentMetadata(bytes) {
    const flacOffset = findFlacOffset(bytes);
    if (flacOffset < 0) throw new CodecMediaException("Not a FLAC file");

    let offset = flacOffset + FLAC_MAGIC.length;
    while (offset + 4 <= bytes.length) {
      const header = bytes[offset] & 0xff;
      const last = (header & 0x80) !== 0;
      const blockType = header & 0x7f;
      if (blockType === 0x7f) throw new CodecMediaException("Invalid FLAC metadata block type: 127 is reserved");
      const length = ((bytes[offset + 1] & 0xff) << 16) | ((bytes[offset + 2] & 0xff) << 8) | (bytes[offset + 3] & 0xff);
      offset += 4;

      if (offset + length > bytes.length) throw new CodecMediaException("Invalid FLAC metadata block length");
      if (blockType === 4) return parseVorbisCommentBlock(bytes, offset, length);

      offset += length;
      if (last) break;
    }
    return {};
  }
}

function parseVorbisCommentBlock(bytes, offset, length) {
  const end = offset + length;
  let pos = offset;
  const vendorLen = readLeIntAt(bytes, pos, end, "vendor length");
  pos += 4;
  if (pos + vendorLen > end) {
    throw new CodecMediaException("Invalid FLAC Vorbis comment block: vendor field exceeds block length");
  }
  pos += vendorLen;

  const commentCount = readLeIntAt(bytes, pos, end, "comment count");
  pos += 4;

  const raw = {};
  const out = {};
  for (let i = 0; i < commentCount; i++) {
    const commentLen = readLeIntAt(bytes, pos, end, "comment length");
    pos += 4;
    if (pos + commentLen > end) {
      throw new CodecMediaException("Invalid FLAC Vorbis comment block: comment field exceeds block length");
    }
    const comment = Buffer.from(bytes).subarray(pos, pos + commentLen).toString("utf8");
    const eq = comment.indexOf("=");
    if (eq > 0) {
      const key = comment.slice(0, eq).trim().toUpperCase();
      const value = comment.slice(eq + 1).trim();
      if (value && raw[key] == null) raw[key] = value;
    }
    pos += commentLen;
  }

  putIfPresent(out, "title", raw, "TITLE");
  putIfPresent(out, "artist", raw, "ARTIST");
  putIfPresent(out, "album", raw, "ALBUM");
  putIfPresent(out, "comment", raw, "COMMENT");
  putIfPresent(out, "genre", raw, "GENRE");
  putIfPresent(out, "date", raw, "DATE", "YEAR");
  return out;
}

function findFlacOffset(bytes) {
  if (bytes == null || bytes.length < FLAC_MAGIC.length) return -1;
  if (matchesFlacMagicAt(bytes, 0)) return 0;
  const id3Offset = skipLeadingId3v2(bytes);
  if (id3Offset > 0 && matchesFlacMagicAt(bytes, id3Offset)) return id3Offset;
  const max = Math.min(bytes.length - FLAC_MAGIC.length, FLAC_MAGIC_SCAN_LIMIT);
  for (let i = 0; i <= max; i++) {
    if (matchesFlacMagicAt(bytes, i)) return i;
  }
  return -1;
}

function matchesFlacMagicAt(bytes, offset) {
  if (offset < 0 || offset + FLAC_MAGIC.length > bytes.length) return false;
  for (let i = 0; i < FLAC_MAGIC.length; i++) {
    if (bytes[offset + i] !== FLAC_MAGIC[i]) return false;
  }
  return true;
}

function skipLeadingId3v2(bytes) {
  if (bytes.length < ID3V2_HEADER_SIZE) return -1;
  if (bytes[0] !== 0x49 || bytes[1] !== 0x44 || bytes[2] !== 0x33) return -1;
  const flags = bytes[5] & 0xff;
  const size = ((bytes[6] & 0x7f) << 21) | ((bytes[7] & 0x7f) << 14) | ((bytes[8] & 0x7f) << 7) | (bytes[9] & 0x7f);
  const footer = (flags & 0x10) !== 0 ? ID3V2_HEADER_SIZE : 0;
  const total = ID3V2_HEADER_SIZE + size + footer;
  return total > bytes.length ? -1 : total;
}

function readUInt64BE(bytes, offset) {
  if (offset + 8 > bytes.length) throw new CodecMediaException("Unexpected end of FLAC data");
  return (BigInt(bytes[offset] & 0xff) << 56n) |
    (BigInt(bytes[offset + 1] & 0xff) << 48n) |
    (BigInt(bytes[offset + 2] & 0xff) << 40n) |
    (BigInt(bytes[offset + 3] & 0xff) << 32n) |
    (BigInt(bytes[offset + 4] & 0xff) << 24n) |
    (BigInt(bytes[offset + 5] & 0xff) << 16n) |
    (BigInt(bytes[offset + 6] & 0xff) << 8n) |
    BigInt(bytes[offset + 7] & 0xff);
}

function readLeIntAt(bytes, offset, endExclusive, fieldName) {
  if (offset < 0 || offset + 4 > endExclusive || offset + 4 > bytes.length) {
    throw new CodecMediaException(`Invalid FLAC Vorbis comment block: truncated ${fieldName}`);
  }
  const value = (bytes[offset] & 0xff) |
    ((bytes[offset + 1] & 0xff) << 8) |
    ((bytes[offset + 2] & 0xff) << 16) |
    ((bytes[offset + 3] & 0xff) << 24);
  if (value < 0) throw new CodecMediaException(`Invalid FLAC Vorbis comment block: ${fieldName} is too large`);
  return value;
}

function putIfPresent(target, targetKey, source, ...sourceKeys) {
  for (const sourceKey of sourceKeys) {
    const value = source[sourceKey];
    if (value) {
      target[targetKey] = value;
      return;
    }
  }
}
