/**
 * Mp3Codec
 * Port of me.tamkungz.codecmedia.internal.audio.mp3.Mp3Codec
 */
import fs from "fs";
import { CodecMediaException } from "../../../CodecMediaException.js";
import { Mp3Parser } from "./Mp3Parser.js";

export class Mp3Codec {
  /**
   * Decode from file path or raw bytes.
   * @param {string|Buffer|Uint8Array} inputOrBytes
   * @param {string} [sourceRef]
   * @returns {import("./Mp3ProbeInfo.js").Mp3ProbeInfo}
   * @throws {CodecMediaException}
   */
  static decode(inputOrBytes, sourceRef) {
    if (typeof inputOrBytes === "string") {
      let bytes;
      try {
        bytes = fs.readFileSync(inputOrBytes);
      } catch (e) {
        throw new CodecMediaException(`Failed to decode MP3: ${inputOrBytes}`, e);
      }
      return Mp3Codec.decodeBytes(bytes, inputOrBytes);
    }

    if (inputOrBytes && typeof inputOrBytes.length === "number") {
      return Mp3Codec.decodeBytes(inputOrBytes, sourceRef ?? "<buffer>");
    }

    throw new CodecMediaException("Failed to decode MP3: invalid input");
  }

  /**
   * Decode from raw Buffer.
   * @param {Buffer} bytes
   * @param {string} sourceRef - path reference for error messages
   * @returns {import("./Mp3ProbeInfo.js").Mp3ProbeInfo}
   * @throws {CodecMediaException}
   */
  static decodeBytes(bytes, sourceRef) {
    const info = Mp3Parser.parse(bytes);
    validateDecodedProbe(info, sourceRef);
    return info;
  }

  /**
   * Write encoded MP3 data to file.
   * @param {Buffer} encodedMp3Data
   * @param {string} output
   * @throws {CodecMediaException}
   */
  static encode(encodedMp3Data, output) {
    if (!encodedMp3Data || encodedMp3Data.length === 0)
      throw new CodecMediaException("MP3 encoded data is empty");
    try {
      fs.writeFileSync(output, encodedMp3Data);
    } catch (e) {
      throw new CodecMediaException(`Failed to encode MP3: ${output}`, e);
    }
  }
}

/**
 * @param {import("./Mp3ProbeInfo.js").Mp3ProbeInfo} info
 * @param {string} input
 * @throws {CodecMediaException}
 */
function validateDecodedProbe(info, input) {
  if (info.sampleRate <= 0 || info.channels <= 0)
    throw new CodecMediaException(`Decoded MP3 has invalid stream values: ${input}`);
}
