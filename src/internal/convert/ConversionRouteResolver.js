/**
 * ConversionRouteResolver
 * Port of me.tamkungz.codecmedia.internal.convert.ConversionRouteResolver
 */
import { MediaType }       from "../../model/MediaType.js";
import { ConversionRoute } from "./ConversionRoute.js";

export class ConversionRouteResolver {
  /**
   * Resolve the conversion route from source to target media type.
   * @param {string|null} source
   * @param {string|null} target
   * @returns {string} ConversionRoute value
   */
  static resolve(source, target) {
    if (source == null || target == null) return ConversionRoute.UNSUPPORTED;

    if (source === MediaType.AUDIO && target === MediaType.AUDIO) return ConversionRoute.AUDIO_TO_AUDIO;
    if (source === MediaType.AUDIO && target === MediaType.IMAGE) return ConversionRoute.AUDIO_TO_IMAGE;
    if (source === MediaType.VIDEO && target === MediaType.AUDIO) return ConversionRoute.VIDEO_TO_AUDIO;
    if (source === MediaType.VIDEO && target === MediaType.VIDEO) return ConversionRoute.VIDEO_TO_VIDEO;
    if (source === MediaType.IMAGE && target === MediaType.IMAGE) return ConversionRoute.IMAGE_TO_IMAGE;

    return ConversionRoute.UNSUPPORTED;
  }
}