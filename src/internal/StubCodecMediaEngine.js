import fs from "fs";
import path from "path";
import os from "os";
import { spawnSync } from "child_process";
import { CodecMediaEngine } from "../CodecMediaEngine.js";
import { CodecMediaException } from "../CodecMediaException.js";

// Models
import { MediaType }        from "../model/MediaType.js";
import { StreamKind }       from "../model/StreamKind.js";
import { StreamInfo }       from "../model/StreamInfo.js";
import { ProbeResult }      from "../model/ProbeResult.js";
import { Metadata }         from "../model/Metadata.js";
import { ValidationResult } from "../model/ValidationResult.js";
import { ExtractionResult } from "../model/ExtractionResult.js";
import { PlaybackResult }   from "../model/PlaybackResult.js";

// Options
import { AudioExtractOptions } from "../options/AudioExtractOptions.js";
import { ConversionOptions }   from "../options/ConversionOptions.js";
import { PlaybackOptions }     from "../options/PlaybackOptions.js";
import { ValidationOptions }   from "../options/ValidationOptions.js";

// Video parsers/codecs
import { WebmParser } from "./video/webm/WebmParser.js";
import { WebmCodec }  from "./video/webm/WebmCodec.js";
import { Mp3Parser }  from "./audio/mp3/Mp3Parser.js";
import { Mp3Codec }   from "./audio/mp3/Mp3Codec.js";
import { Mp3Id3v1Tag } from "./audio/mp3/Mp3Id3v1Tag.js";
import { OggParser } from "./audio/ogg/OggParser.js";
import { OggCodec } from "./audio/ogg/OggCodec.js";
import { AiffParser } from "./audio/aiff/AiffParser.js";
import { AiffCodec }  from "./audio/aiff/AiffCodec.js";
import { FlacParser } from "./audio/flac/FlacParser.js";
import { FlacCodec }  from "./audio/flac/FlacCodec.js";
import { Mp4Parser }  from "./video/mp4/Mp4Parser.js";
import { Mp4Codec }   from "./video/mp4/Mp4Codec.js";
import { isSupportedMp4MajorBrand } from "./video/mp4/Mp4Brands.js";
import { WavParser } from "./audio/wav/WavParser.js";
import { WavCodec } from "./audio/wav/WavCodec.js";
import { JpegParser } from "./image/jpeg/JpegParser.js";
import { PngParser } from "./image/png/PngParser.js";
import { PngCodec } from "./image/png/PngCodec.js";
import { WebpParser } from "./image/webp/WebpParser.js";
import { BmpParser } from "./image/bmp/BmpParser.js";
import { TiffParser } from "./image/tiff/TiffParser.js";
import { HeifParser } from "./image/heif/HeifParser.js";
import { registerImageCodec } from "./convert/ImageTranscodeConverter.js";
import { DefaultConversionHub } from "./convert/DefaultConversionHub.js";
import { FfmpegConverter } from "./convert/FfmpegConverter.js";

// ─── Constants ────────────────────────────────────────────────────────────────

const STRICT_VALIDATION_MAX_BYTES = 32 * 1024 * 1024; // 32 MB
const PROBE_PREFIX_BYTES = 128 * 1024;                 // 128 KB

// ─── StubCodecMediaEngine ────────────────────────────────────────────────────

/**
 * StubCodecMediaEngine
 * Port of me.tamkungz.codecmedia.internal.StubCodecMediaEngine
 *
 * Default implementation of CodecMediaEngine.
 * All methods are synchronous to mirror the Java API surface.
 * Parser modules that have not been ported yet are stubbed gracefully.
 */
export class StubCodecMediaEngine extends CodecMediaEngine {
  /**
   * @param {import("../CodecMedia.js").CreateDefaultOptions} [options]
   */
  constructor(options = {}) {
    super();
    this._options = Object.freeze({ ...options });
    const externalConverter = options.enableFfmpegConversion
      ? new FfmpegConverter({ ffmpegPath: options.ffmpegPath ?? "ffmpeg" })
      : null;
    this._conversionHub = options.conversionHub ?? new DefaultConversionHub({
      imageToImageConverter: options.imageToImageTranscodeConverter,
      externalConverter,
    });
  }

  // ── get ────────────────────────────────────────────────────────────────────

  /** @param {string} input @returns {import("../model/ProbeResult.js").ProbeResult} */
  get(input) {
    return this.probe(input);
  }

  // ── probe ──────────────────────────────────────────────────────────────────

  /** @param {string} input @returns {import("../model/ProbeResult.js").ProbeResult} */
  probe(input) {
    const nativeProbe = this._probeNative(input);
    if (!this._options.enableFfprobeEnhancement) return nativeProbe;
    return enhanceProbeWithFfprobe(
      input,
      nativeProbe,
      this._options.ffprobePath ?? "ffprobe",
      Boolean(this._options.requireExternalTools),
    );
  }

  /** Native, dependency-free probe implementation. */
  _probeNative(input) {
    ensureExists(input);
    const ext  = extractExtension(input);
    const size = fs.statSync(input).size;

    let prefix;
    try {
      prefix = readProbePrefix(input);
    } catch (e) {
      throw new CodecMediaException(`Failed to probe file: ${input}`, e);
    }

    // ── sniff flags ─────────────────────────────────────────────────────────
    // Prefer bytes over the filename. Extension fallback is used only when no
    // known signature is present, so a renamed PNG called .mp3 is still a PNG.
    const sniffMp3  = isLikelyMp3(prefix);
    const sniffOgg  = OggParser.isLikelyOgg(prefix);
    const sniffWav  = WavParser.isLikelyWav(prefix);
    const sniffAiff = AiffParser.isLikelyAiff(prefix);
    const sniffFlac = FlacParser.isLikelyFlac(prefix);
    const sniffPng  = PngParser.isLikelyPng(prefix);
    const sniffJpeg = JpegParser.isLikelyJpeg(prefix);
    const sniffWebp = WebpParser.isLikelyWebp(prefix);
    const sniffBmp  = BmpParser.isLikelyBmp(prefix);
    const sniffTiff = TiffParser.isLikelyTiff(prefix);
    const sniffHeif = HeifParser.isLikelyHeif(prefix);
    const sniffMp4  = !sniffHeif && Mp4Parser.isLikelyMp4(prefix);
    const sniffMov  = !sniffHeif && !sniffMp4 && isLikelyMov(prefix);
    const sniffWebm = WebmParser.isLikelyWebm(prefix);
    const hasSignature = sniffMp3 || sniffOgg || sniffWav || sniffAiff || sniffFlac ||
      sniffPng || sniffJpeg || sniffWebp || sniffBmp || sniffTiff || sniffHeif ||
      sniffMov || sniffMp4 || sniffWebm;

    const likelyMp3  = sniffMp3  || (!hasSignature && ext === "mp3");
    const likelyOgg  = sniffOgg  || (!hasSignature && ext === "ogg");
    const likelyWav  = sniffWav  || (!hasSignature && ext === "wav");
    const likelyAiff = sniffAiff || (!hasSignature && ["aif","aiff","aifc"].includes(ext));
    const likelyFlac = sniffFlac || (!hasSignature && ext === "flac");
    const likelyPng  = sniffPng  || (!hasSignature && ext === "png");
    const likelyJpeg = sniffJpeg || (!hasSignature && ["jpg","jpeg"].includes(ext));
    const likelyWebp = sniffWebp || (!hasSignature && ext === "webp");
    const likelyBmp  = sniffBmp  || (!hasSignature && ext === "bmp");
    const likelyTiff = sniffTiff || (!hasSignature && ["tif","tiff"].includes(ext));
    const likelyHeif = sniffHeif || (!hasSignature && ["heic","heif","avif"].includes(ext));
    const likelyMp4  = sniffMp4  || (!hasSignature && ["mp4","m4a"].includes(ext));
    const likelyMov  = sniffMov  || (!hasSignature && ext === "mov");
    const likelyWebm = sniffWebm || (!hasSignature && ext === "webm");

    const anyKnown = likelyMp3 || likelyOgg || likelyWav || likelyAiff || likelyFlac ||
                     likelyPng || likelyJpeg || likelyWebp || likelyBmp || likelyTiff ||
                     likelyHeif || likelyMov || likelyMp4 || likelyWebm;

    if (!anyKnown) {
      return ProbeResult({
        input, mimeType: mimeTypeByExtension(ext), extension: ext,
        mediaType: mediaTypeByExtension(ext), tags: { sizeBytes: String(size) },
      });
    }

    let bytes;
    try {
      bytes = fs.readFileSync(input);
    } catch (e) {
      throw new CodecMediaException(`Failed to probe file: ${input}`, e);
    }

    // ── MP3 ─────────────────────────────────────────────────────────────────
    if (likelyMp3) {
      if (bytes.length >= 4) {
        try {
          const Mp3Codec = requireParser("Mp3Codec");
          if (Mp3Codec) {
            const info = Mp3Codec.decode(bytes, input);
            return ProbeResult({
              input, mimeType: "audio/mpeg", extension: "mp3", mediaType: MediaType.AUDIO,
              durationMillis: info.durationMillis,
              streams: [StreamInfo({ index: 0, kind: StreamKind.AUDIO, codec: info.codec,
                bitrateKbps: info.bitrateKbps, sampleRate: info.sampleRate, channels: info.channels })],
              tags: { sizeBytes: String(size), bitrateMode: info.bitrateMode },
            });
          }
        } catch (e) {
          if (this._options.strictProbe) throw e;
        }
      }
      return ProbeResult({ input, mimeType: "audio/mpeg", extension: "mp3",
        mediaType: MediaType.AUDIO, tags: { sizeBytes: String(size) } });
    }

    // ── OGG ─────────────────────────────────────────────────────────────────
    if (likelyOgg) {
      try {
        const info = OggCodec.decode(bytes, input);
        return ProbeResult({
          input, mimeType: "audio/ogg", extension: "ogg", mediaType: MediaType.AUDIO,
          durationMillis: info.durationMillis,
          streams: [StreamInfo({ index: 0, kind: StreamKind.AUDIO, codec: info.codec,
            bitrateKbps: info.bitrateKbps, sampleRate: info.sampleRate, channels: info.channels })],
          tags: { sizeBytes: String(size), bitrateMode: info.bitrateMode },
        });
      } catch (e) {
        if (this._options.strictProbe) throw e;
      }
      return ProbeResult({ input, mimeType: "audio/ogg", extension: "ogg",
        mediaType: MediaType.AUDIO, tags: { sizeBytes: String(size) } });
    }

    // ── WAV ─────────────────────────────────────────────────────────────────
    if (likelyWav) {
      try {
        const info = WavCodec.decode(bytes, input);
        return ProbeResult({
          input, mimeType: "audio/wav", extension: "wav", mediaType: MediaType.AUDIO,
          durationMillis: info.durationMillis,
          streams: [StreamInfo({ index: 0, kind: StreamKind.AUDIO, codec: info.codec,
            bitrateKbps: info.bitrateKbps, sampleRate: info.sampleRate, channels: info.channels })],
          tags: { sizeBytes: String(size), bitrateMode: info.bitrateMode, bitsPerSample: String(info.bitsPerSample) },
        });
      } catch (e) {
        if (this._options.strictProbe) throw e;
      }
      return ProbeResult({ input, mimeType: "audio/wav", extension: "wav",
        mediaType: MediaType.AUDIO, tags: { sizeBytes: String(size) } });
    }

    // ── AIFF ────────────────────────────────────────────────────────────────
    if (likelyAiff) {
      const aiffExt = ext === "aif" ? "aif" : ext === "aifc" ? "aifc" : "aiff";
      try {
        const AiffCodec = requireParser("AiffCodec");
        if (AiffCodec) {
          const info = AiffCodec.decode(bytes, input);
          return ProbeResult({
            input, mimeType: "audio/aiff", extension: aiffExt, mediaType: MediaType.AUDIO,
            durationMillis: info.durationMillis,
            streams: [StreamInfo({ index: 0, kind: StreamKind.AUDIO, codec: "pcm",
              bitrateKbps: info.bitrateKbps, sampleRate: info.sampleRate, channels: info.channels })],
            tags: { sizeBytes: String(size), bitrateMode: info.bitrateMode },
          });
        }
      } catch (e) {
        if (this._options.strictProbe) throw e;
      }
      return ProbeResult({ input, mimeType: "audio/aiff", extension: aiffExt,
        mediaType: MediaType.AUDIO, tags: { sizeBytes: String(size) } });
    }

    // ── FLAC ────────────────────────────────────────────────────────────────
    if (likelyFlac) {
      try {
        const FlacCodec = requireParser("FlacCodec");
        if (FlacCodec) {
          const info = FlacCodec.decode(bytes, input);
          return ProbeResult({
            input, mimeType: "audio/flac", extension: "flac", mediaType: MediaType.AUDIO,
            durationMillis: info.durationMillis,
            streams: [StreamInfo({ index: 0, kind: StreamKind.AUDIO, codec: info.codec,
              bitrateKbps: info.bitrateKbps, sampleRate: info.sampleRate, channels: info.channels })],
            tags: { sizeBytes: String(size), bitrateMode: info.bitrateMode,
              bitsPerSample: String(info.bitsPerSample) },
          });
        }
      } catch (e) {
        if (this._options.strictProbe) throw e;
      }
      return ProbeResult({ input, mimeType: "audio/flac", extension: "flac",
        mediaType: MediaType.AUDIO, tags: { sizeBytes: String(size) } });
    }

    // ── PNG ─────────────────────────────────────────────────────────────────
    if (likelyPng) {
      try {
        const PngParser = requireParser("PngParser");
        if (PngParser) {
          const info = PngParser.parse(bytes);
          return ProbeResult({
            input, mimeType: "image/png", extension: "png", mediaType: MediaType.IMAGE,
            streams: [StreamInfo({ index: 0, kind: StreamKind.VIDEO, codec: "png",
              width: info.width, height: info.height })],
            tags: { sizeBytes: String(size), bitDepth: String(info.bitDepth),
              colorType: String(info.colorType) },
          });
        }
      } catch (e) {
        if (this._options.strictProbe) throw e;
      }
      return ProbeResult({ input, mimeType: "image/png", extension: "png",
        mediaType: MediaType.IMAGE, tags: { sizeBytes: String(size) } });
    }

    // ── JPEG ────────────────────────────────────────────────────────────────
    if (likelyJpeg) {
      const jpegExt = ext === "jpeg" ? "jpeg" : "jpg";
      try {
        const JpegParser = requireParser("JpegParser");
        if (JpegParser) {
          const info = JpegParser.parse(bytes);
          return ProbeResult({
            input, mimeType: "image/jpeg", extension: jpegExt, mediaType: MediaType.IMAGE,
            streams: [StreamInfo({ index: 0, kind: StreamKind.VIDEO, codec: "jpeg",
              width: info.width, height: info.height })],
            tags: { sizeBytes: String(size), bitsPerSample: String(info.bitsPerSample),
              channels: String(info.channels) },
          });
        }
      } catch (e) {
        if (this._options.strictProbe) throw e;
      }
      return ProbeResult({ input, mimeType: "image/jpeg", extension: jpegExt,
        mediaType: MediaType.IMAGE, tags: { sizeBytes: String(size) } });
    }

    // ── WebP ────────────────────────────────────────────────────────────────
    if (likelyWebp) {
      try {
        const WebpParser = requireParser("WebpParser");
        if (WebpParser) {
          const info = WebpParser.parse(bytes);
          const tags = { sizeBytes: String(size) };
          if (info.bitDepth != null) tags.bitDepth = String(info.bitDepth);
          return ProbeResult({
            input, mimeType: "image/webp", extension: "webp", mediaType: MediaType.IMAGE,
            streams: [StreamInfo({ index: 0, kind: StreamKind.VIDEO, codec: "webp",
              width: info.width, height: info.height })],
            tags,
          });
        }
      } catch (e) {
        if (this._options.strictProbe) throw e;
      }
      return ProbeResult({ input, mimeType: "image/webp", extension: "webp",
        mediaType: MediaType.IMAGE, tags: { sizeBytes: String(size) } });
    }

    // ── BMP ─────────────────────────────────────────────────────────────────
    if (likelyBmp) {
      try {
        const BmpParser = requireParser("BmpParser");
        if (BmpParser) {
          const info = BmpParser.parse(bytes);
          return ProbeResult({
            input, mimeType: "image/bmp", extension: "bmp", mediaType: MediaType.IMAGE,
            streams: [StreamInfo({ index: 0, kind: StreamKind.VIDEO, codec: "bmp",
              width: info.width, height: info.height })],
            tags: { sizeBytes: String(size), bitsPerPixel: String(info.bitsPerPixel) },
          });
        }
      } catch (e) {
        if (this._options.strictProbe) throw e;
      }
      return ProbeResult({ input, mimeType: "image/bmp", extension: "bmp",
        mediaType: MediaType.IMAGE, tags: { sizeBytes: String(size) } });
    }

    // ── TIFF ────────────────────────────────────────────────────────────────
    if (likelyTiff) {
      const tiffExt = ext === "tiff" ? "tiff" : "tif";
      try {
        const TiffParser = requireParser("TiffParser");
        if (TiffParser) {
          const info = TiffParser.parse(bytes);
          const tags = { sizeBytes: String(size) };
          if (info.bitDepth != null) tags.bitDepth = String(info.bitDepth);
          return ProbeResult({
            input, mimeType: "image/tiff", extension: tiffExt, mediaType: MediaType.IMAGE,
            streams: [StreamInfo({ index: 0, kind: StreamKind.VIDEO, codec: "tiff",
              width: info.width, height: info.height })],
            tags,
          });
        }
      } catch (e) {
        if (this._options.strictProbe) throw e;
      }
      return ProbeResult({ input, mimeType: "image/tiff", extension: tiffExt,
        mediaType: MediaType.IMAGE, tags: { sizeBytes: String(size) } });
    }

    // ── HEIF / HEIC / AVIF ──────────────────────────────────────────────────
    if (likelyHeif) {
      let heifExt = ext === "heif" ? "heif" : ext === "avif" ? "avif" : "heic";
      let mimeType = `image/${heifExt}`;
      try {
        const HeifParser = requireParser("HeifParser");
        if (HeifParser) {
          const info = HeifParser.parse(bytes);
          const brand = info.majorBrand ?? "";
          if (brand === "avif" || brand === "avis") { heifExt = "avif"; mimeType = "image/avif"; }
          const streams = (info.width != null && info.height != null)
            ? [StreamInfo({ index: 0, kind: StreamKind.VIDEO, codec: heifExt,
                width: info.width, height: info.height })]
            : [];
          const tags = { sizeBytes: String(size), majorBrand: brand };
          if (info.bitDepth != null) tags.bitDepth = String(info.bitDepth);
          return ProbeResult({ input, mimeType, extension: heifExt,
            mediaType: MediaType.IMAGE, streams, tags });
        }
      } catch (e) {
        if (this._options.strictProbe) throw e;
      }
      return ProbeResult({ input, mimeType, extension: heifExt,
        mediaType: MediaType.IMAGE, tags: { sizeBytes: String(size) } });
    }

    // ── MOV ─────────────────────────────────────────────────────────────────
    if (likelyMov) {
      try {
        const MovCodec = requireParser("MovCodec") ?? Mp4Codec;
        if (MovCodec) {
          const info = MovCodec.decode(bytes, input);
          const tags = { sizeBytes: String(size) };
          if (info.majorBrand?.trim())         tags.majorBrand         = info.majorBrand;
          if (info.videoCodec?.trim())         tags.videoCodec         = info.videoCodec;
          if (info.audioCodec?.trim())         tags.audioCodec         = info.audioCodec;
          if (info.displayAspectRatio?.trim()) tags.displayAspectRatio = info.displayAspectRatio;
          if (info.bitDepth > 0)               tags.bitDepth           = String(info.bitDepth);
          if (info.videoBitrateKbps > 0)       tags.videoBitrateKbps   = String(info.videoBitrateKbps);
          if (info.audioBitrateKbps > 0)       tags.audioBitrateKbps   = String(info.audioBitrateKbps);
          const streams = [];
          if (info.width > 0 && info.height > 0) {
            streams.push(StreamInfo({ index: 0, kind: StreamKind.VIDEO,
              codec: info.videoCodec ?? "unknown", bitrateKbps: info.videoBitrateKbps,
              width: info.width, height: info.height, frameRate: info.frameRate }));
          }
          if (info.sampleRate > 0 && info.channels > 0) {
            streams.push(StreamInfo({ index: streams.length, kind: StreamKind.AUDIO,
              codec: info.audioCodec ?? "unknown", bitrateKbps: info.audioBitrateKbps,
              sampleRate: info.sampleRate, channels: info.channels }));
          }
          return ProbeResult({ input, mimeType: "video/quicktime", extension: "mov",
            mediaType: MediaType.VIDEO, durationMillis: info.durationMillis, streams, tags });
        }
      } catch (e) {
        if (this._options.strictProbe) throw e;
      }
      return ProbeResult({ input, mimeType: "video/quicktime", extension: "mov",
        mediaType: MediaType.VIDEO, tags: { sizeBytes: String(size) } });
    }

    // ── MP4 / M4A ───────────────────────────────────────────────────────────
    if (likelyMp4) {
      const mp4Ext    = ext === "m4a" ? "m4a" : "mp4";
      const mp4Mime   = mp4Ext === "m4a" ? "audio/mp4" : "video/mp4";
      const mp4Media  = mp4Ext === "m4a" ? MediaType.AUDIO : MediaType.VIDEO;
      try {
        const info = Mp4Codec.decode(bytes, input);
        const tags = { sizeBytes: String(size) };
        if (info.majorBrand?.trim())         tags.majorBrand         = info.majorBrand;
        if (info.videoCodec?.trim())         tags.videoCodec         = info.videoCodec;
        if (info.audioCodec?.trim())         tags.audioCodec         = info.audioCodec;
        if (info.displayAspectRatio?.trim()) tags.displayAspectRatio = info.displayAspectRatio;
        if (info.bitDepth > 0)               tags.bitDepth           = String(info.bitDepth);
        if (info.videoBitrateKbps > 0)       tags.videoBitrateKbps   = String(info.videoBitrateKbps);
        if (info.audioBitrateKbps > 0)       tags.audioBitrateKbps   = String(info.audioBitrateKbps);
        const streams = [];
        if (mp4Media === MediaType.VIDEO && info.width > 0 && info.height > 0) {
          streams.push(StreamInfo({ index: 0, kind: StreamKind.VIDEO,
            codec: info.videoCodec ?? "unknown", bitrateKbps: info.videoBitrateKbps,
            width: info.width, height: info.height, frameRate: info.frameRate }));
        }
        if (info.sampleRate > 0 && info.channels > 0) {
          streams.push(StreamInfo({ index: streams.length, kind: StreamKind.AUDIO,
            codec: info.audioCodec ?? "unknown", bitrateKbps: info.audioBitrateKbps,
            sampleRate: info.sampleRate, channels: info.channels }));
        }
        return ProbeResult({ input, mimeType: mp4Mime, extension: mp4Ext,
          mediaType: mp4Media, durationMillis: info.durationMillis, streams, tags });
      } catch (e) {
        if (this._options.strictProbe) throw e;
      }
      return ProbeResult({ input, mimeType: mp4Mime, extension: mp4Ext,
        mediaType: mp4Media, tags: { sizeBytes: String(size) } });
    }

    // ── WebM ────────────────────────────────────────────────────────────────
    if (likelyWebm) {
      try {
        const info = WebmCodec.decodeBytes(bytes, input);
        const tags = { sizeBytes: String(size) };
        if (info.videoCodec?.trim())         tags.videoCodec         = info.videoCodec;
        if (info.audioCodec?.trim())         tags.audioCodec         = info.audioCodec;
        if (info.displayAspectRatio?.trim()) tags.displayAspectRatio = info.displayAspectRatio;
        if (info.bitDepth > 0)               tags.bitDepth           = String(info.bitDepth);
        if (info.videoBitrateKbps > 0)       tags.videoBitrateKbps   = String(info.videoBitrateKbps);
        if (info.audioBitrateKbps > 0)       tags.audioBitrateKbps   = String(info.audioBitrateKbps);
        const streams = [];
        if (info.width > 0 && info.height > 0) {
          streams.push(StreamInfo({ index: 0, kind: StreamKind.VIDEO,
            codec: info.videoCodec ?? "unknown", bitrateKbps: info.videoBitrateKbps,
            width: info.width, height: info.height, frameRate: info.frameRate }));
        }
        if (info.sampleRate > 0 && info.channels > 0) {
          streams.push(StreamInfo({ index: streams.length, kind: StreamKind.AUDIO,
            codec: info.audioCodec ?? "unknown", bitrateKbps: info.audioBitrateKbps,
            sampleRate: info.sampleRate, channels: info.channels }));
        }
        return ProbeResult({ input, mimeType: "video/webm", extension: "webm",
          mediaType: MediaType.VIDEO, durationMillis: info.durationMillis, streams, tags });
      } catch (e) {
        if (this._options.strictProbe) throw e;
      }
      return ProbeResult({ input, mimeType: "video/webm", extension: "webm",
        mediaType: MediaType.VIDEO, tags: { sizeBytes: String(size) } });
    }

    return ProbeResult({ input, mimeType: mimeTypeByExtension(ext), extension: ext,
      mediaType: mediaTypeByExtension(ext), tags: { sizeBytes: String(size) } });
  }

  // ── readMetadata ───────────────────────────────────────────────────────────

  /** @param {string} input @returns {import("../model/Metadata.js").Metadata} */
  readMetadata(input) {
    ensureExists(input);
    const probe   = this.probe(input);
    const entries = {
      mimeType:  probe.mimeType,
      extension: probe.extension,
      mediaType: probe.mediaType,
    };
    Object.assign(entries, readEmbeddedMetadata(input, normalizeExt(probe.extension)));

    const sidecar = sidecarPath(input);
    if (fs.existsSync(sidecar)) {
      try {
        const raw = fs.readFileSync(sidecar, "utf8");
        for (const line of raw.split(/\r?\n/)) {
          if (!line || line.startsWith("#")) continue;
          const eq = findPropertiesSeparator(line);
          if (eq < 0) continue;
          const k = unescapeProps(line.slice(0, eq).trim());
          const v = unescapeProps(line.slice(eq + 1).trim());
          if (k && !(k in entries)) entries[k] = v;  // putIfAbsent
        }
      } catch (e) {
        throw new CodecMediaException(`Failed to read metadata sidecar: ${sidecar}`, e);
      }
    }

    return Metadata({ entries });
  }

  // ── writeMetadata ──────────────────────────────────────────────────────────

  /** @param {string} input @param {import("../model/Metadata.js").Metadata} metadata */
  writeMetadata(input, metadata) {
    ensureExists(input);
    if (!metadata?.entries) throw new CodecMediaException("Metadata is required");

    for (const [k, v] of Object.entries(metadata.entries)) {
      if (!k?.trim()) throw new CodecMediaException("Metadata key must not be null/blank");
      if (v == null)  throw new CodecMediaException(`Metadata value must not be null for key: ${k}`);
    }

    // Route embedded metadata by detected content, not by filename alone.
    const detected = this.probe(input);
    const extension = normalizeExt(detected.extension) || normalizeExt(extractExtension(input));
    if (extension === "wav") {
      try {
        const withMetadata = WavParser.writeInfoMetadata(fs.readFileSync(input), metadata.entries);
        writeFileAtomically(input, withMetadata);
        deleteSidecarIfExists(input);
        return;
      } catch (e) {
        if (e instanceof CodecMediaException) throw e;
        throw new CodecMediaException(`Failed to write WAV metadata: ${input}`, e);
      }
    }

    if (["aif", "aiff", "aifc"].includes(extension)) {
      try {
        const withMetadata = AiffParser.writeTextMetadata(fs.readFileSync(input), metadata.entries);
        writeFileAtomically(input, withMetadata);
        deleteSidecarIfExists(input);
        return;
      } catch (e) {
        if (e instanceof CodecMediaException) throw e;
        throw new CodecMediaException(`Failed to write AIFF metadata: ${input}`, e);
      }
    }

    if (extension === "mp3") {
      try {
        const withTag = Mp3Id3v1Tag.write(fs.readFileSync(input), metadata.entries);
        writeFileAtomically(input, withTag);
        deleteSidecarIfExists(input);
        return;
      } catch (e) {
        if (e instanceof CodecMediaException) throw e;
        throw new CodecMediaException(`Failed to write MP3 metadata: ${input}`, e);
      }
    }

    const sorted  = Object.keys(metadata.entries).sort();
    const lines   = ["# CodecMedia metadata sidecar", `# ${new Date().toISOString()}`];
    for (const k of sorted) {
      const v = metadata.entries[k];
      lines.push(`${escapeProps(k)}=${escapeProps(v)}`);
    }

    const sidecar = sidecarPath(input);
    try {
      writeFileAtomically(sidecar, Buffer.from(lines.join("\n") + "\n", "utf8"));
    } catch (e) {
      throw new CodecMediaException(`Failed to write metadata sidecar: ${sidecar}`, e);
    }
  }

  // ── extractAudio ───────────────────────────────────────────────────────────

  /**
   * @param {string} input
   * @param {string} outputDir
   * @param {import("../options/AudioExtractOptions.js").AudioExtractOptions|null} options
   * @returns {import("../model/ExtractionResult.js").ExtractionResult}
   */
  extractAudio(input, outputDir, options) {
    ensureExists(input);
    if (!outputDir) throw new CodecMediaException("Output directory is required");

    const probe = this.probe(input);
    if (probe.mediaType !== MediaType.AUDIO && probe.mediaType !== MediaType.VIDEO) {
      throw new CodecMediaException(`Input has no extractable audio media type: ${input}`);
    }

    const srcExt = normalizeExt(probe.extension) || normalizeExt(extractExtension(input));
    const effective = options ?? AudioExtractOptions.defaults(
      probe.mediaType === MediaType.VIDEO ? "m4a" : srcExt
    );
    const reqExt = normalizeExt(effective.targetFormat) ||
      (probe.mediaType === MediaType.VIDEO ? "m4a" : srcExt);

    try {
      fs.mkdirSync(outputDir, { recursive: true });
      const base = baseName(path.basename(input));
      const outputFile = path.join(outputDir, `${base}_audio.${reqExt}`);

      if (probe.mediaType === MediaType.AUDIO && reqExt === srcExt) {
        fs.copyFileSync(input, outputFile);
        return ExtractionResult({ outputFile, format: srcExt });
      }

      // Reuse the normal conversion routes. MP4/MOV -> M4A can use the
      // dependency-free remuxer; other extraction/transcode routes can use the
      // optional FFmpeg bridge when enabled.
      this.convert(input, outputFile, {
        targetFormat: reqExt,
        preset: "balanced",
        overwrite: true,
        audioBitrateKbps: effective.bitrateKbps,
        streamIndex: effective.streamIndex,
      });
      return ExtractionResult({ outputFile, format: reqExt });
    } catch (e) {
      if (e instanceof CodecMediaException) throw e;
      throw new CodecMediaException(`Failed to extract audio: ${input}`, e);
    }
  }

  // ── convert ────────────────────────────────────────────────────────────────

  /**
   * @param {string} input
   * @param {string} output
   * @param {import("../options/ConversionOptions.js").ConversionOptions|null} options
   * @returns {import("../model/ConversionResult.js").ConversionResult}
   */
  convert(input, output, options) {
    ensureExists(input);
    if (!output) throw new CodecMediaException("Output file is required");

    const sourceProbe     = this.probe(input);
    const srcExt          = normalizeExt(sourceProbe.extension) || normalizeExt(extractExtension(input));
    const inferredTarget  = extractExtension(output);
    const effective       = options ?? ConversionOptions.defaults(inferredTarget);

    if (!effective.targetFormat?.trim())
      throw new CodecMediaException("ConversionOptions.targetFormat is required");

    const reqExt         = normalizeExt(effective.targetFormat);
    const outputExt      = normalizeExt(extractExtension(output));
    if (outputExt && reqExt !== outputExt) {
      throw new CodecMediaException(
        `Output extension must match target format: expected .${reqExt} but got .${outputExt}`
      );
    }

    const targetMedia    = mediaTypeByExtension(reqExt);

    if (!this._conversionHub) {
      throw new CodecMediaException(
        `ConversionHub not available. Cannot convert '${srcExt}' → '${reqExt}'`
      );
    }

    return this._conversionHub.convert({
      input, output,
      sourceExtension: srcExt,
      targetExtension: reqExt,
      sourceMediaType: sourceProbe.mediaType,
      targetMediaType: targetMedia,
      options: effective,
    });
  }

  // ── play ───────────────────────────────────────────────────────────────────

  /**
   * @param {string} input
   * @param {import("../options/PlaybackOptions.js").PlaybackOptions|null} options
   * @returns {import("../model/PlaybackResult.js").PlaybackResult}
   */
  play(input, options) {
    ensureExists(input);
    const probe     = this.probe(input);
    const effective = options ?? PlaybackOptions.defaults();

    if (probe.mediaType === MediaType.UNKNOWN)
      throw new CodecMediaException(`Playback is not supported for unknown media type: ${input}`);

    if (effective.dryRun) {
      return PlaybackResult({
        started: true, backend: "dry-run",
        mediaType: probe.mediaType, message: "Playback simulation successful",
      });
    }

    if (effective.allowExternalApp) {
      try {
        openWithSystem(input);
        return PlaybackResult({
          started: true, backend: "system-open",
          mediaType: probe.mediaType, message: "Opened with system default application",
        });
      } catch (e) {
        throw new CodecMediaException(`Failed to open media with system player/viewer: ${input}`, e);
      }
    }

    throw new CodecMediaException(
      "No playback backend available. Try dryRun=true or allowExternalApp=true"
    );
  }

  // ── validate ───────────────────────────────────────────────────────────────

  /**
   * @param {string} input
   * @param {import("../options/ValidationOptions.js").ValidationOptions|null} options
   * @returns {import("../model/ValidationResult.js").ValidationResult}
   */
  validate(input, options) {
    if (input == null) {
      return ValidationResult({ valid: false, errors: ["Input file is required"] });
    }

    const effective = options ?? ValidationOptions.defaults();

    if (!fs.existsSync(input)) {
      return ValidationResult({ valid: false, errors: [`File does not exist: ${input}`] });
    }

    try {
      const stat = fs.statSync(input);
      if (!stat.isFile()) {
        return ValidationResult({ valid: false, errors: [`Input must be a regular file: ${input}`] });
      }
      const size = stat.size;

      if (effective.maxBytes > 0 && size > effective.maxBytes) {
        return ValidationResult({
          valid: false,
          errors: [`File exceeds maxBytes: ${size} > ${effective.maxBytes}`],
        });
      }

      if (effective.strict) {
        if (size > STRICT_VALIDATION_MAX_BYTES) {
          return ValidationResult({
            valid: false,
            errors: [`Strict validation is limited to files <= ${STRICT_VALIDATION_MAX_BYTES} bytes`],
          });
        }

        const ext   = extractExtension(input);
        const bytes = fs.readFileSync(input);
        const err   = runStrictParser(ext, bytes);
        if (err) return ValidationResult({ valid: false, errors: [err] });
      }

      return ValidationResult({ valid: true });
    } catch (e) {
      return ValidationResult({ valid: false, errors: [`Failed to validate file: ${e.message}`] });
    }
  }
}

// ─── Strict parser dispatch ───────────────────────────────────────────────────

/**
 * Run the strict parser for a given extension.
 * Returns an error string on failure, or null on success.
 * @param {string} ext
 * @param {Buffer} bytes
 * @returns {string|null}
 */
function runStrictParser(ext, bytes) {
  const parserKey = parserKeyBySignature(bytes) ?? parserKeyForExt(ext);
  if (parserKey == null) return null;
  try {
    const parser = requireParser(parserKey);
    if (!parser) return `Strict validation is not available for ${ext || "detected format"}`;
    const parseMethod = parser.parse ?? parser.decode;
    if (typeof parseMethod !== "function") {
      return `Strict validation parser has no parse/decode method: ${parserKey}`;
    }
    parseMethod.call(parser, bytes);
    return null;
  } catch (e) {
    return `Strict validation failed for ${ext || parserKey}: ${e.message}`;
  }
}

function parserKeyBySignature(bytes) {
  if (Mp3Parser.isLikelyMp3?.(bytes) || isLikelyMp3(bytes)) return "Mp3Parser";
  if (OggParser.isLikelyOgg(bytes)) return "OggParser";
  if (WavParser.isLikelyWav(bytes)) return "WavParser";
  if (AiffParser.isLikelyAiff(bytes)) return "AiffParser";
  if (FlacParser.isLikelyFlac(bytes)) return "FlacParser";
  if (PngParser.isLikelyPng(bytes)) return "PngParser";
  if (JpegParser.isLikelyJpeg(bytes)) return "JpegParser";
  if (WebpParser.isLikelyWebp(bytes)) return "WebpParser";
  if (BmpParser.isLikelyBmp(bytes)) return "BmpParser";
  if (TiffParser.isLikelyTiff(bytes)) return "TiffParser";
  if (HeifParser.isLikelyHeif(bytes)) return "HeifParser";
  if (WebmParser.isLikelyWebm(bytes)) return "WebmParser";
  if (Mp4Parser.isLikelyMp4(bytes) || isLikelyMov(bytes)) return "Mp4Parser";
  return null;
}

function parserKeyForExt(ext) {
  const map = {
    mp3: "Mp3Parser", ogg: "OggParser", wav: "WavParser",
    aif: "AiffParser", aiff: "AiffParser", aifc: "AiffParser",
    flac: "FlacParser", png: "PngParser",
    jpg: "JpegParser", jpeg: "JpegParser",
    mov: "Mp4Parser", mp4: "Mp4Parser", m4a: "Mp4Parser",
    webp: "WebpParser", bmp: "BmpParser",
    tif: "TiffParser", tiff: "TiffParser",
    heic: "HeifParser", heif: "HeifParser", avif: "HeifParser",
  };
  return map[ext] ?? null;
}

// Synchronous parser registry (populated as parsers are ported)
const PARSER_REGISTRY = {};

/** Register a parser/codec module synchronously once it's been ported. */
export function registerParser(key, module) {
  PARSER_REGISTRY[key] = module;
}

function requireParser(key) {
  return PARSER_REGISTRY[key] ?? null;
}

// Built-in parser/codec registrations (ported modules)
registerParser("PngParser", PngParser);
registerParser("PngCodec", PngCodec);
registerParser("JpegParser", JpegParser);
registerParser("WebpParser", WebpParser);
registerParser("BmpParser", BmpParser);
registerParser("TiffParser", TiffParser);
registerParser("HeifParser", HeifParser);
registerParser("AiffParser", AiffParser);
registerParser("AiffCodec", AiffCodec);
registerParser("FlacParser", FlacParser);
registerParser("FlacCodec", FlacCodec);
registerParser("Mp3Parser", Mp3Parser);
registerParser("Mp3Codec", Mp3Codec);
registerParser("OggParser", OggParser);
registerParser("OggCodec", OggCodec);
registerParser("Mp4Parser", Mp4Parser);
registerParser("Mp4Codec", Mp4Codec);
registerParser("WavParser", WavParser);
registerParser("WavCodec", WavCodec);
registerParser("WebmParser", WebmParser);
registerParser("WebmCodec", WebmCodec);
registerImageCodec("png", PngCodec);

// ─── Private file helpers ─────────────────────────────────────────────────────

function ensureExists(input) {
  if (input == null)
    throw new CodecMediaException("Input file is required");
  if (!fs.existsSync(input))
    throw new CodecMediaException(`File does not exist: ${input}`);
  if (!fs.statSync(input).isFile())
    throw new CodecMediaException(`Input must be a regular file: ${input}`);
}

function extractExtension(filePath) {
  const name = path.basename(filePath);
  const dot  = name.lastIndexOf(".");
  if (dot < 0 || dot === name.length - 1) return "";
  return name.slice(dot + 1).toLowerCase();
}

function readProbePrefix(filePath) {
  const size     = fs.statSync(filePath).size;
  const toRead   = Math.min(PROBE_PREFIX_BYTES, size);
  if (toRead === 0) return Buffer.alloc(0);
  const fd = fs.openSync(filePath, "r");
  try {
    const buf = Buffer.alloc(toRead);
    fs.readSync(fd, buf, 0, toRead, 0);
    return buf;
  } finally {
    fs.closeSync(fd);
  }
}

function sidecarPath(filePath) {
  return filePath + ".codecmedia.properties";
}

function readEmbeddedMetadata(filePath, extension) {
  try {
    const bytes = fs.readFileSync(filePath);
    switch (extension) {
      case "wav":
        return WavParser.readInfoMetadata(bytes);
      case "aif":
      case "aiff":
      case "aifc":
        return AiffParser.readTextMetadata(bytes);
      case "mp3":
        return Mp3Id3v1Tag.read(bytes);
      case "flac":
        return FlacParser.readVorbisCommentMetadata(bytes);
      case "ogg":
        return OggParser.readCommentMetadata(bytes);
      default:
        return {};
    }
  } catch (e) {
    throw new CodecMediaException(`Failed to read embedded metadata: ${filePath}`, e);
  }
}

function deleteSidecarIfExists(filePath) {
  fs.rmSync(sidecarPath(filePath), { force: true });
}

function writeFileAtomically(target, bytes) {
  const parent = path.dirname(target) || ".";
  fs.mkdirSync(parent, { recursive: true });
  const temp = path.join(parent, `${path.basename(target)}.${process.pid}.${Date.now()}.tmp`);
  let moved = false;
  try {
    fs.writeFileSync(temp, bytes);
    fs.renameSync(temp, target);
    moved = true;
  } finally {
    if (!moved) {
      fs.rmSync(temp, { force: true });
    }
  }
}

function normalizeExt(format) {
  if (!format) return "";
  const v = format.trim().toLowerCase();
  return v.startsWith(".") ? v.slice(1) : v;
}

function baseName(fileName) {
  const dot = fileName.lastIndexOf(".");
  return dot > 0 ? fileName.slice(0, dot) : fileName;
}

// Java Properties-style escape (minimal: newline and backslash)
function escapeProps(s) {
  return String(s)
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/=/g, "\\=");
}

function unescapeProps(s) {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== "\\" || i + 1 >= s.length) {
      out += s[i];
      continue;
    }
    const next = s[++i];
    if (next === "n") out += "\n";
    else if (next === "r") out += "\r";
    else out += next;
  }
  return out;
}

function findPropertiesSeparator(line) {
  let escaped = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === "=") return i;
  }
  return -1;
}

function openWithSystem(filePath) {
  const platform = os.platform();
  let command;
  let args;
  if (platform === "darwin") {
    command = "open";
    args = [filePath];
  } else if (platform === "win32") {
    command = "cmd.exe";
    args = ["/d", "/s", "/c", "start", "", filePath];
  } else {
    command = "xdg-open";
    args = [filePath];
  }
  const result = spawnSync(command, args, { stdio: "ignore", windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} exited with status ${result.status}`);
  }
}

// ─── Byte-level sniff helpers (for formats with no dedicated parser yet) ──────

function isLikelyMp3(b)  {
  if (b.length < 3) return false;
  if (b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) return true; // ID3
  return b.length >= 2 && (b[0] & 0xff) === 0xff && (b[1] & 0xe0) === 0xe0;
}
function isLikelyWav(b)  {
  if (b.length < 12) return false;
  const riff = b.slice(0, 4).toString("ascii");
  if (riff !== "RIFF" && riff !== "RIFX" && riff !== "RF64") return false;
  return b[8]===0x57&&b[9]===0x41&&b[10]===0x56&&b[11]===0x45;
}
function isLikelyAiff(b) { return b.length >= 12 && b[0]===0x46&&b[1]===0x4f&&b[2]===0x52&&b[3]===0x4d && (b[8]===0x41&&b[9]===0x49&&b[10]===0x46&&b[11]===0x46 || b[8]===0x41&&b[9]===0x49&&b[10]===0x46&&b[11]===0x43); }
function isLikelyFlac(b) { return b.length >= 4 && b[0]===0x66&&b[1]===0x4c&&b[2]===0x61&&b[3]===0x43; }
function isLikelyPng(b)  { return b.length >= 8 && b[0]===0x89&&b[1]===0x50&&b[2]===0x4e&&b[3]===0x47&&b[4]===0x0d&&b[5]===0x0a&&b[6]===0x1a&&b[7]===0x0a; }
function isLikelyJpeg(b) { return JpegParser.isLikelyJpeg(b); }
function isLikelyWebp(b) { return b.length >= 12 && b[0]===0x52&&b[1]===0x49&&b[2]===0x46&&b[3]===0x46 && b[8]===0x57&&b[9]===0x45&&b[10]===0x42&&b[11]===0x50; }
function isLikelyBmp(b)  { return b.length >= 2 && b[0]===0x42&&b[1]===0x4d; }
function isLikelyTiff(b) { return b.length >= 4 && ((b[0]===0x49&&b[1]===0x49&&b[2]===0x2a&&b[3]===0x00) || (b[0]===0x4d&&b[1]===0x4d&&b[2]===0x00&&b[3]===0x2a)); }
function isLikelyHeif(b) {
  if (b.length < 12) return false;
  const brand = b.slice(8, 12).toString("ascii");
  return ["heic","heix","heif","mif1","msf1","avif","avis"].includes(brand);
}
function isLikelyMov(b)  {
  if (b.length < 8) return false;
  const t = b.slice(4, 8).toString("ascii");
  return ["ftyp","moov","mdat","free","skip","wide","pnot","cmov"].includes(t);
}
function isLikelyMp4(b)  {
  if (b.length < 8) return false;
  const t = b.slice(4, 8).toString("ascii");
  if (t !== "ftyp") return false;
  const brand = b.slice(8, 12).toString("ascii");
  return isSupportedMp4MajorBrand(brand);
}

function enhanceProbeWithFfprobe(input, nativeProbe, ffprobePath, requireExternalTools = false) {
  const result = spawnSync(ffprobePath, [
    "-v", "error",
    "-show_format",
    "-show_streams",
    "-of", "json",
    input,
  ], {
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 8 * 1024 * 1024,
  });

  if (result.error) {
    if (requireExternalTools) {
      throw new CodecMediaException(`Failed to execute ffprobe (${ffprobePath}): ${result.error.message}`, result.error);
    }
    return nativeProbe;
  }
  if (result.status !== 0) {
    if (requireExternalTools) {
      const detail = String(result.stderr || result.stdout || "ffprobe failed").trim();
      throw new CodecMediaException(`ffprobe failed: ${detail}`);
    }
    return nativeProbe;
  }

  let parsed;
  try {
    parsed = JSON.parse(result.stdout || "{}");
  } catch (e) {
    if (requireExternalTools) throw new CodecMediaException("ffprobe returned invalid JSON", e);
    return nativeProbe;
  }

  const streams = [];
  for (const stream of Array.isArray(parsed.streams) ? parsed.streams : []) {
    const kind = stream.codec_type === "audio"
      ? StreamKind.AUDIO
      : stream.codec_type === "video"
        ? StreamKind.VIDEO
        : null;
    if (kind == null) continue;

    const bitrate = positiveNumber(stream.bit_rate);
    const sampleRate = positiveNumber(stream.sample_rate);
    const channels = positiveNumber(stream.channels);
    const width = positiveNumber(stream.width);
    const height = positiveNumber(stream.height);
    const frameRate = parseFrameRate(stream.avg_frame_rate) ?? parseFrameRate(stream.r_frame_rate);
    streams.push(StreamInfo({
      index: Number.isInteger(Number(stream.index)) ? Number(stream.index) : streams.length,
      kind,
      codec: String(stream.codec_name || stream.codec_long_name || "unknown"),
      bitrateKbps: bitrate == null ? null : Math.round(bitrate / 1000),
      sampleRate,
      channels,
      width,
      height,
      frameRate,
    }));
  }

  const durationSeconds = positiveNumber(parsed?.format?.duration);
  const durationMillis = durationSeconds == null
    ? nativeProbe.durationMillis
    : Math.round(durationSeconds * 1000);
  const tags = { ...nativeProbe.tags };
  if (parsed?.format?.format_name) tags.ffprobeFormat = String(parsed.format.format_name);
  const containerBitrate = positiveNumber(parsed?.format?.bit_rate);
  if (containerBitrate != null) tags.containerBitrateKbps = String(Math.round(containerBitrate / 1000));

  return ProbeResult({
    input: nativeProbe.input,
    mimeType: nativeProbe.mimeType,
    extension: nativeProbe.extension,
    mediaType: nativeProbe.mediaType,
    durationMillis,
    streams: streams.length > 0 ? streams : nativeProbe.streams,
    tags,
  });
}

function positiveNumber(value) {
  if (value == null || value === "" || value === "N/A") return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function parseFrameRate(value) {
  if (value == null || value === "" || value === "0/0") return null;
  if (typeof value === "number") return Number.isFinite(value) && value > 0 ? value : null;
  const text = String(value);
  if (text.includes("/")) {
    const [numText, denText] = text.split("/", 2);
    const num = Number(numText);
    const den = Number(denText);
    if (Number.isFinite(num) && Number.isFinite(den) && num > 0 && den > 0) return num / den;
    return null;
  }
  return positiveNumber(text);
}

// ─── MIME / MediaType maps ─────────────────────────────────────────────────────

function mimeTypeByExtension(ext) {
  const map = {
    mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm",
    m4a: "audio/mp4", mp3: "audio/mpeg", ogg: "audio/ogg",
    wav: "audio/wav", aif: "audio/aiff", aiff: "audio/aiff", aifc: "audio/aiff",
    flac: "audio/flac", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
    webp: "image/webp", bmp: "image/bmp", tif: "image/tiff", tiff: "image/tiff",
    heic: "image/heic", heif: "image/heif", avif: "image/avif",
  };
  return map[ext] ?? "application/octet-stream";
}

function mediaTypeByExtension(ext) {
  const n = normalizeExt(ext);
  if (["mp3","ogg","wav","aif","aiff","aifc","pcm","m4a","aac","flac"].includes(n)) return MediaType.AUDIO;
  if (["mp4","mkv","mov","avi","webm"].includes(n)) return MediaType.VIDEO;
  if (["png","jpg","jpeg","gif","bmp","webp","tif","tiff","heic","heif","avif"].includes(n)) return MediaType.IMAGE;
  return MediaType.UNKNOWN;
}
