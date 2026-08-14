export class CodecMediaException extends Error {
  /**
   * @param {string} message - Error description
   * @param {Error | unknown} [cause] - Underlying cause (optional)
   */
  constructor(message, cause) {
    super(message);
    this.name = "CodecMediaException";

    if (cause !== undefined) {
      this.cause = cause;
    }

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, CodecMediaException);
    }
  }
}