import fs from "fs";
import { CodecMediaException } from "../../../CodecMediaException.js";
import { AiffParser } from "./AiffParser.js";

export class AiffCodec {
  static decode(inputOrBytes, sourceRef) {
    if (typeof inputOrBytes === "string") {
      try {
        return AiffCodec.decodeBytes(fs.readFileSync(inputOrBytes), inputOrBytes);
      } catch (e) {
        if (e instanceof CodecMediaException) throw e;
        throw new CodecMediaException(`Failed to decode AIFF: ${inputOrBytes}`, e);
      }
    }
    if (inputOrBytes && typeof inputOrBytes.length === "number") {
      return AiffCodec.decodeBytes(inputOrBytes, sourceRef ?? "<buffer>");
    }
    throw new CodecMediaException("Failed to decode AIFF: invalid input");
  }

  static decodeBytes(bytes, sourceRef) {
    const info = AiffParser.parse(bytes);
    if (info.sampleRate <= 0 || info.channels <= 0 || info.bitrateKbps <= 0) {
      throw new CodecMediaException(`Decoded AIFF has invalid stream values: ${sourceRef}`);
    }
    return info;
  }
}
