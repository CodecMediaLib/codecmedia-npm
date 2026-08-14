# CodecMedia

[![npm version](https://img.shields.io/npm/v/codecmedia.svg)](https://www.npmjs.com/package/codecmedia)
[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-43853D?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Java Version](https://img.shields.io/badge/Java%20Version-codecmedia--java-007396?logo=openjdk&logoColor=white)](https://github.com/TamKungZ/codecmedia-java)

CodecMedia is the Node.js implementation of the CodecMedia media engine. It keeps the default runtime synchronous and dependency-free while providing real probing, validation, metadata handling, lightweight container operations, and optional FFmpeg/ffprobe integration for jobs that cannot be implemented reasonably with a small pure-JavaScript core.

<p align="center">
  <img src="https://pub-df28fb9f69aa4326a1c6e10fb1f2abdc.r2.dev/assets-image/codecmedia/CodecMedia_Full_Logo.png" width="70%" alt="CodecMedia Logo">
</p>

## Status

- Package version: `1.2.0`
- Runtime: Node.js 18+
- Required runtime dependencies: none
- Optional external tools: `ffmpeg`, `ffprobe`
- Default engine: `CodecMedia.createDefault()`
- Test status for this source tree: `11/11` passing with `npm test`

## Install

```bash
npm install codecmedia
```

## Quick Start

```js
import { CodecMedia } from "codecmedia";

const media = CodecMedia.createDefault();
const result = media.probe("./sample.ogg");

console.log(result.mediaType);
console.log(result.durationMillis);
console.log(result.streams);
```

The default engine never downloads or requires FFmpeg.

For real transcoding and richer probing on machines that already have FFmpeg installed:

```js
const media = CodecMedia.createDefault({
  enableFfmpegConversion: true,
  enableFfprobeEnhancement: true,
});
```

Custom binary paths are supported with `ffmpegPath` and `ffprobePath`.

## Probe

`probe(input)` and its alias `get(input)` inspect content signatures before trusting the filename extension. Renaming a PNG to `.mp3`, for example, does not make the engine route it through the MP3 parser.

Native parsers currently cover:

| Format | Native probe behavior |
| --- | --- |
| MP3 | MPEG Layer III frames, duration estimate, bitrate mode, sample rate, channels |
| OGG | Vorbis/Opus identification, logical stream/page checks, duration, bitrate, comments |
| WAV | RIFF/RIFX/RF64, PCM/float/extensible validation, duration, bitrate |
| AIFF/AIF/AIFC | COMM parsing, duration and PCM information |
| FLAC | STREAMINFO, duration, sample rate, channels, bits per sample |
| PNG | IHDR dimensions and strict bit-depth/color-type validation |
| JPEG/JPG | SOF dimensions, precision and channels |
| WebP | VP8/VP8L/VP8X dimensions |
| BMP | DIB dimensions and bits per pixel |
| TIFF/TIF | IFD dimensions and bit-depth hint |
| HEIC/HEIF/AVIF | BMFF brand, dimensions and bit depth when available |
| MP4/M4A | BMFF duration, audio/video streams, codecs and bitrate hints |
| MOV | QuickTime/BMFF path through the MP4-family parser |
| WebM | EBML/WebM audio/video stream information |

Unknown files still return a coarse result using the extension where possible.

### ffprobe enhancement

When `enableFfprobeEnhancement: true`, CodecMedia runs `ffprobe` without a shell and merges its stream/duration information into the native result. If ffprobe is unavailable, the engine falls back to the native result by default.

Set `requireExternalTools: true` if an unavailable/failing ffprobe should be treated as an error instead.

## Validation

```js
const validation = media.validate("./sample.wav", {
  strict: true,
  maxBytes: 500 * 1024 * 1024,
});
```

Validation checks missing paths, regular-file status, size limits, and parser-level structure in strict mode. Strict validation also routes by detected signature before extension.

`strictProbe: true` is separate: it makes normal `probe()` calls propagate parser failures rather than returning a coarse fallback for a recognized format.

## Metadata

`readMetadata(input)` merges:

- core probe fields (`mimeType`, `extension`, `mediaType`)
- embedded WAV `LIST/INFO` fields
- AIFF text fields
- MP3 ID3v1 fields
- FLAC Vorbis comments
- OGG Vorbis/Opus comments
- `<input>.codecmedia.properties` sidecar values as fallback

`writeMetadata(input, metadata)` writes embedded metadata for WAV, AIFF-family and MP3 ID3v1 files. Other formats use a sidecar.

Sidecar writes are atomic, and escaped `=`, backslashes, CR/LF characters round-trip correctly. Embedded-metadata routing uses detected media content instead of blindly trusting the filename extension.

## Extract Audio

For audio inputs, same-format extraction remains a direct copy.

For video inputs, the default target is M4A. MP4/MOV to M4A can use the dependency-free remux route when the source audio track is compatible. Other video-to-audio routes, or audio transcoding to a different format, require `enableFfmpegConversion: true`.

```js
const media = CodecMedia.createDefault({ enableFfmpegConversion: true });

media.extractAudio("./clip.mp4", "./out", {
  targetFormat: "mp3",
  bitrateKbps: 192,
  streamIndex: 0,
});
```

## Convert

Dependency-free routes:

- same-format copy
- `wav -> pcm`
- `pcm -> wav`
- `mp4/mov -> m4a` when a compatible audio track can be remuxed

With `enableFfmpegConversion: true`, FFmpeg is used as the fallback for real audio/video/image transcoding, including routes such as `mp3 -> ogg`, `wav -> mp3`, generic video -> audio, video -> video, and image -> image.

```js
media.convert("./input.ogg", "./output.mp3", {
  targetFormat: "mp3",
  preset: "balanced",
  overwrite: true,
});
```

A custom `imageToImageTranscodeConverter` can be supplied and takes precedence over the FFmpeg image fallback. Advanced callers can replace the full `conversionHub`.

## Playback

`play(input, options)` supports dry-run operation and opening the file with the operating system default application. External opening uses argument-based process spawning instead of shell-interpolating the file path.

```js
media.play("./sample.mp4", {
  dryRun: true,
  allowExternalApp: false,
});
```

CodecMedia npm does not implement an internal sampled-audio player.

## Public API

The package root exports the facade/engine types, model factories, option factories, `MediaType`, and `StreamKind`:

```js
import {
  CodecMedia,
  DefaultCodecMediaEngine,
  CodecMediaException,
  MediaType,
  StreamKind,
  Metadata,
  ConversionOptions,
  AudioExtractOptions,
  PlaybackOptions,
  ValidationOptions,
} from "codecmedia";
```

Option factories are JavaScript-friendly and can be called without arguments.

## Known Gaps vs codecmedia-java

- MOV still uses the MP4-family BMFF path rather than a separate full `MovParser` port.
- ID3v2 and richer MP3 tag writing are not Java-equivalent; embedded MP3 writes are ID3v1.
- OGG and FLAC comment writing is not implemented.
- There is no pure-JavaScript MP3 decoder/transcoder; enable FFmpeg for real MP3 transcoding.
- Internal playback is intentionally not equivalent to Java sampled playback.
- Some uncommon codec/container combinations may require ffprobe/FFmpeg even when the container itself can be recognized natively.

## Test

```bash
npm test
```

Current source-tree result:

```text
ℹ tests 193
ℹ suites 52
ℹ pass 193
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1123.035647
```

The optional FFmpeg/ffprobe tests automatically skip on systems where those executables are unavailable.

## License

Apache License 2.0.

---

by TamKungZ_
