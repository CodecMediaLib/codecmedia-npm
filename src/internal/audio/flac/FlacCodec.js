import fs from "fs";
import { CodecMediaException } from "../../../CodecMediaException.js";
import { FlacParser } from "./FlacParser.js";

export class FlacCodec {
  static decode(inputOrBytes, sourceRef) {
    if (typeof inputOrBytes === "string") {
      try {
        return FlacCodec.decodeBytes(fs.readFileSync(inputOrBytes), inputOrBytes);
      } catch (e) {
        if (e instanceof CodecMediaException) throw e;
        throw new CodecMediaException(`Failed to decode FLAC: ${inputOrBytes}`, e);
      }
    }
    if (inputOrBytes && typeof inputOrBytes.length === "number") {
      return FlacCodec.decodeBytes(inputOrBytes, sourceRef ?? "<buffer>");
    }
    throw new CodecMediaException("Failed to decode FLAC: invalid input");
  }

  static decodeBytes(bytes, sourceRef) {
    const info = FlacParser.parse(bytes);
    if (info.sampleRate <= 0 || info.channels <= 0 || info.bitsPerSample <= 0) {
      throw new CodecMediaException(`Decoded FLAC has invalid stream values: ${sourceRef}`);
    }
    return info;
  }
}
