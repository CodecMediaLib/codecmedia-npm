# CodecMedia npm Changes

## 1.2.0 - 2026-08-14

This release turns the npm port from a mostly Java-shaped compatibility layer into a more practical Node.js implementation while keeping the default core dependency-free.

### Added

- Added a real OGG parser/codec path for Vorbis and Opus, including identification headers, logical stream/page sequence checks, duration, sample rate, channels, bitrate estimation/mode, and Vorbis/Opus comment metadata reads.
- Added optional `enableFfmpegConversion` integration with configurable `ffmpegPath` for real audio/video/image transcoding without adding an npm runtime dependency.
- Added optional, working `enableFfprobeEnhancement` integration with configurable `ffprobePath` to enrich native probe results with external stream/duration data.
- Added `requireExternalTools` for callers that want ffprobe enhancement failures to be fatal instead of falling back to the native probe.
- Added `strictProbe` so recognized malformed files can fail explicitly instead of silently degrading to a coarse probe result.
- Added real video/audio extraction routing through the conversion hub. MP4/MOV -> M4A can remain dependency-free; other target formats can use FFmpeg when enabled.
- Added public root exports for model factories, option factories, `MediaType`, `StreamKind`, and `DefaultCodecMediaEngine`.
- Added a real Node test suite covering native OGG probing, signature-first detection, strict probing, validation, metadata escaping, WAV/PCM and RF64 conversion, custom converter wiring, ffprobe enhancement, and FFmpeg transcoding.
- Added the Apache-2.0 `LICENSE` file that package metadata already declared.

### Changed

- Probe routing is now signature-first. Filename extensions are only used as fallback when no known content signature is detected.
- Conversion source format now follows detected content where possible instead of blindly trusting the source filename extension.
- Embedded metadata writes now route by detected content instead of only the filename extension.
- `extractAudio()` now accepts video inputs and can perform real extraction/transcoding when an available conversion route exists.
- `DefaultConversionHub` now uses explicit unsupported fallbacks for conversion routes that the dependency-free core cannot perform, instead of presenting an incomplete image-transcode implementation as generally available.
- Optional FFmpeg is used as a compatibility fallback if the dependency-free MP4/MOV -> M4A remuxer cannot handle a source.
- `AudioExtractOptions`, `ConversionOptions`, `PlaybackOptions`, and `ValidationOptions` now have JavaScript-friendly no-argument defaults.
- Package metadata is now zero-dependency, removes unused `fp-ts`/`io-ts`, exports `package.json`, and includes the actual `CHANGE.md` file instead of the nonexistent `CHANGELOG.md` path.
- `npm test` now discovers the actual bundled test tree instead of pointing at test files that were absent from the supplied source archive.

### Fixed

- Fixed `validate()` incorrectly accepting directories in non-strict mode.
- Fixed parser exceptions being swallowed inconsistently; `strictProbe` now applies across supported probe formats.
- Fixed sidecar writes to use atomic replacement.
- Fixed sidecar property parsing so escaped `=`, backslashes, CR, and LF values round-trip correctly.
- Fixed system-default playback launch to avoid shell interpolation of media paths.
- Fixed duplicate MP3 parser registration in the internal registry.
- Hardened PNG parsing with null-safe signature checks and PNG-spec bit-depth/color-type combination validation.
- Hardened WAV parsing with PCM/IEEE-float/WAVE_FORMAT_EXTENSIBLE validation and RF64 `ds64` data-size handling.
- Fixed RF64 metadata traversal and RF64 WAV -> PCM extraction so the `0xFFFFFFFF` data-size sentinel resolves through `ds64` instead of being rejected as a negative/oversized chunk.
- Fixed same-path same-format conversion so it behaves as a no-op result instead of trying to copy a file onto itself.

### Java Corrections Found During Parity Review

The companion Java source supplied with this work was also corrected (without running the Java test suite, as requested):

- Fixed null-unsafe WAV signature sniffing.
- Fixed shifted `WAVE_FORMAT_EXTENSIBLE` sub-format GUID validation offsets.
- Fixed RF64 metadata traversal and RF64 WAV -> PCM extraction to honor `ds64`.
- Changed the experimental `pure-java`/`layer3` MP3 backend to fail closed. It previously generated a synthetic 440 Hz PCM tone from frame cadence and therefore did not decode the source MP3 audio.

### Verification

```text
npm test
# tests 11
# pass 11
# fail 0
```

Additional smoke checks completed successfully for OGG -> MP3, PNG -> JPEG, MP4 -> MP3 audio extraction, ffprobe-enriched MP4 probing, misleading-extension detection, and escaped sidecar metadata round-trip.

## 1.1.7 - 2026-06-05

This release moves the npm port closer to `codecmedia-java` 1.2.1 behavior while keeping the package pure JavaScript and dependency-light.

### Added

- Added real `wav -> pcm` conversion by extracting the WAV `data` chunk from PCM WAV files.
- Added real `pcm -> wav` conversion by wrapping raw PCM bytes in a canonical WAV container.
- Added `pcm -> wav` preset support for `sr=<sampleRate>`, `ch=<channels>`, and `bits=<bitsPerSample>`.
- Added MP4/MOV to M4A container remux support for M4A-compatible audio tracks.
- Added WAV INFO embedded metadata read/write support.
- Added AIFF/AIF/AIFC embedded text metadata write support.
- Added MP3 ID3v1 embedded metadata read/write support.
- Added focused coverage for WAV/PCM conversion, embedded metadata round trips, and M4A remux behavior.

### Changed

- Bumped package metadata from `1.1.6` to `1.1.7`.
- Replaced the internal `WavPcmStubConverter` with `WavPcmConverter`.
- Updated the default conversion hub to route MP4/MOV to M4A remux before falling back to generic unsupported video-to-audio handling.
- Updated `writeMetadata` so WAV, AIFF-family, and MP3 files use embedded metadata paths where supported instead of sidecar-only persistence.
- Updated `extractAudio` messaging to match the Java-facing wording more closely when format conversion is requested.

### Remaining Java Parity Gaps (at 1.1.7)

- OGG Vorbis/Opus detailed parser and comment metadata were not yet ported.
- MP3 decoder-backed conversion (`mp3 -> pcm` and `mp3 -> wav`) was not yet ported.
- ID3v2 and richer MP3 tag families were not equivalent to Java behavior.
- OGG/FLAC comment writing was not implemented.
- Internal playback was not equivalent to Java sampled playback.
