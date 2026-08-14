/**
 * DefaultConversionHub
 * Port of me.tamkungz.codecmedia.internal.convert.DefaultConversionHub
 *
 * Implements ConversionHub and routes each request to the appropriate converter.
 * Wire into StubCodecMediaEngine via the `conversionHub` option:
 *
 *   import { DefaultConversionHub } from "./internal/convert/DefaultConversionHub.js";
 *   import { StubCodecMediaEngine } from "./internal/StubCodecMediaEngine.js";
 *
 *   const engine = new StubCodecMediaEngine({ conversionHub: new DefaultConversionHub() });
 */
import { CodecMediaException }      from "../../CodecMediaException.js";
import { ConversionRoute }          from "./ConversionRoute.js";
import { ConversionRouteResolver }  from "./ConversionRouteResolver.js";
import { SameFormatCopyConverter }  from "./SameFormatCopyConverter.js";
import { WavPcmConverter }      from "./WavPcmConverter.js";
import { Mp4MovToM4aRemuxConverter } from "./Mp4MovToM4aRemuxConverter.js";
import { UnsupportedRouteConverter } from "./UnsupportedRouteConverter.js";

export class DefaultConversionHub {
  constructor(options = {}) {
    this._externalConverter = options.externalConverter ?? null;
    this._passthroughConverter = new SameFormatCopyConverter();
    this._wavPcmConverter  = new WavPcmConverter();
    this._imageToImageConverter = normalizeConverter(
      options.imageToImageConverter,
      this._externalConverter ?? new UnsupportedRouteConverter(
        "image->image transcoding requires enableFfmpegConversion=true or a custom imageToImageTranscodeConverter"
      ),
      "imageToImageConverter"
    );
    this._mp4MovToM4aRemuxConverter = new Mp4MovToM4aRemuxConverter();

    this._videoToAudioConverter = this._externalConverter ?? new UnsupportedRouteConverter(
      "video->audio conversion requires an external converter (enableFfmpegConversion=true or provide conversionHub)"
    );
    this._audioToImageConverter = this._externalConverter ?? new UnsupportedRouteConverter(
      "audio->image album-art extraction requires an external converter"
    );
    this._videoToVideoConverter = this._externalConverter ?? new UnsupportedRouteConverter(
      "video->video conversion requires an external converter"
    );
    this._audioToAudioTranscodeConverter = this._externalConverter ?? new UnsupportedRouteConverter(
      "audio->audio transcoding requires an external converter"
    );
  }

  /**
   * @param {import("./ConversionRequest.js").ConversionRequest} request
   * @returns {import("../model/ConversionResult.js").ConversionResult}
   * @throws {CodecMediaException}
   */
  convert(request) {
    // Same-format → passthrough copy
    if (request.sourceExtension === request.targetExtension) {
      return this._passthroughConverter.convert(request);
    }

    const route = ConversionRouteResolver.resolve(request.sourceMediaType, request.targetMediaType);

    switch (route) {
      case ConversionRoute.VIDEO_TO_AUDIO:
        return this._convertVideoToAudio(request);

      case ConversionRoute.AUDIO_TO_IMAGE:
        return this._audioToImageConverter.convert(request);

      case ConversionRoute.VIDEO_TO_VIDEO:
        return this._videoToVideoConverter.convert(request);

      case ConversionRoute.AUDIO_TO_AUDIO: {
        const src = request.sourceExtension;
        const tgt = request.targetExtension;
        const isWavPcmPair =
          (src === "wav" && tgt === "pcm") ||
          (src === "pcm" && tgt === "wav");
        return isWavPcmPair
          ? this._wavPcmConverter.convert(request)
          : this._audioToAudioTranscodeConverter.convert(request);
      }

      case ConversionRoute.IMAGE_TO_IMAGE:
        return this._imageToImageConverter.convert(request);

      case ConversionRoute.UNSUPPORTED:
      default:
        throw new CodecMediaException(
          `Unsupported conversion route: ${request.sourceMediaType} -> ${request.targetMediaType}`
        );
    }
  }

  _convertVideoToAudio(request) {
    const mp4MovToM4a = request.targetExtension === "m4a" &&
      (request.sourceExtension === "mp4" || request.sourceExtension === "mov");
    if (!mp4MovToM4a) return this._videoToAudioConverter.convert(request);

    try {
      return this._mp4MovToM4aRemuxConverter.convert(request);
    } catch (e) {
      // When FFmpeg is explicitly enabled, use it as a compatibility fallback
      // for containers/codecs the dependency-free remuxer cannot handle.
      if (this._externalConverter) return this._externalConverter.convert(request);
      throw e;
    }
  }
}

function normalizeConverter(candidate, fallback, name) {
  if (candidate == null) return fallback;
  if (typeof candidate === "function") {
    return { convert: candidate };
  }
  if (typeof candidate.convert === "function") return candidate;
  throw new TypeError(`${name} must be a function or an object with convert(request)`);
}
