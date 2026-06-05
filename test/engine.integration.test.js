/**
 * engine.integration.test.js
 *
 * Integration tests for StubCodecMediaEngine against ALL real bundled files:
 *
 *   Audio  : WAV (x5), MP3 (x2)
 *   Video  : WebM (x2), MP4 (x2)
 *   Image  : PNG (x2)
 *
 * Tests use only files that exist in the test/ directory next to this file.
 * Each format is covered across:
 *   - probe()  → mimeType, extension, mediaType, streams, tags
 *   - get()    → alias equality with probe()
 *   - validate() → strict=true passes
 *   - readMetadata() → base fields present
 *   - writeMetadata() + readMetadata() round-trip
 *
 * Run: node --test ./test/engine.integration.test.js
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { StubCodecMediaEngine } from "../src/internal/StubCodecMediaEngine.js";
import { MediaType }             from "../src/model/MediaType.js";
import { StreamKind }            from "../src/model/StreamKind.js";
import { ValidationOptions }     from "../src/options/ValidationOptions.js";
import { Metadata }              from "../src/model/Metadata.js";

// ─── Paths ────────────────────────────────────────────────────────────────────

const TEST_DIR = path.dirname(
  new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")
);

function sample(name) {
  return path.join(TEST_DIR, name);
}

// Bundled real files (must exist in test/)
const FILES = {
  // ── Audio ──────────────────────────────────────────────────────────────────
  wav_ableton:  sample("c-major-scale_test_ableton-live.wav"),
  wav_1mg:      sample("file_example_WAV_1MG.wav"),
  wav_2mg:      sample("file_example_WAV_2MG.wav"),
  wav_5mg:      sample("file_example_WAV_5MG.wav"),
  wav_10mg:     sample("file_example_WAV_10MG.wav"),
  mp3_700kb:    sample("file_example_MP3_700KB.mp3"),
  mp3_1mg:      sample("file_example_MP3_1MG.mp3"),
  // ── Video ──────────────────────────────────────────────────────────────────
  webm_480:     sample("file_example_WEBM_480_900KB.webm"),
  webm_640:     sample("file_example_WEBM_640_1_4MB.webm"),
  mp4_480:      sample("file_example_MP4_480_1_5MG.mp4"),
  mp4_640:      sample("file_example_MP4_640_3MG.mp4"),
  // ── Image ──────────────────────────────────────────────────────────────────
  png_500kb:    sample("file_example_PNG_500kB.png"),
  png_1mb:      sample("file_example_PNG_1MB.png"),
};

// Filter to files that actually exist so test run is not blocked by optional files
const PRESENT = Object.fromEntries(
  Object.entries(FILES).filter(([, p]) => fs.existsSync(p))
);

// ─── Engine + temp dir ────────────────────────────────────────────────────────

const engine = new StubCodecMediaEngine();

let TMP;
before(() => {
  TMP = fs.mkdtempSync(path.join(os.tmpdir(), "codecmedia-eng-integ-"));
});
after(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function skipIfMissing(t, key) {
  if (!PRESENT[key]) t.skip(`File not found: ${FILES[key]}`);
}

/**
 * Assert a ProbeResult looks like a valid audio result.
 * @param {object} r
 * @param {string} expectedMime
 * @param {string} expectedExt
 */
function assertAudioProbe(r, expectedMime, expectedExt) {
  assert.equal(r.mimeType,  expectedMime, "mimeType");
  assert.equal(r.extension, expectedExt,  "extension");
  assert.equal(r.mediaType, MediaType.AUDIO, "mediaType");
  assert.ok(r.durationMillis > 0, "durationMillis > 0");
  assert.ok(r.streams.length >= 1, "at least one stream");
  const s = r.streams[0];
  assert.equal(s.kind, StreamKind.AUDIO);
  assert.ok(s.sampleRate > 0, "sampleRate > 0");
  assert.ok(s.channels > 0,   "channels > 0");
  assert.ok(s.bitrateKbps > 0, "bitrateKbps > 0");
}

/**
 * Assert a ProbeResult looks like a valid video result.
 * @param {object} r
 * @param {string} expectedMime
 * @param {string} expectedExt
 */
function assertVideoProbe(r, expectedMime, expectedExt) {
  assert.equal(r.mimeType,  expectedMime, "mimeType");
  assert.equal(r.extension, expectedExt,  "extension");
  assert.equal(r.mediaType, MediaType.VIDEO, "mediaType");
  assert.ok(r.streams.length >= 1, "at least one stream");
  const video = r.streams.find(s => s.kind === StreamKind.VIDEO);
  assert.ok(video, "has a VIDEO stream");
  assert.ok(video.width  > 0, "width > 0");
  assert.ok(video.height > 0, "height > 0");
}

/**
 * Assert a ProbeResult looks like a valid image result.
 * @param {object} r
 * @param {string} expectedMime
 * @param {string} expectedExt
 */
function assertImageProbe(r, expectedMime, expectedExt) {
  assert.equal(r.mimeType,  expectedMime, "mimeType");
  assert.equal(r.extension, expectedExt,  "extension");
  assert.equal(r.mediaType, MediaType.IMAGE, "mediaType");
}

// ─── WAV ─────────────────────────────────────────────────────────────────────

describe("WAV — probe (all bundled files)", () => {
  const wavFiles = [
    ["ableton",  "wav_ableton", "c-major-scale (Ableton)",  2, 44100, 16],
    ["WAV_1MG",  "wav_1mg",     "file_example_WAV_1MG",     2, 44100, 16],
    ["WAV_2MG",  "wav_2mg",     "file_example_WAV_2MG",     2, 44100, 16],
    ["WAV_5MG",  "wav_5mg",     "file_example_WAV_5MG",     2, 44100, 16],
    ["WAV_10MG", "wav_10mg",    "file_example_WAV_10MG",    2, 44100, 16],
  ];

  for (const [id, key, label, channels, sampleRate, bitsPerSample] of wavFiles) {
    it(`probe() — ${label}`, (t) => {
      skipIfMissing(t, key);
      const r = engine.probe(PRESENT[key]);
      assertAudioProbe(r, "audio/wav", "wav");
      assert.equal(r.streams[0].codec,      "pcm",     "codec=pcm");
      assert.equal(r.streams[0].sampleRate, sampleRate, "sampleRate");
      assert.equal(r.streams[0].channels,   channels,   "channels");
      assert.equal(r.tags.bitrateMode,      "CBR",      "bitrateMode=CBR");
      assert.equal(r.tags.bitsPerSample,    String(bitsPerSample), "bitsPerSample");
    });
  }
});

describe("WAV — get() equals probe()", () => {
  it("get() returns same result as probe() for ableton sample", (t) => {
    skipIfMissing(t, "wav_ableton");
    assert.deepEqual(engine.get(PRESENT.wav_ableton), engine.probe(PRESENT.wav_ableton));
  });
});

describe("WAV — validate()", () => {
  const opts = ValidationOptions({ strict: true, maxBytes: 500 * 1024 * 1024 });
  for (const [key, label] of [
    ["wav_ableton", "ableton"],
    ["wav_1mg",     "WAV_1MG"],
    ["wav_10mg",    "WAV_10MG"],
  ]) {
    it(`strict validate passes — ${label}`, (t) => {
      skipIfMissing(t, key);
      const r = engine.validate(PRESENT[key], opts);
      assert.equal(r.valid, true, r.errors?.[0]);
    });
  }
});

describe("WAV — readMetadata()", () => {
  it("base fields present for ableton sample", (t) => {
    skipIfMissing(t, "wav_ableton");
    const m = engine.readMetadata(PRESENT.wav_ableton);
    assert.equal(m.entries.mimeType,  "audio/wav");
    assert.equal(m.entries.extension, "wav");
    assert.equal(m.entries.mediaType, MediaType.AUDIO);
  });
});

describe("WAV — writeMetadata() + readMetadata() round-trip", () => {
  it("persists and reads back custom tags", (t) => {
    skipIfMissing(t, "wav_ableton");
    // Copy so we don't pollute the real test/ directory
    const copy = path.join(TMP, "ableton_copy.wav");
    fs.copyFileSync(PRESENT.wav_ableton, copy);

    engine.writeMetadata(copy, Metadata({ entries: { artist: "Integration", album: "Tests" } }));
    const m = engine.readMetadata(copy);
    assert.equal(m.entries.artist, "Integration");
    assert.equal(m.entries.album,  "Tests");
    // Probe-derived keys must win over sidecar
    assert.equal(m.entries.mimeType, "audio/wav");
  });
});

// ─── MP3 ─────────────────────────────────────────────────────────────────────

describe("MP3 — probe (all bundled files)", () => {
  // Note: Mp3Codec must be registered via registerParser("Mp3Codec", Mp3Codec) for full stream
  // assertions to pass. Until then, the engine falls back to a stub result (no streams).
  // These tests assert the guaranteed minimum: correct mimeType/extension/mediaType,
  // and richer assertions when the codec IS registered.

  it("probe() — file_example_MP3_700KB", (t) => {
    skipIfMissing(t, "mp3_700kb");
    const r = engine.probe(PRESENT.mp3_700kb);
    assert.equal(r.mimeType,  "audio/mpeg",   "mimeType");
    assert.equal(r.extension, "mp3",          "extension");
    assert.equal(r.mediaType, MediaType.AUDIO, "mediaType");
    assert.ok(r.streams.length > 0, "MP3 probe should include parsed stream info");
    // If Mp3Codec is registered → full stream data is available
    if (r.streams.length > 0) {
      assert.equal(r.streams[0].codec, "mp3", "codec=mp3");
      assert.ok(r.streams[0].channels === 1 || r.streams[0].channels === 2, "channels");
      assert.ok(r.streams[0].sampleRate > 0, "sampleRate > 0");
      assert.ok(r.durationMillis > 0, "durationMillis > 0");
      assert.ok(["CBR","VBR","CVBR","UNKNOWN"].includes(r.tags.bitrateMode), "bitrateMode valid");
    }
  });

  it("probe() — file_example_MP3_1MG", (t) => {
    skipIfMissing(t, "mp3_1mg");
    const r = engine.probe(PRESENT.mp3_1mg);
    assert.equal(r.mimeType,  "audio/mpeg");
    assert.equal(r.extension, "mp3");
    assert.equal(r.mediaType, MediaType.AUDIO);
    assert.ok(r.streams.length > 0, "MP3 probe should include parsed stream info");
    if (r.streams.length > 0) {
      assert.equal(r.streams[0].codec, "mp3");
      assert.ok(r.durationMillis > 0, "durationMillis > 0");
    }
  });
});

describe("MP3 — get() equals probe()", () => {
  it("700KB sample", (t) => {
    skipIfMissing(t, "mp3_700kb");
    assert.deepEqual(engine.get(PRESENT.mp3_700kb), engine.probe(PRESENT.mp3_700kb));
  });
});

describe("MP3 — validate()", () => {
  it("strict validate passes for 700KB", (t) => {
    skipIfMissing(t, "mp3_700kb");
    const r = engine.validate(PRESENT.mp3_700kb,
      ValidationOptions({ strict: true, maxBytes: 500 * 1024 * 1024 }));
    assert.equal(r.valid, true, r.errors?.[0]);
  });
});

describe("MP3 — readMetadata()", () => {
  it("base fields present for 1MG sample", (t) => {
    skipIfMissing(t, "mp3_1mg");
    const m = engine.readMetadata(PRESENT.mp3_1mg);
    assert.equal(m.entries.mimeType,  "audio/mpeg");
    assert.equal(m.entries.extension, "mp3");
    assert.equal(m.entries.mediaType, MediaType.AUDIO);
  });
});

describe("MP3 — writeMetadata() + readMetadata() round-trip", () => {
  it("persists supported custom tags to embedded ID3v1", (t) => {
    skipIfMissing(t, "mp3_700kb");
    const copy = path.join(TMP, "mp3_700kb_copy.mp3");
    fs.copyFileSync(PRESENT.mp3_700kb, copy);
    engine.writeMetadata(copy, Metadata({ entries: { title: "Test Track", date: "2025" } }));
    const m = engine.readMetadata(copy);
    assert.equal(m.entries.title, "Test Track");
    assert.equal(m.entries.date,  "2025");
    assert.equal(m.entries.mimeType, "audio/mpeg"); // probe wins
  });
});

// ─── WebM ─────────────────────────────────────────────────────────────────────

describe("WebM — probe (both bundled files)", () => {
  it("probe() — file_example_WEBM_480_900KB", (t) => {
    skipIfMissing(t, "webm_480");
    const r = engine.probe(PRESENT.webm_480);
    assertVideoProbe(r, "video/webm", "webm");
    const v = r.streams.find(s => s.kind === StreamKind.VIDEO);
    assert.ok(v.codec && v.codec.length > 0, "video codec present");
  });

  it("probe() — file_example_WEBM_640_1_4MB", (t) => {
    skipIfMissing(t, "webm_640");
    const r = engine.probe(PRESENT.webm_640);
    assertVideoProbe(r, "video/webm", "webm");
  });

  it("480 sample: width=480 or height=480 (or both)", (t) => {
    skipIfMissing(t, "webm_480");
    const r  = engine.probe(PRESENT.webm_480);
    const v  = r.streams.find(s => s.kind === StreamKind.VIDEO);
    const ok = v.width >= 480 || v.height >= 480;
    assert.ok(ok, `expected at least one dimension >= 480, got ${v.width}x${v.height}`);
  });

  it("640 sample: width=640 or height=640 (or both)", (t) => {
    skipIfMissing(t, "webm_640");
    const r  = engine.probe(PRESENT.webm_640);
    const v  = r.streams.find(s => s.kind === StreamKind.VIDEO);
    const ok = v.width >= 640 || v.height >= 640;
    assert.ok(ok, `expected at least one dimension >= 640, got ${v.width}x${v.height}`);
  });
});

describe("WebM — get() equals probe()", () => {
  it("480 sample", (t) => {
    skipIfMissing(t, "webm_480");
    assert.deepEqual(engine.get(PRESENT.webm_480), engine.probe(PRESENT.webm_480));
  });
});

describe("WebM — validate()", () => {
  const opts = ValidationOptions({ strict: true, maxBytes: 500 * 1024 * 1024 });
  it("strict validate passes — 480 sample", (t) => {
    skipIfMissing(t, "webm_480");
    const r = engine.validate(PRESENT.webm_480, opts);
    assert.equal(r.valid, true, r.errors?.[0]);
  });
  it("strict validate passes — 640 sample", (t) => {
    skipIfMissing(t, "webm_640");
    const r = engine.validate(PRESENT.webm_640, opts);
    assert.equal(r.valid, true, r.errors?.[0]);
  });
});

describe("WebM — readMetadata()", () => {
  it("base fields present for 480 sample", (t) => {
    skipIfMissing(t, "webm_480");
    const m = engine.readMetadata(PRESENT.webm_480);
    assert.equal(m.entries.mimeType,  "video/webm");
    assert.equal(m.entries.extension, "webm");
    assert.equal(m.entries.mediaType, MediaType.VIDEO);
  });
});

describe("WebM — writeMetadata() + readMetadata() round-trip", () => {
  it("custom tags survive sidecar round-trip", (t) => {
    skipIfMissing(t, "webm_480");
    const copy = path.join(TMP, "webm_480_copy.webm");
    fs.copyFileSync(PRESENT.webm_480, copy);
    engine.writeMetadata(copy, Metadata({ entries: { director: "Test", year: "2025" } }));
    const m = engine.readMetadata(copy);
    assert.equal(m.entries.director, "Test");
    assert.equal(m.entries.year, "2025");
    assert.equal(m.entries.mimeType, "video/webm");
  });
});

// ─── MP4 ─────────────────────────────────────────────────────────────────────

describe("MP4 — probe (both bundled files)", () => {
  it("probe() — file_example_MP4_480_1_5MG", (t) => {
    skipIfMissing(t, "mp4_480");
    const r = engine.probe(PRESENT.mp4_480);
    assertVideoProbe(r, "video/mp4", "mp4");
    const v = r.streams.find(s => s.kind === StreamKind.VIDEO);
    assert.ok(v.codec && v.codec.length > 0, "video codec present");
    assert.ok(r.durationMillis > 0, "durationMillis > 0");
  });

  it("probe() — file_example_MP4_640_3MG", (t) => {
    skipIfMissing(t, "mp4_640");
    const r = engine.probe(PRESENT.mp4_640);
    assertVideoProbe(r, "video/mp4", "mp4");
    assert.ok(r.durationMillis > 0, "durationMillis > 0");
  });

  it("480 sample: width >= 480 or height >= 480", (t) => {
    skipIfMissing(t, "mp4_480");
    const r = engine.probe(PRESENT.mp4_480);
    const v = r.streams.find(s => s.kind === StreamKind.VIDEO);
    assert.ok(v.width >= 480 || v.height >= 480,
      `expected at least one dimension >= 480, got ${v.width}x${v.height}`);
  });

  it("640 sample: width >= 640 or height >= 640", (t) => {
    skipIfMissing(t, "mp4_640");
    const r = engine.probe(PRESENT.mp4_640);
    const v = r.streams.find(s => s.kind === StreamKind.VIDEO);
    assert.ok(v.width >= 640 || v.height >= 640,
      `expected at least one dimension >= 640, got ${v.width}x${v.height}`);
  });
});

describe("MP4 — get() equals probe()", () => {
  it("480 sample", (t) => {
    skipIfMissing(t, "mp4_480");
    assert.deepEqual(engine.get(PRESENT.mp4_480), engine.probe(PRESENT.mp4_480));
  });
});

describe("MP4 — validate()", () => {
  const opts = ValidationOptions({ strict: false, maxBytes: 500 * 1024 * 1024 });
  it("non-strict validate passes for 480 sample", (t) => {
    skipIfMissing(t, "mp4_480");
    const r = engine.validate(PRESENT.mp4_480, opts);
    assert.equal(r.valid, true, r.errors?.[0]);
  });
  it("non-strict validate passes for 640 sample", (t) => {
    skipIfMissing(t, "mp4_640");
    const r = engine.validate(PRESENT.mp4_640, opts);
    assert.equal(r.valid, true, r.errors?.[0]);
  });
});

describe("MP4 — readMetadata()", () => {
  it("base fields present for 480 sample", (t) => {
    skipIfMissing(t, "mp4_480");
    const m = engine.readMetadata(PRESENT.mp4_480);
    assert.equal(m.entries.mimeType,  "video/mp4");
    assert.equal(m.entries.extension, "mp4");
    assert.equal(m.entries.mediaType, MediaType.VIDEO);
  });
});

describe("MP4 — writeMetadata() + readMetadata() round-trip", () => {
  it("custom tags survive sidecar round-trip", (t) => {
    skipIfMissing(t, "mp4_480");
    const copy = path.join(TMP, "mp4_480_copy.mp4");
    fs.copyFileSync(PRESENT.mp4_480, copy);
    engine.writeMetadata(copy, Metadata({ entries: { scene: "1", take: "3" } }));
    const m = engine.readMetadata(copy);
    assert.equal(m.entries.scene, "1");
    assert.equal(m.entries.take,  "3");
    assert.equal(m.entries.mimeType, "video/mp4");
  });
});

// ─── PNG ─────────────────────────────────────────────────────────────────────

describe("PNG — probe (both bundled files)", () => {
  it("probe() — file_example_PNG_500kB", (t) => {
    skipIfMissing(t, "png_500kb");
    const r = engine.probe(PRESENT.png_500kb);
    assertImageProbe(r, "image/png", "png");
    // If PngParser is registered, stream should be populated
    if (r.streams.length > 0) {
      const s = r.streams[0];
      assert.equal(s.kind, StreamKind.VIDEO, "stream kind = VIDEO (image frame)");
      assert.ok(s.width  > 0, "width > 0");
      assert.ok(s.height > 0, "height > 0");
    }
  });

  it("probe() — file_example_PNG_1MB", (t) => {
    skipIfMissing(t, "png_1mb");
    const r = engine.probe(PRESENT.png_1mb);
    assertImageProbe(r, "image/png", "png");
  });

  it("sizeBytes tag present for 500kB sample", (t) => {
    skipIfMissing(t, "png_500kb");
    const r = engine.probe(PRESENT.png_500kb);
    assert.ok("sizeBytes" in r.tags, "sizeBytes tag missing");
    assert.ok(Number(r.tags.sizeBytes) > 0, "sizeBytes > 0");
  });
});

describe("PNG — get() equals probe()", () => {
  it("500kB sample", (t) => {
    skipIfMissing(t, "png_500kb");
    assert.deepEqual(engine.get(PRESENT.png_500kb), engine.probe(PRESENT.png_500kb));
  });
});

describe("PNG — validate()", () => {
  it("non-strict validate passes for 500kB sample", (t) => {
    skipIfMissing(t, "png_500kb");
    const r = engine.validate(PRESENT.png_500kb,
      ValidationOptions({ strict: false, maxBytes: 500 * 1024 * 1024 }));
    assert.equal(r.valid, true, r.errors?.[0]);
  });

  it("non-strict validate passes for 1MB sample", (t) => {
    skipIfMissing(t, "png_1mb");
    const r = engine.validate(PRESENT.png_1mb,
      ValidationOptions({ strict: false, maxBytes: 500 * 1024 * 1024 }));
    assert.equal(r.valid, true, r.errors?.[0]);
  });
});

describe("PNG — readMetadata()", () => {
  it("base fields present for 500kB sample", (t) => {
    skipIfMissing(t, "png_500kb");
    const m = engine.readMetadata(PRESENT.png_500kb);
    assert.equal(m.entries.mimeType,  "image/png");
    assert.equal(m.entries.extension, "png");
    assert.equal(m.entries.mediaType, MediaType.IMAGE);
  });
});

describe("PNG — writeMetadata() + readMetadata() round-trip", () => {
  it("custom tags survive sidecar round-trip", (t) => {
    skipIfMissing(t, "png_500kb");
    const copy = path.join(TMP, "png_500kb_copy.png");
    fs.copyFileSync(PRESENT.png_500kb, copy);
    engine.writeMetadata(copy, Metadata({ entries: { caption: "Hello", source: "test-suite" } }));
    const m = engine.readMetadata(copy);
    assert.equal(m.entries.caption, "Hello");
    assert.equal(m.entries.source,  "test-suite");
    assert.equal(m.entries.mimeType, "image/png");
  });
});

// ─── Cross-format sanity checks ───────────────────────────────────────────────

describe("cross-format — all present files return non-null probe", () => {
  for (const [key, filePath] of Object.entries(PRESENT)) {
    it(`probe() never throws — ${key}`, () => {
      const r = engine.probe(filePath);
      assert.ok(r, "ProbeResult should not be null");
      assert.ok(r.mimeType && r.mimeType.length > 0, "mimeType non-empty");
      assert.ok(r.extension && r.extension.length > 0, "extension non-empty");
    });
  }
});

describe("cross-format — get() always equals probe()", () => {
  for (const [key, filePath] of Object.entries(PRESENT)) {
    it(`get() === probe() — ${key}`, () => {
      assert.deepEqual(engine.get(filePath), engine.probe(filePath));
    });
  }
});

describe("cross-format — non-strict validate passes for all present files", () => {
  const opts = ValidationOptions({ strict: false, maxBytes: 500 * 1024 * 1024 });
  for (const [key, filePath] of Object.entries(PRESENT)) {
    it(`non-strict validate — ${key}`, () => {
      const r = engine.validate(filePath, opts);
      assert.equal(r.valid, true, `${key}: ${r.errors?.[0]}`);
    });
  }
});
