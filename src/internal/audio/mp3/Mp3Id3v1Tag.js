const TAG_SIZE = 128;

export class Mp3Id3v1Tag {
  static read(bytes) {
    const out = {};
    if (!hasId3v1(bytes)) return out;

    const start = bytes.length - TAG_SIZE;
    out.title = decodeField(bytes, start + 3, 30);
    out.artist = decodeField(bytes, start + 33, 30);
    out.album = decodeField(bytes, start + 63, 30);
    out.date = decodeField(bytes, start + 93, 4);
    out.comment = decodeField(bytes, start + 97, 30);
    const genreIndex = bytes[start + 127] & 0xff;
    if (genreIndex !== 255) out.genre = String(genreIndex);

    for (const [key, value] of Object.entries(out)) {
      if (value == null || !String(value).trim()) delete out[key];
    }
    return out;
  }

  static write(original, entries) {
    const base = Mp3Id3v1Tag.read(original);
    const merged = { ...base };
    for (const [rawKey, value] of Object.entries(entries ?? {})) {
      const key = String(rawKey ?? "").trim().toLowerCase();
      if (isSupportedKey(key) && value != null) {
        merged[key] = String(value);
      }
    }

    const audioEnd = hasId3v1(original) ? original.length - TAG_SIZE : original.length;
    const output = Buffer.alloc(audioEnd + TAG_SIZE);
    Buffer.from(original).subarray(0, audioEnd).copy(output, 0);

    const t = audioEnd;
    output.write("TAG", t, "ascii");
    encodeField(output, t + 3, 30, merged.title);
    encodeField(output, t + 33, 30, merged.artist);
    encodeField(output, t + 63, 30, merged.album);
    encodeField(output, t + 93, 4, normalizeYear(merged.date));
    encodeField(output, t + 97, 30, merged.comment);
    output[t + 127] = parseGenre(merged.genre);
    return output;
  }
}

function hasId3v1(bytes) {
  return bytes != null &&
    bytes.length >= TAG_SIZE &&
    bytes[bytes.length - TAG_SIZE] === 0x54 &&
    bytes[bytes.length - TAG_SIZE + 1] === 0x41 &&
    bytes[bytes.length - TAG_SIZE + 2] === 0x47;
}

function isSupportedKey(key) {
  return ["title", "artist", "album", "date", "comment", "genre"].includes(key);
}

function decodeField(bytes, offset, length) {
  const raw = Buffer.from(bytes).subarray(offset, offset + length).toString("latin1");
  let end = raw.length;
  while (end > 0 && (raw.charCodeAt(end - 1) === 0 || raw[end - 1] === " ")) {
    end--;
  }
  return raw.slice(0, end);
}

function encodeField(out, offset, length, value) {
  out.fill(0, offset, offset + length);
  if (value == null) return;
  Buffer.from(String(value), "latin1").subarray(0, length).copy(out, offset);
}

function normalizeYear(date) {
  if (date == null || !String(date).trim()) return "";
  const trimmed = String(date).trim();
  return trimmed.length >= 4 ? trimmed.slice(0, 4) : trimmed;
}

function parseGenre(value) {
  if (value == null || !String(value).trim()) return 255;
  const parsed = Number.parseInt(String(value).trim(), 10);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 255 ? parsed : 255;
}
