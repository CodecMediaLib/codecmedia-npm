import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { Mp3Parser } from "../src/internal/audio/mp3/Mp3Parser.js";
import { Mp3Codec } from "../src/internal/audio/mp3/Mp3Codec.js";

const TEST_DIR = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const SAMPLE_700KB = path.join(TEST_DIR, "file_example_MP3_700KB.mp3");
const SAMPLE_1MG = path.join(TEST_DIR, "file_example_MP3_1MG.mp3");

function assertLooksLikeMp3Probe(info) {
  assert.ok(info);
  assert.equal(info.codec, "mp3");
  assert.ok(info.sampleRate > 0);
  assert.ok(info.channels === 1 || info.channels === 2);
  assert.ok(info.bitrateKbps > 0);
  assert.ok(info.durationMillis > 0);
}

describe("MP3 integration — real bundled files", () => {
  it("700KB file exists and parses", () => {
    assert.equal(fs.existsSync(SAMPLE_700KB), true);
    const bytes = fs.readFileSync(SAMPLE_700KB);
    const info = Mp3Parser.parse(bytes);
    assertLooksLikeMp3Probe(info);
  });

  it("1MG file exists and parses", () => {
    assert.equal(fs.existsSync(SAMPLE_1MG), true);
    const bytes = fs.readFileSync(SAMPLE_1MG);
    const info = Mp3Parser.parse(bytes);
    assertLooksLikeMp3Probe(info);
  });

  it("decode(path) equals decodeBytes() for 700KB", () => {
    const fromPath = Mp3Codec.decode(SAMPLE_700KB);
    const fromBytes = Mp3Codec.decodeBytes(fs.readFileSync(SAMPLE_700KB), SAMPLE_700KB);
    assert.deepEqual(fromPath, fromBytes);
  });
});
