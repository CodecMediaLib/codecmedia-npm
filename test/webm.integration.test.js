import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { WebmCodec } from "../src/internal/video/webm/WebmCodec.js";
import { WebmParser } from "../src/internal/video/webm/WebmParser.js";

const SAMPLE_WEBM_URL = "https://file-examples.com/storage/fe3352200069aa9da94a868/2020/03/file_example_WEBM_480_900KB.webm";

// Bundled sample placed next to this test file (test/file_example_WEBM_480_900KB.webm)
const BUNDLED_SAMPLE = path.join(
  path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")),
  "file_example_WEBM_480_900KB.webm"
);

const BUNDLED_SAMPLE_640 = path.join(
  path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")),
  "file_example_WEBM_640_1_4MB.webm"
);

function copyOrDownloadSample(filePath) {
  // 1. env override
  const localPath = process.env.CODECMEDIA_WEBM_SAMPLE_PATH;
  if (localPath && fs.existsSync(localPath)) {
    fs.copyFileSync(localPath, filePath);
    return;
  }

  // 2. bundled sample next to this test file
  if (fs.existsSync(BUNDLED_SAMPLE)) {
    fs.copyFileSync(BUNDLED_SAMPLE, filePath);
    return;
  }

  // 3. fetch from remote
  return fetch(SAMPLE_WEBM_URL, {
    headers: {
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) codecmedia-test",
      "accept": "video/webm,*/*;q=0.9",
      "referer": "https://file-examples.com/",
    },
  }).then(async (res) => {
    if (!res.ok) {
      throw new Error(`Download failed (${res.status} ${res.statusText})`);
    }
    const arrayBuffer = await res.arrayBuffer();
    fs.writeFileSync(filePath, Buffer.from(arrayBuffer));
  });
}

describe("WebM integration — real sample file", () => {
  it("downloads sample WebM and decodes/parses it", async (t) => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codecmedia-webm-real-"));
    const input = path.join(tempDir, "file_example_WEBM_480_900KB.webm");

    try {
      try {
        await copyOrDownloadSample(input);
      } catch (e) {
        if (String(e?.message || "").includes("403")) {
          t.skip("Remote sample blocked with HTTP 403; place file_example_WEBM_480_900KB.webm in test/ or set CODECMEDIA_WEBM_SAMPLE_PATH to run this test.");
          return;
        }
        throw e;
      }

      const bytes = fs.readFileSync(input);
      assert.equal(WebmParser.isLikelyWebm(bytes), true);

      const infoByBytes = WebmCodec.decodeBytes(bytes, input);
      const infoByPath = WebmCodec.decode(input);

      assert.ok(infoByBytes);
      assert.ok(infoByPath);
      assert.equal(typeof infoByBytes, "object");
      assert.equal(typeof infoByPath, "object");

      const hasVideo = infoByBytes.width != null && infoByBytes.height != null;
      const hasAudio = infoByBytes.sampleRate != null || infoByBytes.channels != null;
      assert.equal(hasVideo || hasAudio, true);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

describe("WebM integration — bundled samples", () => {
  it("parses bundled 480 sample", () => {
    assert.equal(fs.existsSync(BUNDLED_SAMPLE), true);

    const bytes = fs.readFileSync(BUNDLED_SAMPLE);
    assert.equal(WebmParser.isLikelyWebm(bytes), true);

    const info = WebmCodec.decodeBytes(bytes, BUNDLED_SAMPLE);
    assert.ok(info);
    assert.equal(typeof info, "object");
  });

  it("parses bundled 640 sample", () => {
    assert.equal(fs.existsSync(BUNDLED_SAMPLE_640), true);

    const bytes = fs.readFileSync(BUNDLED_SAMPLE_640);
    assert.equal(WebmParser.isLikelyWebm(bytes), true);

    const info = WebmCodec.decodeBytes(bytes, BUNDLED_SAMPLE_640);
    assert.ok(info);
    assert.equal(typeof info, "object");
  });
});
