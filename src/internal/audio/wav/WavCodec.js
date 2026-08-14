import fs from "fs";
import { CodecMediaException } from "../../../CodecMediaException.js";
import { WavParser } from "./WavParser.js";

export class WavCodec {
  /**
   * Decode WAV from file path or raw bytes.
   * Supports both signatures for compatibility:
   *  - decode(inputPath: string)
   *  - decode(bytes: Buffer, sourceRef: string)
   *
   * @param {string|Buffer|Uint8Array} inputOrBytes
   * @param {string} [sourceRef]
   * @returns {import("./WavProbeInfo.js").WavProbeInfo}
   */
  static decode(inputOrBytes, sourceRef) {
    if (typeof inputOrBytes === "string") {
      let bytes;
      try {
        bytes = fs.readFileSync(inputOrBytes);
      } catch (e) {
        throw new CodecMediaException(`Failed to decode WAV: ${inputOrBytes}`, e);
      }
      return WavCodec.decodeBytes(bytes, inputOrBytes);
    }

    if (inputOrBytes && typeof inputOrBytes.length === "number") {
      return WavCodec.decodeBytes(inputOrBytes, sourceRef ?? "<buffer>");
    }

    throw new CodecMediaException("Failed to decode WAV: invalid input");
  }

  /**
   * @param {Buffer|Uint8Array} bytes
   * @param {string} sourceRef
   * @returns {import("./WavProbeInfo.js").WavProbeInfo}
   */
  static decodeBytes(bytes, sourceRef) {
    const info = WavParser.parse(bytes);
    validateDecodedProbe(info, sourceRef);
    return info;
  }

  /**
   * @param {Buffer|Uint8Array} encodedWavData
   * @param {string} output
   */
  static encode(encodedWavData, output) {
    if (!encodedWavData || encodedWavData.length === 0) {
      throw new CodecMediaException("WAV encoded data is empty");
    }
    try {
      fs.writeFileSync(output, encodedWavData);
    } catch (e) {
      throw new CodecMediaException(`Failed to encode WAV: ${output}`, e);
    }
  }
}

/**
 * @param {import("./WavProbeInfo.js").WavProbeInfo} info
 * @param {string} input
 */
function validateDecodedProbe(info, input) {
  if (info.sampleRate <= 0 || info.channels <= 0 || info.bitrateKbps <= 0) {
    throw new CodecMediaException(`Decoded WAV has invalid stream values: ${input}`);
  }
}

