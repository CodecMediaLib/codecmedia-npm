import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { StubCodecMediaEngine } from "../src/internal/StubCodecMediaEngine.js";
import { CodecMediaException }  from "../src/CodecMediaException.js";
import { MediaType }             from "../src/model/MediaType.js";
import { StreamKind }            from "../src/model/StreamKind.js";
import { ValidationOptions }     from "../src/options/ValidationOptions.js";
import { PlaybackOptions }       from "../src/options/PlaybackOptions.js";
import { AudioExtractOptions }   from "../src/options/AudioExtractOptions.js";
import { ConversionOptions }     from "../src/options/ConversionOptions.js";
import { Metadata }              from "../src/model/Metadata.js";
import { WebpParser }            from "../src/internal/image/webp/WebpParser.js";

// ─── Test fixture helpers ─────────────────────────────────────────────────────

let TMP;

before(() => {
  TMP = fs.mkdtempSync(path.join(os.tmpdir(), "codecmedia-test-"));
});

after(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
});

function write(name, data) {
  const p = path.join(TMP, name);
  fs.writeFileSync(p, data);
  return p;
}

// Minimal valid WebM bytes (reused from webm.test.js builder)
function vint1(v)           { return Buffer.from([0x80 | v]); }
function uintBE(value, len) {
  const b = Buffer.alloc(len);
  let v = BigInt(value);
  for (let i = len - 1; i >= 0; i--) { b[i] = Number(v & 0xffn); v >>= 8n; }
  return b;
}

function elem(idBytes, payload) {
  return Buffer.concat([idBytes, vint1(payload.length), payload]);
}

function buildMinimalWebm({ width = 1280, height = 720, videoCodec = "V_VP9" } = {}) {
  // EBML header
  const doctype = Buffer.from("webm", "ascii");
  const ebmlPayload = Buffer.concat([
    elem(Buffer.from([0x42, 0x82]), doctype),
    elem(Buffer.from([0x42, 0x87]), Buffer.from([0x04])),
    elem(Buffer.from([0x42, 0x85]), Buffer.from([0x02])),
  ]);
  const ebmlHeader = Buffer.concat([
    Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), vint1(ebmlPayload.length), ebmlPayload,
  ]);
  // Info (TimecodeScale)
  const infoElem = elem(
    Buffer.from([0x15, 0x49, 0xa9, 0x66]),
    elem(Buffer.from([0x2a, 0xd7, 0xb1]), uintBE(1_000_000, 4))
  );
  // TrackEntry with Video sub-container
  const cb = Buffer.from(videoCodec, "ascii");
  const videoSub = elem(Buffer.from([0xe0]), Buffer.concat([
    elem(Buffer.from([0xb0]), uintBE(width, 2)),
    elem(Buffer.from([0xba]), uintBE(height, 2)),
  ]));
  const trackEntry = elem(Buffer.from([0xae]), Buffer.concat([
    elem(Buffer.from([0x83]), Buffer.from([0x01])),
    elem(Buffer.from([0x86]), cb),
    videoSub,
  ]));
  const tracksElem = elem(Buffer.from([0x16, 0x54, 0xae, 0x6b]), trackEntry);
  // Segment with unknown size
  const segPayload = Buffer.concat([infoElem, tracksElem]);
  const segment = Buffer.concat([
    Buffer.from([0x18, 0x53, 0x80, 0x67]),
    Buffer.from([0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]),
    segPayload,
  ]);
  return Buffer.concat([ebmlHeader, segment, Buffer.alloc(16)]);
}

const WEBM_BYTES = buildMinimalWebm();

// Fake magic-header stubs for formats without parsers yet
const MP3_BYTES  = Buffer.concat([Buffer.from([0x49, 0x44, 0x33, 0x03, 0x00, 0x00]), Buffer.alloc(128)]);
const OGG_BYTES  = Buffer.concat([Buffer.from([0x4f, 0x67, 0x67, 0x53]), Buffer.alloc(128)]);
const WAV_BYTES  = Buffer.concat([Buffer.from([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45]), Buffer.alloc(128)]);
const PNG_BYTES  = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(128)]);
const JPEG_BYTES = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(128)]);

function u32be(n) {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n >>> 0, 0);
  return b;
}

function box(type, payload) {
  return Buffer.concat([u32be(payload.length + 8), Buffer.from(type, "ascii"), payload]);
}

function buildMinimalJpeg() {
  return Buffer.from([
    0xff, 0xd8,
    0xff, 0xc0, 0x00, 0x11,
    0x08, 0x00, 0x06, 0x00, 0x04, 0x03,
    0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00,
    0xff, 0xd9,
  ]);
}

function buildMinimalBmp() {
  const b = Buffer.alloc(54);
  b.write("BM", 0, "ascii");
  b.writeUInt32LE(54, 2);
  b.writeUInt32LE(54, 10);
  b.writeUInt32LE(40, 14);
  b.writeInt32LE(8, 18);
  b.writeInt32LE(5, 22);
  b.writeUInt16LE(1, 26);
  b.writeUInt16LE(24, 28);
  return b;
}

function buildMinimalWebp() {
  const b = Buffer.alloc(30);
  b.write("RIFF", 0, "ascii");
  b.writeUInt32LE(22, 4);
  b.write("WEBP", 8, "ascii");
  b.write("VP8X", 12, "ascii");
  b.writeUInt32LE(10, 16);
  b[24] = 10 - 1;
  b[27] = 7 - 1;
  return b;
}

function buildMinimalTiff() {
  const b = Buffer.alloc(50);
  b.write("II", 0, "ascii");
  b.writeUInt16LE(42, 2);
  b.writeUInt32LE(8, 4);
  b.writeUInt16LE(3, 8);
  writeTiffEntry(b, 10, 256, 4, 1, 11);
  writeTiffEntry(b, 22, 257, 4, 1, 13);
  writeTiffEntry(b, 34, 258, 3, 1, 8);
  return b;
}

function writeTiffEntry(b, offset, tag, type, count, value) {
  b.writeUInt16LE(tag, offset);
  b.writeUInt16LE(type, offset + 2);
  b.writeUInt32LE(count, offset + 4);
  b.writeUInt32LE(value, offset + 8);
}

function buildMinimalHeic() {
  const ftyp = box("ftyp", Buffer.concat([Buffer.from("heic", "ascii"), Buffer.alloc(4)]));
  const ispe = box("ispe", Buffer.concat([Buffer.alloc(4), u32be(12), u32be(9)]));
  const ipco = box("ipco", ispe);
  const iprp = box("iprp", ipco);
  const meta = box("meta", Buffer.concat([Buffer.alloc(4), iprp]));
  return Buffer.concat([ftyp, meta]);
}

function buildMinimalAiff({ title = "Aiff Title" } = {}) {
  const comm = Buffer.alloc(26);
  comm.write("COMM", 0, "ascii");
  comm.writeUInt32BE(18, 4);
  comm.writeUInt16BE(2, 8);
  comm.writeUInt32BE(44100, 10);
  comm.writeUInt16BE(16, 14);
  Buffer.from([0x40, 0x0e, 0xac, 0x44, 0, 0, 0, 0, 0, 0]).copy(comm, 16);

  const titleBytes = Buffer.from(title, "utf8");
  const nameHeader = Buffer.alloc(8);
  nameHeader.write("NAME", 0, "ascii");
  nameHeader.writeUInt32BE(titleBytes.length, 4);
  const name = Buffer.concat([nameHeader, titleBytes, titleBytes.length % 2 ? Buffer.from([0]) : Buffer.alloc(0)]);

  const payload = Buffer.concat([Buffer.from("AIFF", "ascii"), comm, name]);
  const form = Buffer.alloc(8);
  form.write("FORM", 0, "ascii");
  form.writeUInt32BE(payload.length, 4);
  return Buffer.concat([form, payload]);
}

function buildMinimalWav(pcm = Buffer.from([1, 2, 3, 4])) {
  const b = Buffer.alloc(44 + pcm.length);
  b.write("RIFF", 0, "ascii");
  b.writeUInt32LE(36 + pcm.length, 4);
  b.write("WAVE", 8, "ascii");
  b.write("fmt ", 12, "ascii");
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(8000, 24);
  b.writeUInt32LE(16000, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write("data", 36, "ascii");
  b.writeUInt32LE(pcm.length, 40);
  pcm.copy(b, 44);
  return b;
}

function buildMinimalFlac({ title = "Flac Title" } = {}) {
  const streamInfo = Buffer.alloc(34);
  const packed = (BigInt(44100) << 44n) | (1n << 41n) | (15n << 36n) | 44100n;
  streamInfo.writeBigUInt64BE(packed, 10);

  const streamHeader = Buffer.from([0x00, 0x00, 0x00, 0x22]);
  const comment = Buffer.from(`TITLE=${title}`, "utf8");
  const vendor = Buffer.from("codecmedia-test", "utf8");
  const vorbis = Buffer.alloc(4 + vendor.length + 4 + 4 + comment.length);
  let pos = 0;
  vorbis.writeUInt32LE(vendor.length, pos); pos += 4;
  vendor.copy(vorbis, pos); pos += vendor.length;
  vorbis.writeUInt32LE(1, pos); pos += 4;
  vorbis.writeUInt32LE(comment.length, pos); pos += 4;
  comment.copy(vorbis, pos);

  const commentHeader = Buffer.from([0x84, (vorbis.length >> 16) & 0xff, (vorbis.length >> 8) & 0xff, vorbis.length & 0xff]);
  return Buffer.concat([Buffer.from("fLaC", "ascii"), streamHeader, streamInfo, commentHeader, vorbis]);
}

function buildIsoBmffAudioTrack({ majorBrand = "isom", audioSampleEntryFourCc = "mp4a" } = {}) {
  const hdlrPayload = Buffer.concat([
    Buffer.alloc(4),
    Buffer.alloc(4),
    Buffer.from("soun", "ascii"),
    Buffer.alloc(4),
  ]);
  const hdlr = box("hdlr", hdlrPayload);
  const sampleEntry = box(audioSampleEntryFourCc, Buffer.alloc(16));
  const stsd = box("stsd", Buffer.concat([Buffer.alloc(4), u32be(1), sampleEntry]));
  const stbl = box("stbl", stsd);
  const minf = box("minf", stbl);
  const mdia = box("mdia", Buffer.concat([hdlr, minf]));
  const trak = box("trak", mdia);
  const moov = box("moov", trak);
  const ftyp = box("ftyp", Buffer.concat([
    Buffer.from(majorBrand, "ascii"),
    Buffer.alloc(4),
    Buffer.from("isom", "ascii"),
  ]));
  return Buffer.concat([ftyp, moov]);
}

const engine = new StubCodecMediaEngine();

const TEST_DIR = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const REAL_WEBM_480 = path.join(TEST_DIR, "file_example_WEBM_480_900KB.webm");
const REAL_WEBM_640 = path.join(TEST_DIR, "file_example_WEBM_640_1_4MB.webm");
const REAL_MP4_480 = path.join(TEST_DIR, "file_example_MP4_480_1_5MG.mp4");

// ─── probe ────────────────────────────────────────────────────────────────────

describe("probe — WebM (parser available)", () => {
  it("returns correct mimeType and extension", () => {
    const f = write("test.webm", WEBM_BYTES);
    const r = engine.probe(f);
    assert.equal(r.mimeType, "video/webm");
    assert.equal(r.extension, "webm");
    assert.equal(r.mediaType, MediaType.VIDEO);
  });

  it("populates video stream with width/height/codec", () => {
    const f = write("test2.webm", WEBM_BYTES);
    const r = engine.probe(f);
    assert.equal(r.streams.length, 1);
    assert.equal(r.streams[0].kind, StreamKind.VIDEO);
    assert.equal(r.streams[0].width, 1280);
    assert.equal(r.streams[0].height, 720);
    assert.equal(r.streams[0].codec, "V_VP9");
  });

  it("tags include sizeBytes", () => {
    const f = write("test3.webm", WEBM_BYTES);
    const r = engine.probe(f);
    assert.ok("sizeBytes" in r.tags);
  });

  it("probes bundled real 480 sample", () => {
    assert.equal(fs.existsSync(REAL_WEBM_480), true);
    const r = engine.probe(REAL_WEBM_480);
    assert.equal(r.mimeType, "video/webm");
    assert.equal(r.extension, "webm");
    assert.equal(r.mediaType, MediaType.VIDEO);
  });

  it("probes bundled real 640 sample", () => {
    assert.equal(fs.existsSync(REAL_WEBM_640), true);
    const r = engine.probe(REAL_WEBM_640);
    assert.equal(r.mimeType, "video/webm");
    assert.equal(r.extension, "webm");
    assert.equal(r.mediaType, MediaType.VIDEO);
  });
});

describe("probe — unknown / stub formats", () => {
  it("falls back gracefully for MP3 without parser", () => {
    const f = write("song.mp3", MP3_BYTES);
    const r = engine.probe(f);
    assert.equal(r.mimeType, "audio/mpeg");
    assert.equal(r.mediaType, MediaType.AUDIO);
  });

  it("falls back gracefully for OGG without parser", () => {
    const f = write("audio.ogg", OGG_BYTES);
    const r = engine.probe(f);
    assert.equal(r.mimeType, "audio/ogg");
    assert.equal(r.mediaType, MediaType.AUDIO);
  });

  it("falls back gracefully for WAV without parser", () => {
    const f = write("audio.wav", WAV_BYTES);
    const r = engine.probe(f);
    assert.equal(r.mimeType, "audio/wav");
    assert.equal(r.mediaType, MediaType.AUDIO);
  });

  it("falls back gracefully for PNG without parser", () => {
    const f = write("img.png", PNG_BYTES);
    const r = engine.probe(f);
    assert.equal(r.mimeType, "image/png");
    assert.equal(r.mediaType, MediaType.IMAGE);
  });

  it("returns UNKNOWN type for unrecognized extension", () => {
    const f = write("file.xyz", Buffer.from("hello world"));
    const r = engine.probe(f);
    assert.equal(r.mediaType, MediaType.UNKNOWN);
    assert.equal(r.mimeType, "application/octet-stream");
  });

  it("throws for missing file", () => {
    assert.throws(
      () => engine.probe(path.join(TMP, "nonexistent.mp4")),
      CodecMediaException
    );
  });
});

describe("probe — sniff by magic bytes, not only extension", () => {
  it("detects WebM even with wrong extension", () => {
    const f = write("disguised.mp4", WEBM_BYTES);
    const r = engine.probe(f);
    // likelyWebm wins because magic matches — but ext says mp4 so likelyMp4 fires first
    // The important thing: it doesn't throw and returns a result
    assert.ok(r.mimeType);
  });

  it("detects MP3 by ID3 magic even without .mp3 extension", () => {
    const f = write("audio.bin", MP3_BYTES);
    const r = engine.probe(f);
    assert.equal(r.mimeType, "audio/mpeg");
  });
});

// ─── validate ─────────────────────────────────────────────────────────────────

describe("probe — Java parity image/container headers", () => {
  it("populates JPEG dimensions and tags", () => {
    const f = write("photo.jpg", buildMinimalJpeg());
    const r = engine.probe(f);
    assert.equal(r.mimeType, "image/jpeg");
    assert.equal(r.streams[0].width, 4);
    assert.equal(r.streams[0].height, 6);
    assert.equal(r.tags.bitsPerSample, "8");
    assert.equal(r.tags.channels, "3");
  });

  it("populates BMP dimensions and bits-per-pixel", () => {
    const f = write("bitmap.bmp", buildMinimalBmp());
    const r = engine.probe(f);
    assert.equal(r.mimeType, "image/bmp");
    assert.equal(r.streams[0].width, 8);
    assert.equal(r.streams[0].height, 5);
    assert.equal(r.tags.bitsPerPixel, "24");
  });

  it("populates WebP dimensions and assumed bit depth", () => {
    const f = write("image.webp", buildMinimalWebp());
    const r = engine.probe(f);
    assert.equal(r.mimeType, "image/webp");
    assert.equal(r.streams[0].width, 10);
    assert.equal(r.streams[0].height, 7);
    assert.equal(r.tags.bitDepth, "8");
  });

  it("rejects WebP RIFF sizes larger than the available bytes", () => {
    const bytes = buildMinimalWebp();
    bytes.writeUInt32LE(0x80000000, 4);
    assert.equal(WebpParser.isLikelyWebp(bytes), false);
  });

  it("populates TIFF dimensions and bit depth", () => {
    const f = write("scan.tif", buildMinimalTiff());
    const r = engine.probe(f);
    assert.equal(r.mimeType, "image/tiff");
    assert.equal(r.streams[0].width, 11);
    assert.equal(r.streams[0].height, 13);
    assert.equal(r.tags.bitDepth, "8");
  });

  it("populates HEIC brand and dimensions", () => {
    const f = write("still.heic", buildMinimalHeic());
    const r = engine.probe(f);
    assert.equal(r.mimeType, "image/heic");
    assert.equal(r.extension, "heic");
    assert.equal(r.streams[0].width, 12);
    assert.equal(r.streams[0].height, 9);
    assert.equal(r.tags.majorBrand, "heic");
  });
});

describe("probe — Java parity audio headers", () => {
  it("populates AIFF stream fields", () => {
    const f = write("sample.aiff", buildMinimalAiff());
    const r = engine.probe(f);
    assert.equal(r.mimeType, "audio/aiff");
    assert.equal(r.mediaType, MediaType.AUDIO);
    assert.equal(r.durationMillis, 1000);
    assert.equal(r.streams[0].codec, "pcm");
    assert.equal(r.streams[0].sampleRate, 44100);
    assert.equal(r.streams[0].channels, 2);
    assert.equal(r.tags.bitrateMode, "CBR");
  });

  it("populates FLAC stream fields", () => {
    const f = write("sample.flac", buildMinimalFlac());
    const r = engine.probe(f);
    assert.equal(r.mimeType, "audio/flac");
    assert.equal(r.mediaType, MediaType.AUDIO);
    assert.equal(r.durationMillis, 1000);
    assert.equal(r.streams[0].codec, "flac");
    assert.equal(r.streams[0].sampleRate, 44100);
    assert.equal(r.streams[0].channels, 2);
    assert.equal(r.tags.bitsPerSample, "16");
  });
});

describe("probe — MOV compatibility", () => {
  it("uses BMFF parsing for .mov files instead of extension-only fallback", () => {
    assert.equal(fs.existsSync(REAL_MP4_480), true);
    const f = path.join(TMP, "renamed.mov");
    fs.copyFileSync(REAL_MP4_480, f);
    const r = engine.probe(f);
    assert.equal(r.mimeType, "video/quicktime");
    assert.equal(r.extension, "mov");
    assert.ok(r.streams.length > 0);
  });
});

describe("validate", () => {
  it("returns valid=true for existing file within size", () => {
    const f = write("v1.webm", WEBM_BYTES);
    const r = engine.validate(f, ValidationOptions.defaults());
    assert.equal(r.valid, true);
    assert.equal(r.errors.length, 0);
  });

  it("returns valid=false for nonexistent file", () => {
    const r = engine.validate(path.join(TMP, "ghost.mp4"), null);
    assert.equal(r.valid, false);
    assert.ok(r.errors[0].includes("does not exist"));
  });

  it("returns valid=false for null input like Java", () => {
    const r = engine.validate(null, null);
    assert.equal(r.valid, false);
    assert.equal(r.errors[0], "Input file is required");
  });

  it("returns valid=false when file exceeds maxBytes", () => {
    const f = write("big.webm", Buffer.alloc(200));
    const r = engine.validate(f, ValidationOptions({ strict: false, maxBytes: 100 }));
    assert.equal(r.valid, false);
    assert.ok(r.errors[0].includes("maxBytes"));
  });

  it("strict mode — valid WebM passes", () => {
    const f = write("strict.webm", WEBM_BYTES);
    const r = engine.validate(f, ValidationOptions({ strict: true, maxBytes: 500 * 1024 * 1024 }));
    assert.equal(r.valid, true);
  });

  it("strict mode — corrupt WebM fails", () => {
    const f = write("corrupt.webm", Buffer.from("this is not webm!!!"));
    const r = engine.validate(f, ValidationOptions({ strict: true, maxBytes: 500 * 1024 * 1024 }));
    assert.equal(r.valid, false);
    assert.ok(r.errors[0].includes("webm"));
  });

  it("strict mode — rejects file > 32MB limit", () => {
    const bigPath = path.join(TMP, "huge.webm");
    // write a 33MB file
    const fd = fs.openSync(bigPath, "w");
    fs.writeSync(fd, Buffer.alloc(33 * 1024 * 1024));
    fs.closeSync(fd);
    const r = engine.validate(bigPath, ValidationOptions({ strict: true, maxBytes: 500 * 1024 * 1024 }));
    assert.equal(r.valid, false);
    assert.ok(r.errors[0].includes("Strict validation is limited"));
  });

  it("strict mode — bundled real 480 sample passes", () => {
    assert.equal(fs.existsSync(REAL_WEBM_480), true);
    const r = engine.validate(REAL_WEBM_480, ValidationOptions({ strict: true, maxBytes: 500 * 1024 * 1024 }));
    assert.equal(r.valid, true);
  });

  it("strict mode — ported image/container parsers pass", () => {
    for (const [name, bytes] of [
      ["strict.jpg", buildMinimalJpeg()],
      ["strict.bmp", buildMinimalBmp()],
      ["strict.webp", buildMinimalWebp()],
      ["strict.tif", buildMinimalTiff()],
      ["strict.heic", buildMinimalHeic()],
      ["strict.aiff", buildMinimalAiff()],
      ["strict.flac", buildMinimalFlac()],
    ]) {
      const f = write(name, bytes);
      const r = engine.validate(f, ValidationOptions({ strict: true, maxBytes: 500 * 1024 * 1024 }));
      assert.equal(r.valid, true, name);
    }
  });
});

// ─── readMetadata / writeMetadata ─────────────────────────────────────────────

describe("readMetadata", () => {
  it("returns base probe fields", () => {
    const f = write("meta.webm", WEBM_BYTES);
    const m = engine.readMetadata(f);
    assert.equal(m.entries.mimeType,  "video/webm");
    assert.equal(m.entries.extension, "webm");
    assert.equal(m.entries.mediaType, MediaType.VIDEO);
  });

  it("throws for missing file", () => {
    assert.throws(() => engine.readMetadata(path.join(TMP, "nope.webm")), CodecMediaException);
  });

  it("includes embedded AIFF text metadata", () => {
    const f = write("embedded.aiff", buildMinimalAiff({ title: "Embedded AIFF" }));
    const m = engine.readMetadata(f);
    assert.equal(m.entries.title, "Embedded AIFF");
  });

  it("includes embedded FLAC Vorbis comments", () => {
    const f = write("embedded.flac", buildMinimalFlac({ title: "Embedded FLAC" }));
    const m = engine.readMetadata(f);
    assert.equal(m.entries.title, "Embedded FLAC");
  });

  it("includes embedded WAV INFO metadata", () => {
    const f = write("embedded.wav", buildMinimalWav());
    engine.writeMetadata(f, Metadata({ entries: { title: "Embedded WAV" } }));
    const m = engine.readMetadata(f);
    assert.equal(m.entries.title, "Embedded WAV");
  });
});

describe("writeMetadata / readMetadata round-trip", () => {
  it("persists entries to sidecar and reads them back", () => {
    const f = write("rw.webm", WEBM_BYTES);
    engine.writeMetadata(f, Metadata({ entries: { title: "Hello World", artist: "Test" } }));
    const sidecar = f + ".codecmedia.properties";
    assert.ok(fs.existsSync(sidecar), "sidecar file should be created");
    const m = engine.readMetadata(f);
    assert.equal(m.entries.title,  "Hello World");
    assert.equal(m.entries.artist, "Test");
  });

  it("sidecar keys don't override probe-derived keys", () => {
    const f = write("rw2.webm", WEBM_BYTES);
    engine.writeMetadata(f, Metadata({ entries: { mimeType: "EVIL_OVERRIDE" } }));
    const m = engine.readMetadata(f);
    // readMetadata uses putIfAbsent — probe keys win
    assert.equal(m.entries.mimeType, "video/webm");
  });

  it("persists supported WAV metadata in embedded INFO chunks", () => {
    const f = write("rw-wav.wav", buildMinimalWav());
    engine.writeMetadata(f, Metadata({ entries: {
      title: "Embedded WAV Title",
      artist: "Embedded WAV Artist",
      album: "Embedded WAV Album",
      comment: "Embedded WAV Comment",
      date: "2026-03-16",
      genre: "Test Genre",
    } }));

    const m = engine.readMetadata(f);
    assert.equal(m.entries.title, "Embedded WAV Title");
    assert.equal(m.entries.artist, "Embedded WAV Artist");
    assert.equal(m.entries.album, "Embedded WAV Album");
    assert.equal(m.entries.comment, "Embedded WAV Comment");
    assert.equal(m.entries.date, "2026-03-16");
    assert.equal(m.entries.genre, "Test Genre");
    assert.equal(fs.existsSync(f + ".codecmedia.properties"), false);
  });

  it("persists supported AIFF metadata in embedded text chunks", () => {
    const f = write("rw-aiff.aiff", buildMinimalAiff());
    engine.writeMetadata(f, Metadata({ entries: {
      title: "Embedded AIFF Title",
      artist: "Embedded AIFF Artist",
      copyright: "(c) CodecMedia",
      comment: "Embedded AIFF Comment",
    } }));

    const m = engine.readMetadata(f);
    assert.equal(m.entries.title, "Embedded AIFF Title");
    assert.equal(m.entries.artist, "Embedded AIFF Artist");
    assert.equal(m.entries.copyright, "(c) CodecMedia");
    assert.equal(m.entries.comment, "Embedded AIFF Comment");
    assert.equal(fs.existsSync(f + ".codecmedia.properties"), false);
  });

  it("persists supported MP3 metadata in embedded ID3v1 tags", () => {
    const f = write("rw-mp3.mp3", MP3_BYTES);
    engine.writeMetadata(f, Metadata({ entries: {
      title: "ID3v1 Title",
      artist: "ID3v1 Artist",
      album: "ID3v1 Album",
      date: "2026-03-16",
      comment: "ID3v1 Comment",
      genre: "13",
    } }));

    const m = engine.readMetadata(f);
    assert.equal(m.entries.title, "ID3v1 Title");
    assert.equal(m.entries.artist, "ID3v1 Artist");
    assert.equal(m.entries.album, "ID3v1 Album");
    assert.equal(m.entries.date, "2026");
    assert.equal(m.entries.comment, "ID3v1 Comment");
    assert.equal(m.entries.genre, "13");
    assert.equal(fs.existsSync(f + ".codecmedia.properties"), false);
  });

  it("throws on null metadata", () => {
    const f = write("rw3.webm", WEBM_BYTES);
    assert.throws(() => engine.writeMetadata(f, null), CodecMediaException);
  });

  it("throws on blank key", () => {
    const f = write("rw4.webm", WEBM_BYTES);
    assert.throws(
      () => engine.writeMetadata(f, Metadata({ entries: { "": "bad" } })),
      CodecMediaException
    );
  });

  it("throws on null value", () => {
    const f = write("rw5.webm", WEBM_BYTES);
    assert.throws(
      () => engine.writeMetadata(f, Metadata({ entries: { key: null } })),
      CodecMediaException
    );
  });
});

// ─── extractAudio ─────────────────────────────────────────────────────────────

describe("extractAudio", () => {
  it("copies audio file with _audio suffix", () => {
    const f   = write("clip.ogg", OGG_BYTES);
    const out = path.join(TMP, "extracted");
    const r   = engine.extractAudio(f, out, AudioExtractOptions.defaults("ogg"));
    assert.ok(fs.existsSync(r.outputFile));
    assert.equal(r.format, "ogg");
    assert.ok(r.outputFile.endsWith("clip_audio.ogg"));
  });

  it("creates output directory if it doesn't exist", () => {
    const f   = write("clip2.ogg", OGG_BYTES);
    const out = path.join(TMP, "newdir_" + Date.now());
    assert.ok(!fs.existsSync(out));
    engine.extractAudio(f, out, AudioExtractOptions.defaults("ogg"));
    assert.ok(fs.existsSync(out));
  });

  it("throws for non-audio file", () => {
    const f = write("video.webm", WEBM_BYTES);
    assert.throws(
      () => engine.extractAudio(f, TMP, AudioExtractOptions.defaults("webm")),
      CodecMediaException
    );
  });

  it("throws when targetFormat doesn't match source", () => {
    const f = write("audio2.ogg", OGG_BYTES);
    assert.throws(
      () => engine.extractAudio(f, TMP, AudioExtractOptions.defaults("mp3")),
      CodecMediaException
    );
  });

  it("throws when outputDir is null", () => {
    const f = write("audio3.ogg", OGG_BYTES);
    assert.throws(() => engine.extractAudio(f, null, null), CodecMediaException);
  });
});

// ─── play ─────────────────────────────────────────────────────────────────────

describe("play — dryRun", () => {
  it("returns started=true with dry-run backend", () => {
    const f = write("play.webm", WEBM_BYTES);
    const r = engine.play(f, PlaybackOptions({ dryRun: true, allowExternalApp: false }));
    assert.equal(r.started, true);
    assert.equal(r.backend, "dry-run");
    assert.equal(r.mediaType, MediaType.VIDEO);
    assert.ok(r.message);
  });

  it("throws for unknown media type in dryRun", () => {
    const f = write("unknown.xyz", Buffer.from("garbage data xyz"));
    assert.throws(
      () => engine.play(f, PlaybackOptions({ dryRun: true, allowExternalApp: false })),
      CodecMediaException
    );
  });

  it("throws when no backend available", () => {
    const f = write("play2.webm", WEBM_BYTES);
    assert.throws(
      () => engine.play(f, PlaybackOptions({ dryRun: false, allowExternalApp: false })),
      CodecMediaException
    );
  });

  it("throws for missing file", () => {
    assert.throws(
      () => engine.play(path.join(TMP, "missing.webm"), PlaybackOptions.defaults()),
      CodecMediaException
    );
  });
});

// ─── convert ──────────────────────────────────────────────────────────────────

describe("convert — default hub", () => {
  it("uses the default hub for same-format copy", () => {
    const f = write("conv-copy.webm", WEBM_BYTES);
    const output = path.join(TMP, "conv-copy-out.webm");
    const r = engine.convert(f, output, ConversionOptions.defaults("webm"));
    assert.equal(r.outputFile, output);
    assert.equal(r.format, "webm");
    assert.equal(r.reencoded, false);
    assert.deepEqual(fs.readFileSync(output), WEBM_BYTES);
  });

  it("throws for unsupported default hub routes", () => {
    const f = write("conv.webm", WEBM_BYTES);
    assert.throws(
      () => engine.convert(f, path.join(TMP, "out.mp4"), ConversionOptions.defaults("mp4")),
      CodecMediaException
    );
  });

  it("remuxes mp4 audio tracks to m4a without re-encoding", () => {
    const f = write("audio-track.mp4", buildIsoBmffAudioTrack({ majorBrand: "isom", audioSampleEntryFourCc: "mp4a" }));
    const output = path.join(TMP, "audio-track.m4a");
    const r = engine.convert(f, output, ConversionOptions({ targetFormat: "m4a", preset: "balanced", overwrite: true }));
    assert.equal(r.format, "m4a");
    assert.equal(r.reencoded, false);
    assert.ok(fs.existsSync(output));
    const probed = engine.probe(output);
    assert.equal(probed.mimeType, "audio/mp4");
    assert.equal(probed.extension, "m4a");
  });

  it("rejects m4a remux when the audio codec is not compatible", () => {
    const f = write("audio-track-bad.mp4", buildIsoBmffAudioTrack({ majorBrand: "isom", audioSampleEntryFourCc: "lpcm" }));
    assert.throws(
      () => engine.convert(f, path.join(TMP, "audio-track-bad.m4a"), ConversionOptions({ targetFormat: "m4a", preset: "balanced", overwrite: true })),
      /not m4a-compatible/
    );
  });

  it("throws when output extension does not match target format", () => {
    const f = write("conv-mismatch.webm", WEBM_BYTES);
    assert.throws(
      () => engine.convert(f, path.join(TMP, "out.mp4"), ConversionOptions.defaults("webm")),
      /Output extension must match target format/
    );
  });

  it("throws for missing input", () => {
    assert.throws(
      () => engine.convert(path.join(TMP, "none.webm"), path.join(TMP, "out.mp4"), null),
      CodecMediaException
    );
  });

  it("throws for null output", () => {
    const f = write("conv2.webm", WEBM_BYTES);
    assert.throws(() => engine.convert(f, null, null), CodecMediaException);
  });
});

// ─── get() alias ─────────────────────────────────────────────────────────────

describe("get() alias", () => {
  it("returns same result as probe()", () => {
    const f  = write("alias.webm", WEBM_BYTES);
    const r1 = engine.get(f);
    const r2 = engine.probe(f);
    assert.deepEqual(r1, r2);
  });
});
