import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  CodecMedia,
  AudioExtractOptions,
  ConversionOptions,
  PlaybackOptions,
  ValidationOptions,
  MediaType,
} from "../src/index.js";

const fixtureDir = path.join(import.meta.dirname, "fixtures");

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "codecmedia-js-"));
}

function makePngHeader(width = 2, height = 3, bitDepth = 8, colorType = 6) {
  const b = Buffer.alloc(33);
  Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write("IHDR", 12, "ascii");
  b.writeUInt32BE(width, 16);
  b.writeUInt32BE(height, 20);
  b[24] = bitDepth;
  b[25] = colorType;
  return b;
}

function makePcmWav({ sampleRate = 8000, channels = 1, bits = 16, frames = 800 } = {}) {
  const bytesPerSample = bits / 8;
  const dataSize = frames * channels * bytesPerSample;
  const out = Buffer.alloc(44 + dataSize);
  out.write("RIFF", 0, "ascii");
  out.writeUInt32LE(out.length - 8, 4);
  out.write("WAVE", 8, "ascii");
  out.write("fmt ", 12, "ascii");
  out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20);
  out.writeUInt16LE(channels, 22);
  out.writeUInt32LE(sampleRate, 24);
  out.writeUInt32LE(sampleRate * channels * bytesPerSample, 28);
  out.writeUInt16LE(channels * bytesPerSample, 32);
  out.writeUInt16LE(bits, 34);
  out.write("data", 36, "ascii");
  out.writeUInt32LE(dataSize, 40);
  return out;
}

function makeRf64PcmWav({ sampleRate = 8000, channels = 1, bits = 16, frames = 32 } = {}) {
  const bytesPerSample = bits / 8;
  const dataSize = frames * channels * bytesPerSample;
  const total = 12 + 36 + 24 + 8 + dataSize;
  const out = Buffer.alloc(total);
  let o = 0;
  out.write("RF64", o, "ascii"); o += 4;
  out.writeUInt32LE(0xffffffff, o); o += 4;
  out.write("WAVE", o, "ascii"); o += 4;

  out.write("ds64", o, "ascii"); o += 4;
  out.writeUInt32LE(28, o); o += 4;
  out.writeBigUInt64LE(BigInt(total - 8), o); o += 8;
  out.writeBigUInt64LE(BigInt(dataSize), o); o += 8;
  out.writeBigUInt64LE(BigInt(frames), o); o += 8;
  out.writeUInt32LE(0, o); o += 4;

  out.write("fmt ", o, "ascii"); o += 4;
  out.writeUInt32LE(16, o); o += 4;
  out.writeUInt16LE(1, o); o += 2;
  out.writeUInt16LE(channels, o); o += 2;
  out.writeUInt32LE(sampleRate, o); o += 4;
  out.writeUInt32LE(sampleRate * channels * bytesPerSample, o); o += 4;
  out.writeUInt16LE(channels * bytesPerSample, o); o += 2;
  out.writeUInt16LE(bits, o); o += 2;

  out.write("data", o, "ascii"); o += 4;
  out.writeUInt32LE(0xffffffff, o); o += 4;
  return out;
}

function commandAvailable(command) {
  const r = spawnSync(command, ["-version"], { stdio: "ignore" });
  return !r.error && r.status === 0;
}

test("public option factories are safe with no arguments", () => {
  assert.equal(AudioExtractOptions().targetFormat, "");
  assert.equal(ConversionOptions().overwrite, false);
  assert.equal(PlaybackOptions().allowExternalApp, true);
  assert.equal(ValidationOptions().strict, false);
});

test("OGG Vorbis probe is a real parser path", () => {
  const engine = CodecMedia.createDefault({ strictProbe: true });
  const result = engine.probe(path.join(fixtureDir, "vorbis.ogg"));
  assert.equal(result.mediaType, MediaType.AUDIO);
  assert.equal(result.extension, "ogg");
  assert.equal(result.streams[0].codec, "vorbis");
  assert.equal(result.streams[0].sampleRate, 48000);
  assert.equal(result.streams[0].channels, 2);
  assert.ok(result.durationMillis > 5000 && result.durationMillis < 5100);
});

test("probe prefers file signature over a misleading extension", () => {
  const dir = tempDir();
  try {
    const fakeMp3 = path.join(dir, "actually-png.mp3");
    fs.writeFileSync(fakeMp3, makePngHeader(7, 9));
    const result = CodecMedia.createDefault({ strictProbe: true }).probe(fakeMp3);
    assert.equal(result.mediaType, MediaType.IMAGE);
    assert.equal(result.extension, "png");
    assert.equal(result.streams[0].width, 7);
    assert.equal(result.streams[0].height, 9);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("strictProbe throws parser errors instead of coarse fallback", () => {
  const dir = tempDir();
  try {
    const file = path.join(dir, "broken.png");
    fs.writeFileSync(file, Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]));
    assert.throws(() => CodecMedia.createDefault({ strictProbe: true }).probe(file));
    const relaxed = CodecMedia.createDefault().probe(file);
    assert.equal(relaxed.extension, "png");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("validate rejects directories", () => {
  const dir = tempDir();
  try {
    const result = CodecMedia.createDefault().validate(dir);
    assert.equal(result.valid, false);
    assert.match(result.errors[0], /regular file/i);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("sidecar metadata escaping round-trips keys and values", () => {
  const dir = tempDir();
  try {
    const input = path.join(dir, "sample.bin");
    fs.writeFileSync(input, Buffer.from("data"));
    const engine = CodecMedia.createDefault();
    engine.writeMetadata(input, { entries: { "a=b": "line1\nline2", "slash\\key": "v=1\\2" } });
    const metadata = engine.readMetadata(input).entries;
    assert.equal(metadata["a=b"], "line1\nline2");
    assert.equal(metadata["slash\\key"], "v=1\\2");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("WAV -> PCM and PCM -> WAV work without external tools", () => {
  const dir = tempDir();
  try {
    const input = path.join(dir, "in.wav");
    const pcm = path.join(dir, "out.pcm");
    const roundTrip = path.join(dir, "round.wav");
    fs.writeFileSync(input, makePcmWav());
    const engine = CodecMedia.createDefault();
    engine.convert(input, pcm, { targetFormat: "pcm", overwrite: true, preset: "balanced" });
    assert.equal(fs.statSync(pcm).size, 1600);
    engine.convert(pcm, roundTrip, { targetFormat: "wav", overwrite: true, preset: "sr=8000,ch=1,bits=16" });
    const result = engine.probe(roundTrip);
    assert.equal(result.streams[0].sampleRate, 8000);
    assert.equal(result.streams[0].channels, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("RF64 ds64 sizes work for probe, metadata traversal and WAV -> PCM", () => {
  const dir = tempDir();
  try {
    const input = path.join(dir, "in.wav");
    const output = path.join(dir, "out.pcm");
    fs.writeFileSync(input, makeRf64PcmWav());
    const engine = CodecMedia.createDefault({ strictProbe: true });
    const probe = engine.probe(input);
    assert.equal(probe.extension, "wav");
    assert.equal(probe.streams[0].sampleRate, 8000);
    assert.doesNotThrow(() => engine.readMetadata(input));
    engine.convert(input, output, { targetFormat: "pcm", overwrite: true, preset: "balanced" });
    assert.equal(fs.statSync(output).size, 64);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("custom image converter option is actually wired", () => {
  const dir = tempDir();
  try {
    const input = path.join(dir, "in.png");
    const output = path.join(dir, "out.jpg");
    fs.writeFileSync(input, makePngHeader());
    let called = false;
    const engine = CodecMedia.createDefault({
      imageToImageTranscodeConverter(request) {
        called = true;
        fs.writeFileSync(request.output, Buffer.from("custom"));
        return { outputFile: request.output, format: request.targetExtension, reencoded: true };
      },
    });
    const result = engine.convert(input, output, { targetFormat: "jpg", overwrite: true, preset: "balanced" });
    assert.equal(called, true);
    assert.equal(result.reencoded, true);
    assert.equal(fs.readFileSync(output, "utf8"), "custom");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("ffprobe enhancement is optional and enriches probe when available", { skip: !commandAvailable("ffprobe") }, () => {
  const dir = tempDir();
  try {
    const input = path.join(dir, "in.wav");
    fs.writeFileSync(input, makePcmWav());
    const result = CodecMedia.createDefault({ enableFfprobeEnhancement: true, requireExternalTools: true }).probe(input);
    assert.equal(result.tags.ffprobeFormat, "wav");
    assert.ok(result.streams.length >= 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("FFmpeg opt-in enables real audio transcoding", { skip: !commandAvailable("ffmpeg") }, () => {
  const dir = tempDir();
  try {
    const input = path.join(dir, "in.wav");
    const output = path.join(dir, "out.mp3");
    fs.writeFileSync(input, makePcmWav({ frames: 8000 }));
    const engine = CodecMedia.createDefault({ enableFfmpegConversion: true });
    const converted = engine.convert(input, output, { targetFormat: "mp3", overwrite: true, preset: "balanced" });
    assert.equal(converted.reencoded, true);
    assert.ok(fs.statSync(output).size > 0);
    assert.equal(engine.probe(output).extension, "mp3");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
