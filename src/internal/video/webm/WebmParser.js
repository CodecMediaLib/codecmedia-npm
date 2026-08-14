import { CodecMediaException } from "../../../CodecMediaException.js";
import { WebmProbeInfo } from "./WebmProbeInfo.js";

// ─── EBML / WebM element IDs ──────────────────────────────────────────────────

const ID_EBML            = 0x1a45dfa3; // EBML header container
const ID_SEGMENT         = 0x18538067; // Segment container
const ID_SEEK_HEAD       = 0x114d9b74; // SeekHead container
const ID_INFO            = 0x1549a966; // Segment Info container
const ID_TRACKS          = 0x1654ae6b; // Tracks container
const ID_TRACK_ENTRY     = 0xae;       // TrackEntry (1-byte ID)
const ID_CLUSTER         = 0x1f43b675; // Cluster (stop scanning here)
const ID_CUES            = 0x1c53bb6b; // Cues

const ID_TIMECODE_SCALE  = 0x2ad7b1;   // TimecodeScale (3-byte)
const ID_DURATION        = 0x4489;     // Duration (2-byte)

const ID_TRACK_TYPE      = 0x83;       // TrackType
const ID_CODEC_ID        = 0x86;       // CodecID
const ID_DEFAULT_DUR     = 0x23e383;   // DefaultDuration (3-byte, ns/frame)
const ID_MAX_BLOCK_ADD   = 0x55ee;     // MaxBlockAdditionID (proxy for bitrate field)
const ID_OUTPUT_SAMP_FREQ = 0x78b5;   // OutputSamplingFrequency (float)

// Video sub-elements (inside TrackEntry > Video 0xE0)
const ID_VIDEO           = 0xe0;
const ID_PIXEL_WIDTH     = 0xb0;
const ID_PIXEL_HEIGHT    = 0xba;
const ID_DISPLAY_WIDTH   = 0x54b0;
const ID_DISPLAY_HEIGHT  = 0x54ba;
const ID_COLOUR          = 0x55b0;     // Colour container
const ID_BITS_PER_CHAN   = 0x55b2;     // BitsPerChannel

// Audio sub-elements (inside TrackEntry > Audio 0xE1)
const ID_AUDIO           = 0xe1;
const ID_SAMPLING_FREQ   = 0xb5;       // SamplingFrequency (float)
const ID_CHANNELS        = 0x9f;       // Channels
const ID_BIT_DEPTH       = 0x6264;     // BitDepth

// DefaultDecodedFieldDuration / TrackDefaultDuration variants
const ID_DEF_DEC_FD      = 0x234e7a;   // DefaultDecodedFieldDuration (alt ID seen in some muxers)

// Unknown-size VINT sentinel (all data bits set)
const UNKNOWN_SIZE_PATTERNS = new Set([
  0x01ffffffffffffff,     // 8-byte unknown
  0xffffffffffffff,       // 7-byte unknown
  0x1fffffffffffff,       // 7-byte (alt)
  0x3fffffffffffff,       // 7-byte (alt)
  0x7fffff,               // 3-byte unknown
  0x1fffff,               // 3-byte unknown
]);

// Level-1 containers that are meaningful and parseable
const LEVEL1_CONTAINERS = new Set([ID_INFO, ID_TRACKS]);
// Level-1 containers we skip entirely
const LEVEL1_SKIP = new Set([ID_SEEK_HEAD, ID_CUES, ID_CLUSTER]);
// 4-byte IDs that signal top-level segments to bail out of EBML header scanning
const EBML_ID_BUF = Buffer.from([0x1a, 0x45, 0xdf, 0xa3]);

export class WebmParser {
  /**
   * Quick check: does this look like a WebM buffer?
   * Handles any EBML header size (1-byte through 8-byte VINT).
   * @param {Buffer} bytes
   * @returns {boolean}
   */
  static isLikelyWebm(bytes) {
    if (!bytes || bytes.length < 16) return false;
    if (!matches(bytes, 0, EBML_ID_BUF)) return false;

    // Decode the EBML header size (may be 1–8 byte VINT)
    if (bytes.length < 5) return false;
    const sizeLen = vintLength(bytes[4] & 0xff);
    if (sizeLen === 0) return false;
    const headerPayloadSize = readVintValue(bytes, 4, sizeLen);

    // Scan the EBML header payload for a DocType element (0x4282)
    const payloadStart = 4 + sizeLen;
    const payloadEnd   = Math.min(bytes.length, payloadStart + headerPayloadSize);

    let p = payloadStart;
    while (p + 3 <= payloadEnd) {
      const idLen = ebmlIdLength(bytes[p] & 0xff);
      if (idLen === 0 || p + idLen >= payloadEnd) break;
      const id      = readElementId(bytes, p, idLen);
      const szLen   = vintLength(bytes[p + idLen] & 0xff);
      if (szLen === 0 || p + idLen + szLen > payloadEnd) break;
      const valSize = readVintValue(bytes, p + idLen, szLen);
      const valOff  = p + idLen + szLen;
      const valEnd  = Math.min(payloadEnd, valOff + valSize);

      if (id === 0x4282) { // DocType
        const doctype = bytes.subarray(valOff, valEnd).toString("ascii").trim();
        return doctype === "webm";
      }
      p = valEnd;
    }

    // Fallback: raw scan within first 128 bytes for "webm" ASCII
    // (handles exotic muxers that pad or reorder EBML header fields)
    const searchEnd = Math.min(bytes.length, 128);
    return indexOf(bytes.subarray(0, searchEnd), Buffer.from("webm", "ascii"), 0) >= 0;
  }

  /**
   * Parse a WebM buffer and return probe metadata.
   * Uses proper EBML tree navigation — no naive byte scanning for 0xAE.
   * @param {Buffer} bytes
   * @returns {import("./WebmProbeInfo.js").WebmProbeInfo}
   * @throws {CodecMediaException}
   */
  static parse(bytes) {
    if (!bytes || bytes.length < 16)
      throw new CodecMediaException("WebM data is empty or too short");
    if (!matches(bytes, 0, EBML_ID_BUF))
      throw new CodecMediaException("Not an EBML/WebM file (missing EBML header)");

    // ── Step 1: skip the EBML header element ──────────────────────────────────
    const ebmlSizeLen = vintLength(bytes[4] & 0xff);
    if (ebmlSizeLen === 0)
      throw new CodecMediaException("Malformed EBML header size VINT");
    const ebmlPayloadSize = readVintValue(bytes, 4, ebmlSizeLen);
    const segmentStart    = 4 + ebmlSizeLen + ebmlPayloadSize;

    // ── Step 2: find and enter the Segment element ────────────────────────────
    const seg = findElement(bytes, segmentStart, bytes.length, ID_SEGMENT);
    if (!seg)
      throw new CodecMediaException("No Segment element found in WebM data");

    const segBodyStart = seg.bodyOffset;
    // Segment size may be "unknown" in streaming files; clamp to buffer length
    const segBodyEnd   = isUnknownSize(seg.size) ? bytes.length
                                                  : Math.min(bytes.length, seg.bodyOffset + seg.size);

    // ── Step 3: scan Segment children for Info and Tracks ────────────────────
    let timecodeScale   = 1_000_000;
    let durationRaw     = -1;    // in timecode units (float)
    let width           = null;
    let height          = null;
    let videoCodec      = null;
    let audioCodec      = null;
    let sampleRate      = null;
    let channels        = null;
    let frameRate       = null;
    let videoBitrateKbps = null;
    let audioBitrateKbps = null;
    let bitDepth         = null;

    let cursor = segBodyStart;
    while (cursor + 2 < segBodyEnd) {
      const idLen = ebmlIdLength(bytes[cursor] & 0xff);
      if (idLen === 0 || cursor + idLen >= segBodyEnd) { cursor++; continue; }

      const id      = readElementId(bytes, cursor, idLen);
      const szStart = cursor + idLen;
      if (szStart >= segBodyEnd) break;
      const szLen   = vintLength(bytes[szStart] & 0xff);
      if (szLen === 0 || szStart + szLen > segBodyEnd) { cursor++; continue; }

      const size    = readVintValue(bytes, szStart, szLen);
      const body    = szStart + szLen;
      const unknown = isUnknownSize(size);
      const bodyEnd = unknown ? segBodyEnd : Math.min(segBodyEnd, body + size);

      if (id === ID_CLUSTER) break; // Clusters come after Tracks — stop here

      if (id === ID_INFO) {
        // ── Parse Info: TimecodeScale + Duration ──────────────────────────
        const r = parseInfo(bytes, body, bodyEnd);
        if (r.timecodeScale > 0) timecodeScale = r.timecodeScale;
        if (r.duration >= 0)     durationRaw   = r.duration;

      } else if (id === ID_TRACKS) {
        // ── Parse Tracks: iterate TrackEntry children ─────────────────────
        let tp = body;
        while (tp + 2 < bodyEnd) {
          const tidLen = ebmlIdLength(bytes[tp] & 0xff);
          if (tidLen === 0 || tp + tidLen >= bodyEnd) { tp++; continue; }

          const tid    = readElementId(bytes, tp, tidLen);
          const tszS   = tp + tidLen;
          if (tszS >= bodyEnd) break;
          const tszLen = vintLength(bytes[tszS] & 0xff);
          if (tszLen === 0 || tszS + tszLen > bodyEnd) { tp++; continue; }
          const tsize  = readVintValue(bytes, tszS, tszLen);
          const tbody  = tszS + tszLen;
          const tbodyEnd = isUnknownSize(tsize) ? bodyEnd : Math.min(bodyEnd, tbody + tsize);

          if (tid === ID_TRACK_ENTRY) {
            const t = parseTrackEntry(bytes, tbody, tbodyEnd);
            if (t.trackType === 1) {       // video
              if (t.width      != null) width             = t.width;
              if (t.height     != null) height            = t.height;
              if (t.codec      != null) videoCodec        = t.codec;
              if (t.frameRate  != null) frameRate         = t.frameRate;
              if (t.bitrateKbps != null) videoBitrateKbps = t.bitrateKbps;
              if (t.bitDepth   != null) bitDepth          = t.bitDepth;
            } else if (t.trackType === 2) { // audio
              if (t.codec      != null) audioCodec        = t.codec;
              if (t.sampleRate != null) sampleRate        = t.sampleRate;
              if (t.channels   != null) channels          = t.channels;
              if (t.bitrateKbps != null) audioBitrateKbps = t.bitrateKbps;
              if (t.bitDepth   != null) bitDepth          = t.bitDepth;
            }
          }
          tp = tbodyEnd;
        }
      }

      cursor = bodyEnd;
    }

    // ── Step 4: compute durationMillis ───────────────────────────────────────
    let durationMillis = null;
    if (durationRaw > 0) {
      // durationRaw is in TimecodeScale units (nanoseconds * scale factor)
      // Convert: durationMillis = durationRaw * timecodeScale / 1_000_000
      durationMillis = Math.round(durationRaw * (timecodeScale / 1_000_000));
    }

    // ── Step 5: display aspect ratio ─────────────────────────────────────────
    let displayAspectRatio = null;
    if (width != null && height != null && width > 0 && height > 0) {
      const g = gcd(width, height);
      displayAspectRatio = `${width / g}:${height / g}`;
    }

    // ── Step 6: fallback bitrate estimate from file size ─────────────────────
    if (durationMillis != null && durationMillis > 0) {
      const totalKbps = Math.floor((bytes.length * 8) / durationMillis); // bits/ms = kbps
      if (videoBitrateKbps == null && width != null && height != null) {
        videoBitrateKbps = totalKbps;
      } else if (audioBitrateKbps == null && (sampleRate != null || channels != null)) {
        audioBitrateKbps = totalKbps;
      }
    }

    return WebmProbeInfo({
      durationMillis,
      width,
      height,
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

// ─── Element navigation helpers ───────────────────────────────────────────────

/**
 * Search forward in [from, limit) for an element with the given 4-byte ID.
 * Returns { bodyOffset, size } or null.
 */
function findElement(bytes, from, limit, targetId) {
  let p = from;
  while (p + 2 < limit) {
    const idLen = ebmlIdLength(bytes[p] & 0xff);
    if (idLen === 0 || p + idLen >= limit) { p++; continue; }
    const id    = readElementId(bytes, p, idLen);
    const szOff = p + idLen;
    if (szOff >= limit) break;
    const szLen = vintLength(bytes[szOff] & 0xff);
    if (szLen === 0 || szOff + szLen > limit) { p++; continue; }
    const size  = readVintValue(bytes, szOff, szLen);
    const body  = szOff + szLen;
    if (id === targetId) return { bodyOffset: body, size };
    const bodyEnd = isUnknownSize(size) ? limit : Math.min(limit, body + size);
    p = bodyEnd;
  }
  return null;
}

// ─── Info element parser ──────────────────────────────────────────────────────

function parseInfo(bytes, offset, end) {
  let timecodeScale = 1_000_000;
  let duration      = -1;
  let p = offset;
  while (p + 2 <= end) {
    const idLen = ebmlIdLength(bytes[p] & 0xff);
    if (idLen === 0 || p + idLen >= end) break;
    const id      = readElementId(bytes, p, idLen);
    const szOff   = p + idLen;
    if (szOff >= end) break;
    const szLen   = vintLength(bytes[szOff] & 0xff);
    if (szLen === 0 || szOff + szLen > end) break;
    const valSize = readVintValue(bytes, szOff, szLen);
    const valOff  = szOff + szLen;
    const valEnd  = Math.min(end, valOff + valSize);

    if (id === ID_TIMECODE_SCALE && valSize >= 1 && valSize <= 8) {
      let v = 0n;
      for (let i = 0; i < valSize; i++) v = (v << 8n) | BigInt(bytes[valOff + i] & 0xff);
      if (v > 0n) timecodeScale = Number(v);
    } else if (id === ID_DURATION && (valSize === 4 || valSize === 8)) {
      if (valOff + valSize <= bytes.length) {
        const raw = valSize === 4 ? bytes.readFloatBE(valOff) : bytes.readDoubleBE(valOff);
        if (raw > 0 && isFinite(raw)) duration = raw;
      }
    }
    p = valEnd;
  }
  return { timecodeScale, duration };
}

// ─── TrackEntry parser ────────────────────────────────────────────────────────

/**
 * Fully parse one TrackEntry body, including nested Video/Audio sub-elements
 * and Colour container for bit depth.
 */
function parseTrackEntry(bytes, offset, end) {
  const out = {
    trackType: null, codec: null,
    width: null, height: null,
    sampleRate: null, channels: null,
    frameRate: null, bitrateKbps: null,
    bitDepth: null,
  };
  let p = offset;
  while (p + 2 <= end) {
    const idLen = ebmlIdLength(bytes[p] & 0xff);
    if (idLen === 0 || p + idLen >= end) break;
    const id      = readElementId(bytes, p, idLen);
    const szOff   = p + idLen;
    if (szOff >= end) break;
    const szLen   = vintLength(bytes[szOff] & 0xff);
    if (szLen === 0 || szOff + szLen > end) break;
    const valSize = readVintValue(bytes, szOff, szLen);
    const valOff  = szOff + szLen;
    const valEnd  = isUnknownSize(valSize) ? end : Math.min(end, valOff + valSize);

    switch (id) {
      case ID_TRACK_TYPE:
        if (valSize >= 1) out.trackType = bytes[valOff] & 0xff;
        break;
      case ID_CODEC_ID:
        out.codec = bytes.subarray(valOff, valEnd).toString("ascii").replace(/\0/g, "").trim();
        break;
      case ID_DEFAULT_DUR:
      case ID_DEF_DEC_FD: {
        // DefaultDuration in nanoseconds per frame → fps
        const sz = valEnd - valOff;
        if (sz > 0 && sz <= 8 && valOff + sz <= bytes.length) {
          let ns = 0n;
          for (let i = 0; i < sz; i++) ns = (ns << 8n) | BigInt(bytes[valOff + i] & 0xff);
          if (ns > 0n) out.frameRate = 1_000_000_000 / Number(ns);
        }
        break;
      }
      case ID_VIDEO:
        parseVideoBlock(bytes, valOff, valEnd, out);
        break;
      case ID_AUDIO:
        parseAudioBlock(bytes, valOff, valEnd, out);
        break;
      default:
        break;
    }
    p = valEnd;
  }
  return out;
}

/** Parse nested Video (0xE0) sub-elements into `out`. */
function parseVideoBlock(bytes, offset, end, out) {
  let p = offset;
  while (p + 2 <= end) {
    const idLen = ebmlIdLength(bytes[p] & 0xff);
    if (idLen === 0 || p + idLen >= end) break;
    const id      = readElementId(bytes, p, idLen);
    const szOff   = p + idLen;
    if (szOff >= end) break;
    const szLen   = vintLength(bytes[szOff] & 0xff);
    if (szLen === 0 || szOff + szLen > end) break;
    const valSize = readVintValue(bytes, szOff, szLen);
    const valOff  = szOff + szLen;
    const valEnd  = isUnknownSize(valSize) ? end : Math.min(end, valOff + valSize);

    switch (id) {
      case ID_PIXEL_WIDTH:
        out.width = readUnsigned(bytes, valOff, valEnd - valOff);
        break;
      case ID_PIXEL_HEIGHT:
        out.height = readUnsigned(bytes, valOff, valEnd - valOff);
        break;
      case ID_DISPLAY_WIDTH:
        // Prefer PixelWidth; only fill if not yet set
        if (out.width == null) out.width = readUnsigned(bytes, valOff, valEnd - valOff);
        break;
      case ID_DISPLAY_HEIGHT:
        if (out.height == null) out.height = readUnsigned(bytes, valOff, valEnd - valOff);
        break;
      case ID_COLOUR:
        parseColourBlock(bytes, valOff, valEnd, out);
        break;
      default:
        break;
    }
    p = valEnd;
  }
}

/** Parse nested Audio (0xE1) sub-elements into `out`. */
function parseAudioBlock(bytes, offset, end, out) {
  let p = offset;
  while (p + 2 <= end) {
    const idLen = ebmlIdLength(bytes[p] & 0xff);
    if (idLen === 0 || p + idLen >= end) break;
    const id      = readElementId(bytes, p, idLen);
    const szOff   = p + idLen;
    if (szOff >= end) break;
    const szLen   = vintLength(bytes[szOff] & 0xff);
    if (szLen === 0 || szOff + szLen > end) break;
    const valSize = readVintValue(bytes, szOff, szLen);
    const valOff  = szOff + szLen;
    const valEnd  = isUnknownSize(valSize) ? end : Math.min(end, valOff + valSize);
    const sz      = valEnd - valOff;

    switch (id) {
      case ID_SAMPLING_FREQ:
        out.sampleRate = parseEbmlFloatAsInt(bytes, valOff, sz);
        break;
      case ID_OUTPUT_SAMP_FREQ:
        // OutputSamplingFrequency is the decoded rate — use as sampleRate if not set
        if (out.sampleRate == null) out.sampleRate = parseEbmlFloatAsInt(bytes, valOff, sz);
        break;
      case ID_CHANNELS:
        out.channels = readUnsigned(bytes, valOff, sz);
        break;
      case ID_BIT_DEPTH:
        out.bitDepth = readUnsigned(bytes, valOff, sz);
        break;
      default:
        break;
    }
    p = valEnd;
  }
}

/** Parse Colour (0x55B0) sub-elements for BitsPerChannel. */
function parseColourBlock(bytes, offset, end, out) {
  let p = offset;
  while (p + 2 <= end) {
    const idLen = ebmlIdLength(bytes[p] & 0xff);
    if (idLen === 0 || p + idLen >= end) break;
    const id      = readElementId(bytes, p, idLen);
    const szOff   = p + idLen;
    if (szOff >= end) break;
    const szLen   = vintLength(bytes[szOff] & 0xff);
    if (szLen === 0 || szOff + szLen > end) break;
    const valSize = readVintValue(bytes, szOff, szLen);
    const valOff  = szOff + szLen;
    const valEnd  = isUnknownSize(valSize) ? end : Math.min(end, valOff + valSize);

    if (id === ID_BITS_PER_CHAN && out.bitDepth == null) {
      out.bitDepth = readUnsigned(bytes, valOff, valEnd - valOff);
    }
    p = valEnd;
  }
}

// ─── Low-level EBML primitives ────────────────────────────────────────────────

/**
 * Is this VINT value an "unknown size" sentinel?
 * All data bits set = streaming/unknown-size segment.
 */
function isUnknownSize(size) {
  // The most common unknown-size value for each VINT width:
  // 1-byte: 0x7f, 2-byte: 0x3fff, 3-byte: 0x1fffff, 4-byte: 0x0fffffff
  // 5-byte: 0x07ffffffff, 6-byte: 0x03ffffffffff, 7-byte: 0x01ffffffffffff, 8-byte: 0x00ffffffffffffff
  if (size < 0) return true;
  const n = typeof size === "bigint" ? size : BigInt(Math.round(size));
  return (
    n === 0x7fn            ||
    n === 0x3fffn          ||
    n === 0x1fffffn        ||
    n === 0x0fffffffn      ||
    n === 0x07ffffffffn    ||
    n === 0x03ffffffffffn  ||
    n === 0x01ffffffffffffn ||
    n === 0x00ffffffffffffffn
  );
}

function parseEbmlFloatAsInt(bytes, offset, size) {
  if (size === 4 && offset + 4 <= bytes.length) return Math.round(bytes.readFloatBE(offset));
  if (size === 8 && offset + 8 <= bytes.length) return Math.round(bytes.readDoubleBE(offset));
  return 0;
}

function readUnsigned(bytes, offset, size) {
  if (size <= 0 || size > 8 || offset + size > bytes.length) return 0;
  if (size <= 4) {
    let v = 0;
    for (let i = 0; i < size; i++) v = (v << 8) | (bytes[offset + i] & 0xff);
    return v;
  }
  let v = 0n;
  for (let i = 0; i < size; i++) v = (v << 8n) | BigInt(bytes[offset + i] & 0xff);
  return v > BigInt(Number.MAX_SAFE_INTEGER) ? Number.MAX_SAFE_INTEGER : Number(v);
}

function gcd(a, b) {
  let x = Math.abs(a), y = Math.abs(b);
  while (y !== 0) { const t = x % y; x = y; y = t; }
  return x === 0 ? 1 : x;
}

function indexOf(haystack, needle, from) {
  if (!needle.length || haystack.length < needle.length || from < 0) return -1;
  outer: for (let i = from; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

function matches(bytes, offset, expected) {
  if (offset < 0 || offset + expected.length > bytes.length) return false;
  for (let i = 0; i < expected.length; i++) {
    if (bytes[offset + i] !== expected[i]) return false;
  }
  return true;
}

function vintLength(firstByte) {
  if (firstByte === 0) return 0;
  let mask = 0x80, len = 1;
  while ((firstByte & mask) === 0) { mask >>>= 1; len++; if (len > 8) return 0; }
  return len;
}

function ebmlIdLength(firstByte) {
  if (firstByte === 0) return 0;
  let mask = 0x80, len = 1;
  while ((firstByte & mask) === 0) { mask >>>= 1; len++; if (len > 4) return 0; }
  return len;
}

function readElementId(bytes, offset, len) {
  let v = 0;
  for (let i = 0; i < len; i++) v = (v << 8) | (bytes[offset + i] & 0xff);
  return v;
}

function readVintValue(bytes, offset, len) {
  let v = bytes[offset] & (0xff >>> len);
  for (let i = 1; i < len; i++) v = (v * 256) + (bytes[offset + i] & 0xff);
  return v;
}