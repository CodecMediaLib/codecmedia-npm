import fs from "fs";
import path from "path";
import { CodecMediaException } from "../../CodecMediaException.js";
import { ConversionResult } from "../../model/ConversionResult.js";

export class Mp4MovToM4aRemuxConverter {
  convert(request) {
    const sourceExt = normalize(request.sourceExtension);
    const targetExt = normalize(request.targetExtension);
    if (targetExt !== "m4a" || (sourceExt !== "mp4" && sourceExt !== "mov")) {
      throw new CodecMediaException("Only MP4/MOV -> M4A remux is supported by this converter");
    }

    try {
      const parent = path.dirname(request.output);
      if (parent) fs.mkdirSync(parent, { recursive: true });
      if (fs.existsSync(request.output) && !request.options.overwrite) {
        throw new CodecMediaException(`Output already exists and overwrite is disabled: ${request.output}`);
      }

      const inputBytes = fs.readFileSync(request.input);
      const remuxed = remuxToM4aAudioOnly(inputBytes);
      fs.writeFileSync(request.output, remuxed);
      return ConversionResult({ outputFile: request.output, format: "m4a", reencoded: false });
    } catch (e) {
      if (e instanceof CodecMediaException) throw e;
      throw new CodecMediaException(`Failed to remux file: ${request.input}`, e);
    }
  }
}

function remuxToM4aAudioOnly(bytes) {
  const moov = findTopLevelBox(bytes, "moov");
  if (moov == null) throw new CodecMediaException("Cannot remux to m4a: missing moov box");

  const trakBoxes = parseChildBoxes(bytes, moov.payloadOffset, moov.endOffset)
    .filter((box) => box.type === "trak");
  if (trakBoxes.length === 0) {
    throw new CodecMediaException("Cannot remux to m4a: source has no track boxes");
  }

  const audioTracks = [];
  const nonAudioTracks = [];
  for (const trak of trakBoxes) {
    const handler = findTrackHandlerType(bytes, trak);
    if (handler === "soun") audioTracks.push(trak);
    else nonAudioTracks.push(trak);
  }

  if (audioTracks.length === 0) {
    throw new CodecMediaException("Cannot remux to m4a: no audio track found in source container");
  }

  for (const audioTrack of audioTracks) {
    const codecFourCc = findAudioSampleEntryFourCc(bytes, audioTrack);
    if (!isM4aCompatibleAudioFourCc(codecFourCc)) {
      throw new CodecMediaException(
        "Cannot remux to m4a: source audio track codec is not m4a-compatible (found: " +
        (codecFourCc == null ? "unknown" : codecFourCc) + ")"
      );
    }
  }

  const out = Buffer.from(bytes);
  for (const nonAudio of nonAudioTracks) {
    out.write("free", nonAudio.offset + 4, "ascii");
  }
  return out;
}

function findTrackHandlerType(bytes, trak) {
  for (const child of parseChildBoxes(bytes, trak.payloadOffset, trak.endOffset)) {
    if (child.type !== "mdia") continue;
    for (const mdiaChild of parseChildBoxes(bytes, child.payloadOffset, child.endOffset)) {
      if (mdiaChild.type !== "hdlr") continue;
      const handlerOffset = mdiaChild.payloadOffset + 8;
      if (handlerOffset + 4 <= mdiaChild.endOffset) {
        return ascii(bytes, handlerOffset, 4);
      }
    }
  }
  return null;
}

function findAudioSampleEntryFourCc(bytes, trak) {
  for (const child of parseChildBoxes(bytes, trak.payloadOffset, trak.endOffset)) {
    if (child.type !== "mdia") continue;
    for (const mdiaChild of parseChildBoxes(bytes, child.payloadOffset, child.endOffset)) {
      if (mdiaChild.type !== "minf") continue;
      for (const minfChild of parseChildBoxes(bytes, mdiaChild.payloadOffset, mdiaChild.endOffset)) {
        if (minfChild.type !== "stbl") continue;
        for (const stblChild of parseChildBoxes(bytes, minfChild.payloadOffset, minfChild.endOffset)) {
          if (stblChild.type !== "stsd") continue;
          const payload = stblChild.payloadOffset;
          if (payload + 16 > stblChild.endOffset) return null;
          const entryCount = readUInt32(bytes, payload + 4);
          if (entryCount <= 0) return null;
          const firstEntryOffset = payload + 8;
          if (firstEntryOffset + 8 > stblChild.endOffset) return null;
          return ascii(bytes, firstEntryOffset + 4, 4);
        }
      }
    }
  }
  return null;
}

function findTopLevelBox(bytes, type) {
  return parseChildBoxes(bytes, 0, bytes.length).find((box) => box.type === type) ?? null;
}

function parseChildBoxes(bytes, start, endExclusive) {
  if (start < 0 || endExclusive < start || endExclusive > bytes.length) {
    throw new CodecMediaException("Invalid BMFF parse range");
  }

  const out = [];
  let cursor = start;
  while (cursor + 8 <= endExclusive) {
    const size32 = readUInt32(bytes, cursor);
    const type = ascii(bytes, cursor + 4, 4);
    let headerSize = 8;
    let boxSize = size32;
    if (size32 === 1) {
      if (cursor + 16 > endExclusive) {
        throw new CodecMediaException(`Invalid extended BMFF box header for type: ${type}`);
      }
      boxSize = readUInt64Number(bytes, cursor + 8);
      headerSize = 16;
    } else if (size32 === 0) {
      boxSize = endExclusive - cursor;
    }

    if (boxSize < headerSize) {
      throw new CodecMediaException(`Invalid BMFF box size for type: ${type}`);
    }

    const next = cursor + boxSize;
    if (next > endExclusive || next > Number.MAX_SAFE_INTEGER) {
      throw new CodecMediaException(`BMFF box exceeds bounds for type: ${type}`);
    }

    out.push({
      offset: cursor,
      endOffset: next,
      headerSize,
      type,
      payloadOffset: cursor + headerSize,
    });
    cursor = next;
  }

  if (cursor !== endExclusive) {
    throw new CodecMediaException(`Invalid BMFF box layout: unaligned payload near byte ${cursor}`);
  }
  return out;
}

function isM4aCompatibleAudioFourCc(codecFourCc) {
  return codecFourCc === "mp4a" || codecFourCc === "alac";
}

function normalize(ext) {
  if (ext == null) return "";
  const out = String(ext).trim().toLowerCase();
  return out.startsWith(".") ? out.slice(1) : out;
}

function readUInt32(bytes, offset) {
  if (offset < 0 || offset + 4 > bytes.length) {
    throw new CodecMediaException("Unexpected end of BMFF data while reading uint32");
  }
  return Buffer.from(bytes).readUInt32BE(offset);
}

function readUInt64Number(bytes, offset) {
  if (offset < 0 || offset + 8 > bytes.length) {
    throw new CodecMediaException("Unexpected end of BMFF data while reading uint64");
  }
  const value = Buffer.from(bytes).readBigUInt64BE(offset);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new CodecMediaException("BMFF box size is too large");
  }
  return Number(value);
}

function ascii(bytes, offset, length) {
  if (offset < 0 || offset + length > bytes.length) return "";
  return Buffer.from(bytes).subarray(offset, offset + length).toString("ascii");
}
