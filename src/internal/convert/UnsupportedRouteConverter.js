/**
 * UnsupportedRouteConverter
 * Port of me.tamkungz.codecmedia.internal.convert.UnsupportedRouteConverter
 */
import { CodecMediaException } from "../../CodecMediaException.js";

export class UnsupportedRouteConverter {
  /** @param {string} message */
  constructor(message) {
    this._message = message;
  }

  /**
   * @param {import("./ConversionRequest.js").ConversionRequest} _request
   * @returns {never}
   * @throws {CodecMediaException}
   */
  convert(_request) {
    throw new CodecMediaException(this._message);
  }
}