import fs from "fs";
import { CodecMediaException } from "../../../CodecMediaException.js";
import { WebmParser } from "./WebmParser.js";

export class WebmCodec {
  /**
   * Decode from file path.
   * @param {string} input
   * @returns {import("./WebmProbeInfo.js").WebmProbeInfo}
   * @throws {CodecMediaException}
   */
  static decode(input) {
    let bytes;
    try {
      bytes = fs.readFileSync(input);
    } catch (e) {
      throw new CodecMediaException(`Failed to decode WebM: ${input}`, e);
    }
    return WebmCodec.decodeBytes(bytes, input);
  }

  /**
   * Decode from raw Buffer.
   * @param {Buffer} bytes
   * @param {string} sourceRef - path reference for error messages
   * @returns {import("./WebmProbeInfo.js").WebmProbeInfo}
   * @throws {CodecMediaException}
   */
  static decodeBytes(bytes, sourceRef) {
    const info = WebmParser.parse(bytes);
    validateDecodedProbe(info, sourceRef);
    return info;
  }

  /**
   * Write encoded WebM data to file.
   * @param {Buffer} encodedWebmData
   * @param {string} output
   * @throws {CodecMediaException}
   */
  static encode(encodedWebmData, output) {
    if (!encodedWebmData || encodedWebmData.length === 0)
      throw new CodecMediaException("WebM encoded data is empty");
    try {
      fs.writeFileSync(output, encodedWebmData);
    } catch (e) {
      throw new CodecMediaException(`Failed to encode WebM: ${output}`, e);
    }
  }
}

/**
 * @param {import("./WebmProbeInfo.js").WebmProbeInfo} info
 * @param {string} input
 * @throws {CodecMediaException}
 */
function validateDecodedProbe(info, input) {
  if (info.width    != null && info.width    <= 0) throw new CodecMediaException(`Decoded WebM has invalid width: ${input}`);
  if (info.height   != null && info.height   <= 0) throw new CodecMediaException(`Decoded WebM has invalid height: ${input}`);
  if (info.sampleRate != null && info.sampleRate <= 0) throw new CodecMediaException(`Decoded WebM has invalid sample rate: ${input}`);
  if (info.channels != null && info.channels <= 0) throw new CodecMediaException(`Decoded WebM has invalid channel count: ${input}`);
}