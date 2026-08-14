/**
 * Mp3Parser
 * Port of me.tamkungz.codecmedia.internal.audio.mp3.Mp3Parser
 *
 * JS-specific note on the MP3 sync word (0xFFE00000):
 *   JS bitwise operators work on *signed* 32-bit integers, so 0xFFE00000 in a
 *   bitwise expression is coerced to -2097152 — exactly like Java's `int`.
 *   Therefore all bitfield comparisons are written with `(0xFFE00000 | 0)` to
 *   make the signed interpretation explicit, matching Java behaviour precisely.
 */
import { ByteArrayReader } from "../../io/ByteArrayReader.js";
import { CodecMediaException } from "../../../CodecMediaException.js";
import { Mp3ProbeInfo } from "./Mp3ProbeInfo.js";

// ─── Lookup tables (mirror Java constants exactly) ────────────────────────────

/** Bitrate table for MPEG-1 Layer III, indexed by header bits [3:0]. */
const BITRATE_MPEG1_L3  = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0];
/** Bitrate table for MPEG-2 / MPEG-2.5 Layer III. */
const BITRATE_MPEG2_L3  = [0,  8, 16, 24, 32, 40, 48, 56,  64,  80,  96, 112, 128, 144, 160, 0];

const SAMPLE_RATE_MPEG1  = [44100, 48000, 32000, 0];
const SAMPLE_RATE_MPEG2  = [22050, 24000, 16000, 0];
const SAMPLE_RATE_MPEG25 = [11025, 12000,  8000, 0];

// Signed 32-bit representation of the sync mask (mirrors Java literal 0xFFE00000)
const SYNC_MASK = 0xFFE00000 | 0; // = -2097152

export class Mp3Parser {
  /**
   * Parse raw MP3 bytes and return probe metadata.
   * @param {Buffer | Uint8Array} data
   * @returns {import("./Mp3ProbeInfo.js").Mp3ProbeInfo}
   * @throws {CodecMediaException}
   */
  static parse(data) {
    if (data == null || data.length < 4)
      throw new CodecMediaException("Invalid MP3 data: too small");

    const reader = new ByteArrayReader(data);

    const audioStart       = skipId3v2(reader);
    const firstFrameOffset = findFrameOffset(data, audioStart);
    if (firstFrameOffset < 0)
      throw new CodecMediaException("No valid MP3 frame found");

    const firstFrame = parseFrameHeader(data, firstFrameOffset);
    if (firstFrame == null)
      throw new CodecMediaException("Invalid first MP3 frame");

    const xingFrames = readXingFrameCountIfPresent(data, firstFrameOffset, firstFrame);
    const vbriFrames = readVbriFrameCountIfPresent(data, firstFrameOffset, firstFrame);

    const stats        = scanFrames(data, firstFrameOffset, firstFrame.sampleRate, firstFrame.samplesPerFrame);
    const durationMillis = estimateDurationMillis(stats, xingFrames, vbriFrames);
    const avgBitrate   = estimateAverageBitrateKbps(stats, durationMillis);
    const mode         = detectBitrateMode(stats, xingFrames, vbriFrames);

    return Mp3ProbeInfo({
      codec:         "mp3",
      sampleRate:    firstFrame.sampleRate,
      channels:      firstFrame.channels,
      bitrateKbps:   avgBitrate > 0 ? avgBitrate : firstFrame.bitrateKbps,
      bitrateMode:   mode,
      durationMillis,
    });
  }
}

// ─── Private helpers ──────────────────────────────────────────────────────────

/**
 * Skip an ID3v2 tag at the beginning of the stream if present.
 * Returns the byte offset where audio data starts.
 * @param {ByteArrayReader} reader
 * @returns {number}
 */
function skipId3v2(reader) {
  if (reader.length() < 10) return 0;
  // "ID3" magic: 0x49 0x44 0x33
  if (reader.getU8(0) !== 0x49 || reader.getU8(1) !== 0x44 || reader.getU8(2) !== 0x33) return 0;

  const flags = reader.getU8(5);
  // Tag size is a 4-byte synchsafe integer (7 bits per byte)
  const size  = synchsafeToInt(reader.getU8(6), reader.getU8(7), reader.getU8(8), reader.getU8(9));
  // 10-byte header + payload size + optional 10-byte footer (when unsync footer flag set)
  const total = 10 + size + ((flags & 0x10) !== 0 ? 10 : 0);
  return Math.min(total, reader.length());
}

/**
 * Decode a 4-byte synchsafe integer (7 usable bits per byte, MSB first).
 * Used for ID3v2 tag size fields.
 */
function synchsafeToInt(b0, b1, b2, b3) {
  return ((b0 & 0x7F) << 21) | ((b1 & 0x7F) << 14) | ((b2 & 0x7F) << 7) | (b3 & 0x7F);
}

/**
 * Scan forward from `start` for the first plausible MP3 sync word, confirmed
 * by a second valid frame immediately following it.
 * Requires two consecutive valid headers to avoid false positives in ID3 data.
 * @param {Buffer} data
 * @param {number} start
 * @returns {number} byte offset of the first frame, or -1 if not found
 */
function findFrameOffset(data, start) {
  for (let i = Math.max(0, start); i + 4 <= data.length; i++) {
    const h = parseFrameHeader(data, i);
    if (h == null) continue;
    const next = i + h.frameLength;
    if (next + 4 <= data.length && parseFrameHeader(data, next) != null) return i;
  }
  return -1;
}

/**
 * Parse a 4-byte MP3 frame header at `offset`.
 * Returns a descriptor object or null if the header is invalid.
 *
 * @param {Buffer} data
 * @param {number} offset
 * @returns {{ versionBits, layerBits, bitrateKbps, sampleRate, channels, frameLength, samplesPerFrame } | null}
 */
function parseFrameHeader(data, offset) {
  if (offset < 0 || offset + 4 > data.length) return null;

  // Read 4 bytes as a signed 32-bit integer (mirrors Java int arithmetic)
  const h = ((data[offset]     & 0xFF) << 24) |
            ((data[offset + 1] & 0xFF) << 16) |
            ((data[offset + 2] & 0xFF) <<  8) |
             (data[offset + 3] & 0xFF);

  // Sync word check: top 11 bits must all be 1.
  // Both sides are signed 32-bit here, matching Java behaviour exactly.
  if ((h & SYNC_MASK) !== SYNC_MASK) return null;

  const versionBits   = (h >>> 19) & 0b11;   // MPEG version
  const layerBits     = (h >>> 17) & 0b11;   // must be 0b01 for Layer III
  const bitrateIndex  = (h >>> 12) & 0b1111;
  const sampleRateIdx = (h >>> 10) & 0b11;
  const padding       = (h >>>  9) & 0b1;
  const channelMode   = (h >>>  6) & 0b11;

  // Reject invalid combinations
  if (
    versionBits  === 0b01 ||   // reserved MPEG version
    layerBits    !== 0b01 ||   // not Layer III
    bitrateIndex === 0         ||   // free bitrate (unsupported)
    bitrateIndex === 0b1111    ||   // bad bitrate
    sampleRateIdx === 0b11         // reserved sample rate
  ) return null;

  const sampleRate =
    versionBits === 0b11 ? SAMPLE_RATE_MPEG1[sampleRateIdx]  :
    versionBits === 0b10 ? SAMPLE_RATE_MPEG2[sampleRateIdx]  :
                           SAMPLE_RATE_MPEG25[sampleRateIdx];
  if (sampleRate === 0) return null;

  const bitrateKbps = (versionBits === 0b11 ? BITRATE_MPEG1_L3 : BITRATE_MPEG2_L3)[bitrateIndex];
  if (bitrateKbps <= 0) return null;

  const samplesPerFrame = (versionBits === 0b11) ? 1152 : 576;
  // Frame length in bytes (slot-based formula from the MPEG spec)
  const frameLength = (versionBits === 0b11)
    ? Math.floor((144_000 * bitrateKbps) / sampleRate) + padding
    : Math.floor(( 72_000 * bitrateKbps) / sampleRate) + padding;
  if (frameLength < 4) return null;

  // Channel mode 0b11 = single channel (mono); all others are 2-channel
  const channels = (channelMode === 0b11) ? 1 : 2;

  return { versionBits, layerBits, bitrateKbps, sampleRate, channels, frameLength, samplesPerFrame };
}

/**
 * Attempt to read the frame count from an Xing (VBR) or Info (CBR-tagged) header.
 * These live inside the first audio frame, after the side-information block.
 * Returns the frame count, or -1 if no Xing/Info tag is present.
 * @param {Buffer} data
 * @param {number} frameOffset
 * @param {object} header - parsed first-frame descriptor
 * @returns {number}
 */
function readXingFrameCountIfPresent(data, frameOffset, header) {
  // Side-information size depends on MPEG version and channel count
  const sideInfoSize = (header.versionBits === 0b11)
    ? (header.channels === 1 ? 17 : 32)  // MPEG-1
    : (header.channels === 1 ?  9 : 17); // MPEG-2/2.5
  const xingOffset = frameOffset + 4 + sideInfoSize;
  if (xingOffset + 16 > data.length) return -1;

  const tag = asciiSlice(data, xingOffset, 4);
  if (tag !== "Xing" && tag !== "Info") return -1;

  const flags = readIntBE(data, xingOffset + 4);
  // Bit 0 of flags = "frames field present"
  if ((flags & 0x1) === 0 || xingOffset + 12 > data.length) return -1;
  return readIntBE(data, xingOffset + 8);
}

/**
 * Attempt to read the frame count from a VBRI header (Fraunhofer encoder).
 * The VBRI tag is always at a fixed offset of 32 bytes after the sync word.
 * Returns frame count or -1 if not present.
 * @param {Buffer} data
 * @param {number} frameOffset
 * @param {object} _header  (unused; kept for API symmetry with Java)
 * @returns {number}
 */
function readVbriFrameCountIfPresent(data, frameOffset, _header) {
  const vbriOffset = frameOffset + 4 + 32;
  if (vbriOffset + 18 > data.length) return -1;
  if (asciiSlice(data, vbriOffset, 4) !== "VBRI") return -1;
  return readIntBE(data, vbriOffset + 14);
}

/**
 * Walk all MP3 frames from `startOffset`, collecting aggregate statistics.
 * Stops at the first unreadable or truncated frame.
 * @param {Buffer} data
 * @param {number} startOffset
 * @param {number} sampleRate
 * @param {number} samplesPerFrame
 * @returns {{ frames, bitrates, totalBits, totalSamples, sampleRate, samplesPerFrame }}
 */
function scanFrames(data, startOffset, sampleRate, samplesPerFrame) {
  let offset      = startOffset;
  let totalBits   = 0n;  // BigInt to mirror Java long (avoids precision loss)
  let totalSamples = 0n;
  let frames      = 0;
  const bitrates  = new Set(); // distinct bitrate values seen

  while (offset + 4 <= data.length) {
    const h = parseFrameHeader(data, offset);
    if (h == null || offset + h.frameLength > data.length) break;

    frames++;
    bitrates.add(h.bitrateKbps);
    totalBits    += BigInt(h.frameLength * 8);
    totalSamples += BigInt(h.samplesPerFrame);
    offset       += h.frameLength;
  }

  return { frames, bitrates, totalBits, totalSamples, sampleRate, samplesPerFrame };
}

/**
 * Estimate duration in milliseconds.
 * Priority order: direct sample count from scan → Xing/VBRI frame count → 0.
 * @param {object} stats
 * @param {number} xingFrames
 * @param {number} vbriFrames
 * @returns {number}
 */
function estimateDurationMillis(stats, xingFrames, vbriFrames) {
  if (stats.frames <= 0) return 0;

  // Most accurate: sum of samples actually decoded
  if (stats.totalSamples > 0n && stats.sampleRate > 0) {
    return Number((stats.totalSamples * 1000n) / BigInt(stats.sampleRate));
  }

  // Fallback: use frame count from Xing or VBRI header
  const knownFrames = xingFrames > 0 ? xingFrames : vbriFrames;
  if (knownFrames > 0 && stats.samplesPerFrame > 0 && stats.sampleRate > 0) {
    return Number(
      (BigInt(knownFrames) * BigInt(stats.samplesPerFrame) * 1000n) / BigInt(stats.sampleRate)
    );
  }

  return 0;
}

/**
 * Compute the average bitrate across all scanned frames.
 * @param {object} stats
 * @param {number} durationMillis
 * @returns {number} kbps, or 0 if unable to compute
 */
function estimateAverageBitrateKbps(stats, durationMillis) {
  if (durationMillis <= 0 || stats.totalBits <= 0n) return 0;
  // (totalBits * 1000) / durationMs / 1000 = kbps  (mirrors Java long arithmetic)
  return Number((stats.totalBits * 1000n) / BigInt(durationMillis) / 1000n);
}

/**
 * Determine the bitrate mode (CBR / VBR / CVBR / UNKNOWN).
 *
 * Logic (mirrors Java):
 *   - < 2 frames → UNKNOWN
 *   - VBR tag + single bitrate → CVBR (constrained VBR)
 *   - VBR tag OR multiple bitrates → VBR
 *   - single bitrate, no VBR tag → CBR
 *
 * @param {object} stats
 * @param {number} xingFrames
 * @param {number} vbriFrames
 * @returns {"CBR"|"VBR"|"CVBR"|"UNKNOWN"}
 */
function detectBitrateMode(stats, xingFrames, vbriFrames) {
  if (stats.frames <= 1) return "UNKNOWN";
  const hasVbrTag  = xingFrames > 0 || vbriFrames > 0;
  const oneBitrate = stats.bitrates.size <= 1;

  if (hasVbrTag && oneBitrate)  return "CVBR";
  if (hasVbrTag || !oneBitrate) return "VBR";
  return "CBR";
}

// ─── Byte utilities ───────────────────────────────────────────────────────────

/** Read a big-endian 32-bit unsigned integer. Returns -1 on out-of-bounds. */
function readIntBE(data, offset) {
  if (offset + 4 > data.length) return -1;
  return (
    ((data[offset]     & 0xFF) << 24) |
    ((data[offset + 1] & 0xFF) << 16) |
    ((data[offset + 2] & 0xFF) <<  8) |
     (data[offset + 3] & 0xFF)
  ) >>> 0; // force unsigned
}

/** Read `len` bytes at `offset` as an ASCII string. */
function asciiSlice(data, offset, len) {
  if (offset < 0 || offset + len > data.length) return "";
  return Buffer.from(data).subarray(offset, offset + len).toString("ascii");
}