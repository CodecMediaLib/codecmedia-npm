/**
 * Mp4Codec
 * Port of me.tamkungz.codecmedia.internal.video.mp4.Mp4Codec
 */
import fs from "fs";
import { CodecMediaException } from "../../../CodecMediaException.js";
import { Mp4Parser }           from "./Mp4Parser.js";

export class Mp4Codec {
  /**
   * Decode from file path OR raw Buffer.
   * Supports two signatures to match how StubCodecMediaEngine calls it:
   *   - decode(inputPath: string)
   *   - decode(bytes: Buffer, sourceRef: string)
   *
   * @param {string|Buffer|Uint8Array} inputOrBytes
   * @param {string} [sourceRef]
   * @returns {import("./Mp4ProbeInfo.js").Mp4ProbeInfo}
   * @throws {CodecMediaException}
   */
  static decode(inputOrBytes, sourceRef) {
    if (typeof inputOrBytes === "string") {
      let bytes;
      try {
        bytes = fs.readFileSync(inputOrBytes);
      } catch (e) {
        throw new CodecMediaException(`Failed to decode MP4: ${inputOrBytes}`, e);
      }
      return Mp4Codec.decodeBytes(bytes, inputOrBytes);
    }

    if (inputOrBytes && typeof inputOrBytes.length === "number") {
      return Mp4Codec.decodeBytes(inputOrBytes, sourceRef ?? "<buffer>");
    }

    throw new CodecMediaException("Failed to decode MP4: invalid input");
  }

  /**
   * Decode from raw Buffer.
   * @param {Buffer} bytes
   * @param {string} sourceRef - path reference for error messages
   * @returns {import("./Mp4ProbeInfo.js").Mp4ProbeInfo}
   * @throws {CodecMediaException}
   */
  static decodeBytes(bytes, sourceRef) {
    const info = Mp4Parser.parse(bytes);
    validateDecodedProbe(info, sourceRef);
    return info;
  }

  /**
   * Write encoded MP4 data to file.
   * @param {Buffer} encodedMp4Data
   * @param {string} output
   * @throws {CodecMediaException}
   */
  static encode(encodedMp4Data, output) {
    if (!encodedMp4Data || encodedMp4Data.length === 0) {
      throw new CodecMediaException("MP4 encoded data is empty");
    }
    try {
      fs.writeFileSync(output, encodedMp4Data);
    } catch (e) {
      throw new CodecMediaException(`Failed to encode MP4: ${output}`, e);
    }
  }
}

/**
 * @param {import("./Mp4ProbeInfo.js").Mp4ProbeInfo} info
 * @param {string} input
 * @throws {CodecMediaException}
 */
function validateDecodedProbe(info, input) {
  if (!info.majorBrand || info.majorBrand.trim() === "") {
    throw new CodecMediaException(`Decoded MP4 has invalid major brand: ${input}`);
  }
  if (info.width  != null && info.width  <= 0) {
    throw new CodecMediaException(`Decoded MP4 has invalid width: ${input}`);
  }
  if (info.height != null && info.height <= 0) {
    throw new CodecMediaException(`Decoded MP4 has invalid height: ${input}`);
  }
}