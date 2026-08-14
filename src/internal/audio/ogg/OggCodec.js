import fs from "fs";
import { CodecMediaException } from "../../../CodecMediaException.js";
import { OggParser } from "./OggParser.js";

export class OggCodec {
  static decode(inputOrBytes, sourceRef = "<buffer>") {
    if (typeof inputOrBytes === "string") {
      try {
        return OggCodec.decode(fs.readFileSync(inputOrBytes), inputOrBytes);
      } catch (e) {
        if (e instanceof CodecMediaException) throw e;
        throw new CodecMediaException(`Failed to decode OGG: ${inputOrBytes}`, e);
      }
    }
    if (inputOrBytes == null || typeof inputOrBytes.length !== "number") {
      throw new CodecMediaException("Failed to decode OGG: invalid input");
    }
    const info = OggParser.parse(inputOrBytes);
    if (info.sampleRate <= 0 || info.channels <= 0) {
      throw new CodecMediaException(`Decoded OGG has invalid stream values: ${sourceRef}`);
    }
    return info;
  }

  static encode(encodedOggData, output) {
    if (encodedOggData == null || encodedOggData.length === 0) {
      throw new CodecMediaException("OGG encoded data is empty");
    }
    try {
      fs.writeFileSync(output, encodedOggData);
    } catch (e) {
      throw new CodecMediaException(`Failed to encode OGG: ${output}`, e);
    }
  }
}
