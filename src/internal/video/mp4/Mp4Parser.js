/**
 * Mp4Parser
 * Port of me.tamkungz.codecmedia.internal.video.mp4.Mp4Parser
 *
 * Parses ISO Base Media File Format (MP4 / MOV / M4A / M4V) containers.
 * All integer arithmetic mirrors Java's signed/unsigned handling explicitly.
 *
 * JS note on 64-bit values:
 *   readUInt32 returns a regular Number (safe: max 2^32-1 < Number.MAX_SAFE_INTEGER).
 *   readUInt64 returns a BigInt to avoid precision loss on large file durations.
 */
import { CodecMediaException } from "../../../CodecMediaException.js";
import { Mp4ProbeInfo }        from "./Mp4ProbeInfo.js";
import { isSupportedMp4MajorBrand } from "./Mp4Brands.js";

// ─── Public API ───────────────────────────────────────────────────────────────

export class Mp4Parser {
  /**
   * Quick magic-bytes check — mirrors Java isLikelyMp4().
   * @param {Buffer | Uint8Array} bytes
   * @returns {boolean}
   */
  static isLikelyMp4(bytes) {
    if (!bytes || bytes.length < 12) return false;
    if (ascii(bytes, 4, 4) !== "ftyp") return false;
    const major = ascii(bytes, 8, 4);
    return isSupportedMp4MajorBrand(major);
  }

  /**
   * Parse raw MP4/M4A/M4V/MOV bytes and return probe metadata.
   * @param {Buffer | Uint8Array} bytes
   * @returns {Mp4ProbeInfo}
   * @throws {CodecMediaException}
   */
  static parse(bytes) {
    if (!Mp4Parser.isLikelyMp4(bytes)) {
      throw new CodecMediaException("Not an MP4/ISO BMFF file");
    }

    const majorBrand = ascii(bytes, 8, 4);

    let width              = null;
    let height             = null;
    let durationMillis     = null;
    let videoCodec         = null;
    let audioCodec         = null;
    let sampleRate         = null;
    let channels           = null;
    let frameRate          = null;
    let videoBitrateKbps   = null;
    let audioBitrateKbps   = null;
    let bitDepth           = null;

    let currentTrackType       = null;
    let currentTrackTimescale  = null;
    let currentTrackDuration   = null;

    // Container boxes that must be recursed into to find leaf boxes
    const CONTAINER_BOXES = new Set([
      "moov","trak","mdia","minf","stbl","dinf","edts","udta","meta","ilst","clip",
    ]);

    /**
     * Walk boxes in [rangeStart, rangeEnd) and dispatch leaf/container boxes.
     * Uses a closure over the state variables declared above.
     */
    const walkBoxes = (rangeStart, rangeEnd) => {
      let offset = rangeStart;
      while (offset + 8 <= rangeEnd) {
        let boxSize = readUInt32(bytes, offset);
        const boxType = ascii(bytes, offset + 4, 4);

        if (boxSize === 0) {
          boxSize = rangeEnd - offset;
        } else if (boxSize === 1) {
          if (offset + 16 > rangeEnd) break;
          const big = readUInt64(bytes, offset + 8);
          boxSize = big > BigInt(Number.MAX_SAFE_INTEGER) ? rangeEnd - offset : Number(big);
        }

        if (boxSize < 8) break;

        const rawSize    = readUInt32(bytes, offset);
        const headerSize = rawSize === 1 ? 16 : 8;
        const payloadStart = offset + headerSize;
        const payloadSize  = boxSize - headerSize;

        if (payloadSize < 0 || payloadStart + payloadSize > rangeEnd) break;

        // ── Container: recurse ───────────────────────────────────────────────
        if (CONTAINER_BOXES.has(boxType)) {
          walkBoxes(payloadStart, payloadStart + payloadSize);

        // ── Leaf box dispatch ────────────────────────────────────────────────
        } else if (boxType === "mvhd" && payloadSize >= 20 && durationMillis === null) {
          durationMillis = parseMvhdDuration(bytes, payloadStart, payloadSize);

        } else if (boxType === "tkhd" && payloadSize >= 84 && (width === null || height === null)) {
          const [w, h] = parseTkhdDimensions(bytes, payloadStart, payloadSize);
          if (w > 0 && h > 0) { width = w; height = h; }

        } else if (boxType === "hdlr") {
          currentTrackType = parseHdlrType(bytes, payloadStart, payloadSize);

        } else if (boxType === "mdhd") {
          const mdhd = parseMdhdInfo(bytes, payloadStart, payloadSize);
          if (mdhd.timescale != null && mdhd.timescale > 0) currentTrackTimescale = mdhd.timescale;
          if (mdhd.duration  != null && mdhd.duration  > 0) currentTrackDuration  = mdhd.duration;

        } else if (boxType === "stsd") {
          const sd = parseStsd(bytes, payloadStart, payloadSize);
          if (sd.videoCodec != null && videoCodec === null) videoCodec = sd.videoCodec;
          if (sd.audioCodec != null && audioCodec === null) audioCodec = sd.audioCodec;
          if (sd.sampleRate != null && sampleRate === null) sampleRate = sd.sampleRate;
          if (sd.channels   != null && channels   === null) channels   = sd.channels;
          if (sd.bitDepth   != null && bitDepth   === null) bitDepth   = sd.bitDepth;

        } else if (boxType === "stts" && frameRate === null &&
                   currentTrackType === "vide" &&
                   currentTrackTimescale != null && currentTrackTimescale > 0) {
          frameRate = parseFrameRateFromStts(bytes, payloadStart, payloadSize, currentTrackTimescale);

        } else if (boxType === "btrt") {
          const avg = parseAverageBitrateKbpsFromBtrt(bytes, payloadStart, payloadSize);
          if (avg != null) {
            if (currentTrackType === "vide" && videoBitrateKbps === null) videoBitrateKbps = avg;
            else if (currentTrackType === "soun" && audioBitrateKbps === null) audioBitrateKbps = avg;
          }

        } else if (boxType === "stsz" &&
                   currentTrackDuration != null && currentTrackTimescale != null) {
          const bk = parseBitrateFromStsz(bytes, payloadStart, payloadSize,
                                          currentTrackDuration, currentTrackTimescale);
          if (bk != null) {
            if (currentTrackType === "vide" && videoBitrateKbps === null) videoBitrateKbps = bk;
            else if (currentTrackType === "soun" && audioBitrateKbps === null) audioBitrateKbps = bk;
          }
        }

        offset += boxSize;
      }
    };

    walkBoxes(0, bytes.length);

    // ── Display aspect ratio ──────────────────────────────────────────────────
    let displayAspectRatio = null;
    if (width != null && height != null && width > 0 && height > 0) {
      const g = gcd(width, height);
      displayAspectRatio = `${width / g}:${height / g}`;
    }

    // ── Bitrate fallback from file size + duration ────────────────────────────
    if (durationMillis != null && durationMillis > 0) {
      const totalKbps = Math.floor((bytes.length * 8 * 1000) / (durationMillis * 1000));
      if (videoBitrateKbps === null && width != null && height != null && width > 0 && height > 0) {
        videoBitrateKbps = totalKbps;
      } else if (audioBitrateKbps === null && (sampleRate != null || channels != null)) {
        audioBitrateKbps = totalKbps;
      }
    }

    return Mp4ProbeInfo({
      durationMillis,
      width,
      height,
      majorBrand: majorBrand.trim(),
      videoCodec,
      audioCodec,
      sampleRate,
      channels,
      frameRate,
      videoBitrateKbps,
      audioBitrateKbps,
      bitDepth,
      displayAspectRatio,
    });
  }
}

// ─── Box parsers ──────────────────────────────────────────────────────────────

/**
 * mvhd — Movie Header Box.
 * Returns duration in milliseconds or null.
 */
function parseMvhdDuration(bytes, offset, size) {
  const version = bytes[offset] & 0xFF;
  if (version === 0) {
    if (size < 20) return null;
    const timescale = readUInt32(bytes, offset + 12);
    const duration  = readUInt32(bytes, offset + 16);
    if (timescale <= 0 || duration <= 0) return null;
    return Math.floor((duration * 1000) / timescale);
  }
  if (version === 1) {
    if (size < 32) return null;
    const timescale = readUInt32(bytes, offset + 20);               // u32 is fine
    const duration  = Number(readUInt64(bytes, offset + 24));       // BigInt → Number
    if (timescale <= 0 || duration <= 0) return null;
    return Math.floor((duration * 1000) / timescale);
  }
  return null;
}

/**
 * tkhd — Track Header Box.
 * Returns [width, height] in pixels (fixed-point 16.16 → integer).
 */
function parseTkhdDimensions(bytes, offset, size) {
  const version = bytes[offset] & 0xFF;
  const widthOffset  = version === 0 ? offset + 76 : offset + 88;
  const heightOffset = version === 0 ? offset + 80 : offset + 92;
  if (widthOffset + 4 > offset + size || heightOffset + 4 > offset + size) return [0, 0];
  const wFixed = readUInt32(bytes, widthOffset);
  const hFixed = readUInt32(bytes, heightOffset);
  return [wFixed >>> 16, hFixed >>> 16];
}

/**
 * mdhd — Media Header Box.
 * Returns { timescale, duration } (both Number or null).
 */
function parseMdhdInfo(bytes, offset, size) {
  if (size < 16) return { timescale: null, duration: null };
  const version = bytes[offset] & 0xFF;
  if (version === 0) {
    if (size < 20) return { timescale: null, duration: null };
    const ts = readUInt32(bytes, offset + 12);
    const du = readUInt32(bytes, offset + 16);
    return { timescale: ts > 0 ? ts : null, duration: du > 0 ? du : null };
  }
  if (version === 1) {
    if (size < 32) return { timescale: null, duration: null };
    const ts = readUInt32(bytes, offset + 20);
    const du = Number(readUInt64(bytes, offset + 24));
    return { timescale: ts > 0 ? ts : null, duration: du > 0 ? du : null };
  }
  return { timescale: null, duration: null };
}

/**
 * hdlr — Handler Reference Box.
 * Returns "vide", "soun", or null.
 */
function parseHdlrType(bytes, offset, size) {
  if (size < 12 || offset + 12 > bytes.length) return null;
  return ascii(bytes, offset + 8, 4);
}

/**
 * stsd — Sample Description Box.
 * Returns { videoCodec, audioCodec, sampleRate, channels, bitDepth }.
 */
function parseStsd(bytes, offset, size) {
  const out = { videoCodec: null, audioCodec: null, sampleRate: null, channels: null, bitDepth: null };
  if (size < 16) return out;

  const entryCount = readUInt32(bytes, offset + 4);
  let cursor = offset + 8;
  const limit = offset + size;

  for (let i = 0; i < entryCount && cursor + 8 <= limit; i++) {
    const entrySizeLong = readUInt32(bytes, cursor);
    const format = ascii(bytes, cursor + 4, 4).trim();
    if (entrySizeLong < 8) break;
    const entrySize = entrySizeLong;

    if (cursor + entrySize > limit) break;

    if (isVideoFourCc(format) && out.videoCodec === null) {
      out.videoCodec = normalizeCodec(format);
      // bit depth at entry+74 (2 bytes)
      if (entrySize >= 78) {
        const depthOffset = cursor + 74;
        if (depthOffset + 2 <= cursor + entrySize) {
          const depth = readUInt16(bytes, depthOffset);
          if (depth > 0 && depth < 64) out.bitDepth = depth;
        }
      }
    } else if (isAudioFourCc(format) && out.audioCodec === null) {
      out.audioCodec = normalizeCodec(format);
      // Audio sample entry layout (ISOBMFF §12.2):
      //   +0  reserved (6 bytes)
      //   +6  data-reference-index (2)
      //   +8  reserved (8 bytes)
      //   +16 channelcount (2)
      //   +18 samplesize  (2)
      //   +20 pre_defined (2)
      //   +22 reserved    (2)
      //   +24 samplerate  (4, 16.16 fixed)
      if (entrySize >= 36) {
        const channelOffset = cursor + 16;
        const sampleSizeOffset = cursor + 18;
        const sampleRateOffset = cursor + 24;
        if (sampleRateOffset + 4 <= cursor + entrySize) {
          out.channels  = readUInt16(bytes, channelOffset);
          out.bitDepth  = readUInt16(bytes, sampleSizeOffset);
          const srFixed = readUInt32(bytes, sampleRateOffset);
          out.sampleRate = srFixed >>> 16;
        }
      }
    }
    cursor += entrySize;
  }
  return out;
}

/**
 * stts — Time-to-Sample Box.
 * Returns frame rate (fps) as a Number, or null.
 */
function parseFrameRateFromStts(bytes, offset, size, trackTimescale) {
  if (size < 16 || trackTimescale == null || trackTimescale <= 0) return null;
  const entryCount = readUInt32(bytes, offset + 4);
  if (entryCount <= 0) return null;
  const cursor = offset + 8;
  if (cursor + 8 > offset + size) return null;
  const sampleDelta = readUInt32(bytes, cursor + 4);
  if (sampleDelta <= 0) return null;
  return trackTimescale / sampleDelta;
}

/**
 * btrt — Bit Rate Box.
 * Returns average bitrate in kbps or null.
 */
function parseAverageBitrateKbpsFromBtrt(bytes, offset, size) {
  if (size < 12) return null;
  const avgBitrate = readUInt32(bytes, offset + 8);
  if (avgBitrate <= 0) return null;
  return Math.max(1, Math.round(avgBitrate / 1000));
}

/**
 * stsz — Sample Size Box.
 * Estimates bitrate from total sample bytes + track duration.
 * Returns kbps or null.
 */
function parseBitrateFromStsz(bytes, offset, size, duration, timescale) {
  if (size < 12 || duration <= 0 || timescale <= 0) return null;
  const sampleSize  = readUInt32(bytes, offset + 4);
  const sampleCount = readUInt32(bytes, offset + 8);

  let totalBytes = 0;
  if (sampleSize > 0) {
    totalBytes = sampleSize * sampleCount;
  } else {
    let cursor = offset + 12;
    const limit = offset + size;
    for (let i = 0; i < sampleCount && cursor + 4 <= limit; i++) {
      totalBytes += readUInt32(bytes, cursor);
      cursor += 4;
    }
  }
  if (totalBytes <= 0) return null;

  const durationSeconds = duration / timescale;
  if (durationSeconds <= 0) return null;

  const bps = Math.round((totalBytes * 8) / durationSeconds);
  return Math.max(1, Math.round(bps / 1000));
}

// ─── FourCC helpers ───────────────────────────────────────────────────────────

function isVideoFourCc(f) {
  return ["avc1","hvc1","hev1","vp09","av01","jpeg","mjpa"].includes(f);
}

function isAudioFourCc(f) {
  return ["mp4a","alac","lpcm","sowt","ulaw","twos"].includes(f);
}

function normalizeCodec(fourcc) {
  switch (fourcc) {
    case "avc1":              return "h264";
    case "hvc1": case "hev1": return "hevc";
    case "vp09":              return "vp9";
    case "av01":              return "av1";
    case "mp4a":              return "aac";
    case "lpcm": case "sowt": case "twos": return "pcm";
    default:                  return fourcc;
  }
}

// ─── Byte utilities ───────────────────────────────────────────────────────────

/** Read `len` bytes at `offset` as an ASCII string. */
function ascii(bytes, offset, len) {
  if (!bytes || offset < 0 || offset + len > bytes.length) return "";
  return Buffer.from(bytes).subarray(offset, offset + len).toString("ascii");
}

/** Read big-endian unsigned 16-bit integer. */
function readUInt16(bytes, offset) {
  if (offset + 2 > bytes.length) throw new CodecMediaException("Unexpected end of MP4 data");
  return ((bytes[offset] & 0xFF) << 8) | (bytes[offset + 1] & 0xFF);
}

/** Read big-endian unsigned 32-bit integer. Returns a Number (safe: 0 – 4294967295). */
function readUInt32(bytes, offset) {
  if (offset + 4 > bytes.length) throw new CodecMediaException("Unexpected end of MP4 data");
  return (
    ((bytes[offset]     & 0xFF) * 0x1000000) +   // avoid signed shift for bit 31
    ((bytes[offset + 1] & 0xFF) << 16)         +
    ((bytes[offset + 2] & 0xFF) << 8)          +
     (bytes[offset + 3] & 0xFF)
  );
}

/** Read big-endian unsigned 64-bit integer. Returns a BigInt. */
function readUInt64(bytes, offset) {
  if (offset + 8 > bytes.length) throw new CodecMediaException("Unexpected end of MP4 data");
  return (
    (BigInt(bytes[offset]     & 0xFF) << 56n) |
    (BigInt(bytes[offset + 1] & 0xFF) << 48n) |
    (BigInt(bytes[offset + 2] & 0xFF) << 40n) |
    (BigInt(bytes[offset + 3] & 0xFF) << 32n) |
    (BigInt(bytes[offset + 4] & 0xFF) << 24n) |
    (BigInt(bytes[offset + 5] & 0xFF) << 16n) |
    (BigInt(bytes[offset + 6] & 0xFF) <<  8n) |
     BigInt(bytes[offset + 7] & 0xFF)
  );
}

/** Greatest common divisor (Euclidean). Returns at least 1. */
function gcd(a, b) {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y !== 0) { const t = x % y; x = y; y = t; }
  return x === 0 ? 1 : x;
}
