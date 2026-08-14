/**
 * ByteArrayReader
 * Port of me.tamkungz.codecmedia.internal.io.ByteArrayReader
 *
 * Stateful binary reader over a Buffer/Uint8Array for parsing media headers.
 */
export class ByteArrayReader {
  /**
   * @param {Buffer | Uint8Array | null} data
   */
  constructor(data) {
    /** @type {Buffer} */
    this._data = (data == null || data.length === 0)
      ? Buffer.alloc(0)
      : Buffer.from(data);
    this._position = 0;
  }

  /** @returns {number} Total byte length */
  length() {
    return this._data.length;
  }

  /** @returns {number} Current read position */
  position(newPosition) {
    if (newPosition === undefined) return this._position;
    if (newPosition < 0 || newPosition > this._data.length) {
      throw new RangeError(`Position out of bounds: ${newPosition}`);
    }
    this._position = newPosition;
  }

  /** @returns {number} Bytes remaining from current position */
  remaining() {
    return this._data.length - this._position;
  }

  /**
   * Skip forward by `bytes` bytes.
   * @param {number} bytes
   */
  skip(bytes) {
    this.position(this._position + bytes);
  }

  /** Read 1 unsigned byte. @returns {number} */
  readU8() {
    this._ensureRemaining(1);
    return this._data[this._position++];
  }

  /** Read 2 bytes big-endian unsigned. @returns {number} */
  readU16BE() {
    this._ensureRemaining(2);
    const v = this._data.readUInt16BE(this._position);
    this._position += 2;
    return v;
  }

  /** Read 2 bytes little-endian unsigned. @returns {number} */
  readU16LE() {
    this._ensureRemaining(2);
    const v = this._data.readUInt16LE(this._position);
    this._position += 2;
    return v;
  }

  /** Read 4 bytes big-endian unsigned. @returns {number} */
  readU32BE() {
    this._ensureRemaining(4);
    const v = this._data.readUInt32BE(this._position);
    this._position += 4;
    return v;
  }

  /** Read 4 bytes little-endian unsigned. @returns {number} */
  readU32LE() {
    this._ensureRemaining(4);
    const v = this._data.readUInt32LE(this._position);
    this._position += 4;
    return v;
  }

  /**
   * Read 8 bytes little-endian unsigned as BigInt.
   * (Java uses long; JS uses BigInt to avoid precision loss)
   * @returns {bigint}
   */
  readU64LE() {
    this._ensureRemaining(8);
    const v = this._data.readBigUInt64LE(this._position);
    this._position += 8;
    return v;
  }

  /**
   * Read `length` raw bytes.
   * @param {number} length
   * @returns {Buffer}
   */
  readBytes(length) {
    this._ensureRemaining(length);
    const out = this._data.subarray(this._position, this._position + length);
    this._position += length;
    return Buffer.from(out);
  }

  /**
   * Read `length` bytes as ASCII string.
   * @param {number} length
   * @returns {string}
   */
  readAscii(length) {
    return this.readBytes(length).toString("ascii");
  }

  /**
   * Peek unsigned byte at `offsetFromPosition` without moving position.
   * @param {number} offsetFromPosition
   * @returns {number}
   */
  peekU8(offsetFromPosition) {
    const index = this._position + offsetFromPosition;
    if (index < 0 || index >= this._data.length) {
      throw new RangeError(`Peek out of bounds: ${index}`);
    }
    return this._data[index];
  }

  /**
   * Get unsigned byte at absolute `index`.
   * @param {number} index
   * @returns {number}
   */
  getU8(index) {
    if (index < 0 || index >= this._data.length) {
      throw new RangeError(`Index out of bounds: ${index}`);
    }
    return this._data[index];
  }

  /**
   * @private
   * @param {number} needed
   */
  _ensureRemaining(needed) {
    if (needed < 0 || this.remaining() < needed) {
      throw new RangeError(
        `Not enough bytes: need ${needed}, remaining ${this.remaining()}`
      );
    }
  }
}