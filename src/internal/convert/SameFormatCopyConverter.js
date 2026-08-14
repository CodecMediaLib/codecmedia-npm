/**
 * SameFormatCopyConverter
 * Port of me.tamkungz.codecmedia.internal.convert.SameFormatCopyConverter
 */
import fs   from "fs";
import path from "path";
import { CodecMediaException } from "../../CodecMediaException.js";
import { ConversionResult }    from "../../model/ConversionResult.js";

export class SameFormatCopyConverter {
  /**
   * @param {import("./ConversionRequest.js").ConversionRequest} request
   * @returns {import("../model/ConversionResult.js").ConversionResult}
   * @throws {CodecMediaException}
   */
  convert(request) {
    const { input, output, targetExtension, options } = request;
    try {
      const parent = path.dirname(output);
      if (parent) fs.mkdirSync(parent, { recursive: true });

      if (fs.existsSync(output) && !options.overwrite) {
        throw new CodecMediaException(`Output already exists and overwrite is disabled: ${output}`);
      }

      fs.copyFileSync(input, output);
      return ConversionResult({ outputFile: output, format: targetExtension, reencoded: false });
    } catch (e) {
      if (e instanceof CodecMediaException) throw e;
      throw new CodecMediaException(`Failed to convert file: ${input}`, e);
    }
  }
}