# CodecMedia npm Changes

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
- Updated README status, implemented routes, metadata support, known gaps, and local test counts.

### Test Status

```text
npm test
tests 182
suites 52
pass 182
fail 0
```

### Remaining Java Parity Gaps

- OGG Vorbis/Opus detailed parser and comment metadata are still not ported.
- MP3 decoder-backed conversion (`mp3 -> pcm` and `mp3 -> wav`) is still not ported.
- ID3v2 and richer MP3 tag families are still not equivalent to Java behavior.
- OGG/FLAC comment writing is not implemented.
- Internal playback is not equivalent to Java sampled playback.
