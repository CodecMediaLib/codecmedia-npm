import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import { CodecMediaException } from "../../CodecMediaException.js";
import { ConversionResult } from "../../model/ConversionResult.js";
import { ConversionRoute } from "./ConversionRoute.js";
import { ConversionRouteResolver } from "./ConversionRouteResolver.js";

/**
 * Optional synchronous FFmpeg bridge. Nothing is downloaded or required by
 * default; callers explicitly opt in and may provide a custom ffmpegPath.
 */
export class FfmpegConverter {
  constructor({ ffmpegPath = "ffmpeg" } = {}) {
    this.ffmpegPath = ffmpegPath;
  }

  convert(request) {
    const { input, output, options } = request;
    const route = ConversionRouteResolver.resolve(request.sourceMediaType, request.targetMediaType);
    if (route === ConversionRoute.UNSUPPORTED) {
      throw new CodecMediaException(
        `Unsupported FFmpeg conversion route: ${request.sourceMediaType} -> ${request.targetMediaType}`
      );
    }

    const parent = path.dirname(output);
    if (parent) fs.mkdirSync(parent, { recursive: true });
    if (fs.existsSync(output) && !options.overwrite) {
      throw new CodecMediaException(`Output already exists and overwrite is disabled: ${output}`);
    }

    const args = ["-nostdin", "-hide_banner", "-loglevel", "error", options.overwrite ? "-y" : "-n", "-i", input];
    switch (route) {
      case ConversionRoute.VIDEO_TO_AUDIO:
        if (Number.isInteger(options.streamIndex) && options.streamIndex >= 0) {
          args.push("-map", `0:a:${options.streamIndex}`);
        }
        args.push("-vn");
        if (Number.isFinite(options.audioBitrateKbps) && options.audioBitrateKbps > 0) {
          args.push("-b:a", `${Math.round(options.audioBitrateKbps)}k`);
        }
        break;
      case ConversionRoute.AUDIO_TO_AUDIO:
        if (Number.isFinite(options.audioBitrateKbps) && options.audioBitrateKbps > 0) {
          args.push("-b:a", `${Math.round(options.audioBitrateKbps)}k`);
        }
        break;
      case ConversionRoute.AUDIO_TO_IMAGE:
        // Album-art extraction, not waveform generation.
        args.push("-map", "0:v:0", "-frames:v", "1");
        break;
      case ConversionRoute.IMAGE_TO_IMAGE:
        args.push("-frames:v", "1");
        break;
      default:
        break;
    }
    if (request.targetExtension === "pcm") {
      args.push("-f", "s16le", "-acodec", "pcm_s16le");
    }
    args.push(output);

    const result = spawnSync(this.ffmpegPath, args, {
      encoding: "utf8",
      windowsHide: true,
      maxBuffer: 8 * 1024 * 1024,
    });
    if (result.error) {
      throw new CodecMediaException(`Failed to execute FFmpeg (${this.ffmpegPath}): ${result.error.message}`, result.error);
    }
    if (result.status !== 0) {
      const detail = String(result.stderr || result.stdout || "FFmpeg conversion failed").trim();
      throw new CodecMediaException(`FFmpeg conversion failed: ${detail}`);
    }
    if (!fs.existsSync(output)) {
      throw new CodecMediaException(`FFmpeg completed without creating output: ${output}`);
    }

    return ConversionResult({
      outputFile: output,
      format: request.targetExtension,
      reencoded: true,
    });
  }
}
