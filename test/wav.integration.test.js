import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { WavParser } from "../src/internal/audio/wav/WavParser.js";
import { WavCodec } from "../src/internal/audio/wav/WavCodec.js";
import { StubCodecMediaEngine } from "../src/internal/StubCodecMediaEngine.js";
import { MediaType } from "../src/model/MediaType.js";
import { StreamKind } from "../src/model/StreamKind.js";

const TEST_DIR = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));

const SAMPLE_ABLETON = path.join(TEST_DIR, "c-major-scale_test_ableton-live.wav");
const SAMPLE_10MG = path.join(TEST_DIR, "file_example_WAV_10MG.wav");

function assertLooksLikeWavProbe(info) {
  assert.ok(info);
  assert.equal(info.codec, "pcm");
  assert.ok(info.channels > 0);
  assert.ok(info.sampleRate > 0);
  assert.ok(info.bitsPerSample > 0);
  assert.ok(info.bitrateKbps > 0);
  assert.ok(info.durationMillis > 0);
  assert.equal(info.bitrateMode, "CBR");
}

describe("WAV integration — real bundled files", () => {
  it("parses Ableton sample correctly", () => {
    assert.equal(fs.existsSync(SAMPLE_ABLETON), true);
    const bytes = fs.readFileSync(SAMPLE_ABLETON);
    assert.equal(WavParser.isLikelyWav(bytes), true);

    const info = WavParser.parse(bytes);
    assertLooksLikeWavProbe(info);

    // Regression values provided by the issue context.
    assert.equal(info.channels, 2);
    assert.equal(info.sampleRate, 44100);
    assert.equal(info.bitsPerSample, 16);
  });

  it("parses 10MG sample correctly", () => {
    assert.equal(fs.existsSync(SAMPLE_10MG), true);
    const bytes = fs.readFileSync(SAMPLE_10MG);
    assert.equal(WavParser.isLikelyWav(bytes), true);

    const info = WavParser.parse(bytes);
    assertLooksLikeWavProbe(info);

    assert.equal(info.channels, 2);
    assert.equal(info.sampleRate, 44100);
    assert.equal(info.bitsPerSample, 16);
  });

  it("decode(path) equals decodeBytes() for Ableton sample", () => {
    const fromPath = WavCodec.decode(SAMPLE_ABLETON);
    const fromBytes = WavCodec.decodeBytes(fs.readFileSync(SAMPLE_ABLETON), SAMPLE_ABLETON);
    assert.deepEqual(fromPath, fromBytes);
  });
});

describe("WAV integration — engine probe", () => {
  const engine = new StubCodecMediaEngine();

  it("probe() returns populated WAV stream fields", () => {
    const r = engine.probe(SAMPLE_10MG);
    assert.equal(r.mimeType, "audio/wav");
    assert.equal(r.extension, "wav");
    assert.equal(r.mediaType, MediaType.AUDIO);
    assert.ok(r.durationMillis > 0);

    assert.equal(r.streams.length, 1);
    assert.equal(r.streams[0].kind, StreamKind.AUDIO);
    assert.equal(r.streams[0].codec, "pcm");
    assert.equal(r.streams[0].channels, 2);
    assert.equal(r.streams[0].sampleRate, 44100);
    assert.ok(r.streams[0].bitrateKbps > 0);

    assert.equal(r.tags.bitrateMode, "CBR");
    assert.equal(r.tags.bitsPerSample, "16");
  });
});

