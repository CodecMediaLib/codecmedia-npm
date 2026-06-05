# CodecMedia

[![npm version](https://img.shields.io/npm/v/codecmedia.svg)](https://www.npmjs.com/package/codecmedia)
[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-43853D?logo=node.js&logoColor=white)](https://nodejs.org/)
[![npm](https://img.shields.io/badge/npm-9%2B-CB3837?logo=npm&logoColor=white)](https://www.npmjs.com/)
[![Java Version](https://img.shields.io/badge/Java%20Version-codecmedia--java-007396?logo=openjdk&logoColor=white)](https://github.com/TamKungZ/codecmedia-java)

CodecMedia is a pure Node.js port of the CodecMedia Java engine. It provides synchronous media probing, validation, metadata sidecar persistence, limited embedded metadata reads, dry-run playback workflow support, and lightweight conversion routing.

The package is still a work in progress. It aims to mirror `codecmedia-java` where Java behavior can be reasonably implemented in npm without native dependencies or external binaries.

<p align="center">
  <img src="https://codecmedia.tamkungz.me/CodecMedia_Full_Logo.png" width="70%" alt="CodecMedia Logo">
</p>

## Status

- Current npm package version: `1.1.7`
- Runtime: Node.js 18+
- Core implementation: pure JavaScript, no required native dependencies
- Default engine: `CodecMedia.createDefault()` returns `StubCodecMediaEngine` with `DefaultConversionHub` wired by default
- Test status in this working tree: `182` tests passing with `npm test`

## What Works Now

### Probe

`probe(input)` and `get(input)` return technical media information for these formats:

| Format | Current behavior |
| --- | --- |
| MP3 | Frame parser, duration estimate, bitrate mode, sample rate, channels |
| WAV | RIFF/RIFX/RF64 parser, PCM stream info, duration, bitrate |
| AIFF/AIF/AIFC | COMM chunk parser, PCM stream info, duration, bitrate |
| FLAC | STREAMINFO parser, duration, sample rate, channels, bits per sample |
| PNG | IHDR parser, width, height, bit depth, color type |
| JPEG/JPG | SOF parser, width, height, bit precision, channel count |
| WebP | VP8, VP8L, and VP8X dimension parser |
| BMP | DIB header parser, width, height, bits per pixel |
| TIFF/TIF | IFD parser for width, height, and first bits-per-sample value |
| HEIC/HEIF/AVIF | Basic BMFF brand parser plus `ispe` dimensions and `pixi` bit depth when present |
| MP4/M4A | Basic ISO BMFF parser for duration, video/audio streams, codecs, bitrate hints |
| MOV | Basic QuickTime/BMFF parsing through the MP4-family parser path |
| WebM | EBML/WebM parser for video/audio stream information |

Unknown formats still return a probe result based on extension when possible, with `application/octet-stream` and `UNKNOWN` media type as fallback.

### Validate

`validate(input, options)` checks:

- null/missing input
- regular file existence
- `maxBytes`
- strict parser checks when `strict: true` and a parser is registered

Strict validation currently performs real parser checks for:

`mp3`, `wav`, `aif`, `aiff`, `aifc`, `flac`, `png`, `jpg`, `jpeg`, `webp`, `bmp`, `tif`, `tiff`, `heic`, `heif`, `avif`, `mp4`, `m4a`, and `webm`.

Important: `ogg` is still extension/sniff fallback only in the default npm engine, so strict validation for OGG is not Java-equivalent yet.

### Metadata

`readMetadata(input)` returns:

- derived probe fields: `mimeType`, `extension`, `mediaType`
- embedded metadata currently supported for:
  - WAV INFO chunks: `title`, `artist`, `album`, `comment`, `date`, `genre`
  - AIFF text chunks: `title`, `artist`, `copyright`, `comment`
  - MP3 ID3v1 tags: `title`, `artist`, `album`, `date`, `comment`, `genre`
  - FLAC Vorbis comments: `title`, `artist`, `album`, `comment`, `genre`, `date`
- sidecar metadata from `<input>.codecmedia.properties`

Sidecar keys do not override core probe fields or embedded fields.

`writeMetadata(input, metadata)` currently validates entries and writes embedded metadata for WAV, AIFF/AIF/AIFC, and MP3 ID3v1 where supported. Other formats use sidecar metadata.

### Extract Audio

`extractAudio(input, outputDir, options)` is a limited workflow:

- accepts audio inputs only
- creates the output directory
- copies the source audio file to `<basename>_audio.<format>`
- requires `targetFormat` to match the source format
- does not transcode

### Convert

`convert(input, output, options)` uses `DefaultConversionHub` by default.

Implemented routes:

- same-extension copy through `SameFormatCopyConverter`
- `wav -> pcm` by extracting the WAV `data` chunk from PCM WAV files
- `pcm -> wav` by wrapping raw PCM bytes in a WAV container
- `mp4 -> m4a` and `mov -> m4a` remux when an M4A-compatible audio track is present
- image-to-image route through `ImageTranscodeConverter`
- PNG codec registration is available for `png -> png`

Guardrails:

- `ConversionOptions.targetFormat` is required
- output extension must match `targetFormat`
- `overwrite: false` blocks overwriting existing files

Unsupported routes throw `CodecMediaException`, including:

- real audio transcode such as `mp3 -> ogg`
- generic `video -> audio` routes other than the implemented MP4/MOV to M4A remux
- `video -> video`
- `audio -> image`
- `image -> audio`

### Playback

`play(input, options)` supports:

- `dryRun: true`
- optional system default app launch when `allowExternalApp: true`

Unlike Java, npm does not provide an internal Java sampled playback backend.

## Known Gaps vs codecmedia-java

- OGG Vorbis/Opus detailed parser is not ported yet.
- MOV parsing is basic BMFF-style parsing, not a full separate Java `MovParser` port.
- ID3v2 and richer MP3 tag families are not Java-equivalent; npm currently supports ID3v1 for embedded writes.
- OGG/FLAC comment writing is not implemented.
- MP3 decoder-backed conversion (`mp3 -> pcm` and `mp3 -> wav`) is not ported yet.
- Real transcoding is not implemented without injecting external behavior.
- Internal playback is not equivalent to Java sampled playback.
- Optional `enableFfprobeEnhancement` is documented as an option, but the default pure JS path does not require or execute `ffprobe`.

## Install

```bash
npm install codecmedia
```

## Quick Example

```js
import { CodecMedia } from "codecmedia";

const engine = CodecMedia.createDefault();
const input = "./media/sample.mp4";

const probe = engine.probe(input);
console.log("Probe:", probe);

const validation = engine.validate(input, {
  strict: true,
  maxBytes: 500 * 1024 * 1024,
});
console.log("Validation:", validation);

const metadata = engine.readMetadata(input);
console.log("Metadata:", metadata);

engine.writeMetadata(input, {
  entries: {
    title: "Demo Title",
    artist: "CodecMedia",
  },
});

const playback = engine.play(input, {
  dryRun: true,
  allowExternalApp: false,
});
console.log("Playback:", playback);
```

## API Summary

- `CodecMedia.createDefault(options?)`: create the default engine.
- `get(input)`: alias of `probe(input)`.
- `probe(input)`: inspect technical media/container information.
- `readMetadata(input)`: read probe-derived fields, supported embedded metadata, and sidecar metadata.
- `writeMetadata(input, metadata)`: write supported embedded metadata or sidecar metadata.
- `extractAudio(input, outputDir, options)`: copy same-format audio into an output directory.
- `convert(input, output, options)`: run limited conversion routing.
- `play(input, options)`: dry-run playback or optionally open with the system app.
- `validate(input, options)`: validate existence, size, and registered strict parsers.

## Build And Test

```bash
npm test
```

Latest local result:

```text
> codecmedia@1.1.7 test
> node --test ./test/*.test.js

tests 182
suites 52
pass 182
fail 0
cancelled 0
skipped 0
todo 0
```

Run only conversion tests:

```bash
node --test ./test/convert.test.js
```

## License

This project is licensed under the Apache License 2.0.

---

by TamKungZ_
