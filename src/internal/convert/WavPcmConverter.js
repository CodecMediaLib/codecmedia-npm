import fs from "fs";
import path from "path";
import { CodecMediaException } from "../../CodecMediaException.js";
import { ConversionResult } from "../../model/ConversionResult.js";

const DEFAULT_SAMPLE_RATE = 44_100;
const DEFAULT_CHANNELS = 2;
const DEFAULT_BITS_PER_SAMPLE = 16;

export class WavPcmConverter {
  convert(request) {
    const { input, output, sourceExtension: source, targetExtension: target, options } = request;

    const wavToPcm = source === "wav" && target === "pcm";
    const pcmToWav = source === "pcm" && target === "wav";
    if (!wavToPcm && !pcmToWav) {
      throw new CodecMediaException(
        "audio->audio transcoding is not implemented yet (supported pair: wav<->pcm only)"
      );
    }

    try {
      const parent = path.dirname(output);
      if (parent) fs.mkdirSync(parent, { recursive: true });

      if (fs.existsSync(output) && !options.overwrite) {
        throw new CodecMediaException(`Output already exists and overwrite is disabled: ${output}`);
      }

      if (wavToPcm) {
        const pcmBytes = extractWavDataChunk(fs.readFileSync(input));
        fs.writeFileSync(output, pcmBytes);
        return ConversionResult({ outputFile: output, format: target, reencoded: true });
      }

      const params = parsePcmWavParams(options.preset);
      const wavBytes = wrapPcmAsWav(fs.readFileSync(input), params);
      fs.writeFileSync(output, wavBytes);
      return ConversionResult({ outputFile: output, format: target, reencoded: true });
    } catch (e) {
      if (e instanceof CodecMediaException) throw e;
      throw new CodecMediaException(`Failed to convert file: ${input}`, e);
    }
  }
}

function extractWavDataChunk(wavBytes) {
  if (wavBytes.length < 12) throw new CodecMediaException("Invalid WAV: file too small");
  const riff = ascii(wavBytes, 0, 4);
  const wave = ascii(wavBytes, 8, 4);
  if ((riff !== "RIFF" && riff !== "RF64") || wave !== "WAVE") {
    throw new CodecMediaException("Invalid WAV header");
  }

  let offset = 12;
  let sawFmt = false;
  while (offset + 8 <= wavBytes.length) {
    const chunkId = ascii(wavBytes, offset, 4);
    const chunkSize = readLeInt(wavBytes, offset + 4);
    if (chunkSize < 0) throw new CodecMediaException("Unsupported WAV chunk size");

    const dataStart = offset + 8;
    const dataEnd = dataStart + chunkSize;
    if (dataEnd > wavBytes.length) {
      throw new CodecMediaException(`WAV chunk exceeds file bounds: ${chunkId}`);
    }

    if (chunkId === "fmt ") {
      if (chunkSize < 16) throw new CodecMediaException("Invalid WAV fmt chunk");
      const audioFormat = readLeU16(wavBytes, dataStart);
      if (audioFormat !== 1) {
        throw new CodecMediaException(`Unsupported WAV format for PCM extraction: ${audioFormat}`);
      }
      sawFmt = true;
    }

    if (chunkId === "data") {
      if (!sawFmt) throw new CodecMediaException("Invalid WAV: missing fmt chunk before data");
      return Buffer.from(wavBytes).subarray(dataStart, dataEnd);
    }

    const padded = chunkSize % 2 === 0 ? chunkSize : chunkSize + 1;
    offset = dataStart + padded;
  }

  throw new CodecMediaException("WAV data chunk not found");
}

function wrapPcmAsWav(pcmBytes, params) {
  const dataSize = pcmBytes.length;
  const totalBytes = 44 + dataSize;
  if (totalBytes > 0x7fffffff) {
    throw new CodecMediaException("PCM data too large for WAV container");
  }

  const bytesPerSample = params.bitsPerSample / 8;
  const byteRate = params.sampleRate * params.channels * bytesPerSample;
  const blockAlign = params.channels * bytesPerSample;

  const b = Buffer.alloc(totalBytes);
  b.write("RIFF", 0, "ascii");
  b.writeUInt32LE(totalBytes - 8, 4);
  b.write("WAVE", 8, "ascii");
  b.write("fmt ", 12, "ascii");
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(params.channels, 22);
  b.writeUInt32LE(params.sampleRate, 24);
  b.writeUInt32LE(byteRate, 28);
  b.writeUInt16LE(blockAlign, 32);
  b.writeUInt16LE(params.bitsPerSample, 34);
  b.write("data", 36, "ascii");
  b.writeUInt32LE(dataSize, 40);
  Buffer.from(pcmBytes).copy(b, 44);
  return b;
}

function parsePcmWavParams(preset) {
  const params = {
    sampleRate: DEFAULT_SAMPLE_RATE,
    channels: DEFAULT_CHANNELS,
    bitsPerSample: DEFAULT_BITS_PER_SAMPLE,
  };

  if (preset == null || !String(preset).trim() || String(preset).trim().toLowerCase() === "balanced") {
    return params;
  }

  for (const rawToken of String(preset).toLowerCase().split(",")) {
    const token = rawToken.trim();
    if (!token) continue;
    if (token.startsWith("sr=")) {
      params.sampleRate = parseIntParam(token.slice(3), "sr", 8_000, 384_000);
    } else if (token.startsWith("ch=")) {
      params.channels = parseIntParam(token.slice(3), "ch", 1, 8);
    } else if (token.startsWith("bits=")) {
      params.bitsPerSample = parseBitsPerSample(token.slice(5));
    } else {
      throw new CodecMediaException(`Unsupported preset token for pcm->wav: ${token}`);
    }
  }

  return params;
}

function parseIntParam(value, name, min, max) {
  const parsed = Number.parseInt(String(value).trim(), 10);
  if (!Number.isInteger(parsed)) {
    throw new CodecMediaException(`Invalid integer for ${name}: ${value}`);
  }
  if (parsed < min || parsed > max) {
    throw new CodecMediaException(`${name} out of range: ${parsed} (${min}-${max})`);
  }
  return parsed;
}

function parseBitsPerSample(value) {
  const parsed = parseIntParam(value, "bits", 8, 32);
  if (![8, 16, 24, 32].includes(parsed)) {
    throw new CodecMediaException("Unsupported bits value in preset (allowed: 8,16,24,32)");
  }
  return parsed;
}

function ascii(bytes, offset, length) {
  return Buffer.from(bytes).subarray(offset, offset + length).toString("ascii");
}

function readLeInt(bytes, offset) {
  if (offset < 0 || offset + 4 > bytes.length) {
    throw new CodecMediaException("Unexpected end of WAV data");
  }
  return Buffer.from(bytes).readInt32LE(offset);
}

function readLeU16(bytes, offset) {
  if (offset < 0 || offset + 2 > bytes.length) {
    throw new CodecMediaException("Unexpected end of WAV data");
  }
  return Buffer.from(bytes).readUInt16LE(offset);
}
