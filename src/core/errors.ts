/**
 * smaltlp's errors: every failure has a code, so callers can tell them apart without reading the message.
 * @module
 */

/**
 * The codes a {@link SmaltlpError} carries.
 * - `LP_PARAM`: an option is missing, has the wrong type, or has a value smaltlp doesn't accept.
 * - `LP_SHAPE`: a matrix or vector has the wrong number of rows or columns for the others.
 * - `LP_VALUE`: a number is NaN, or infinite where it must be finite.
 * - `LP_UNSUPPORTED`: a feature smaltlp doesn't have yet. It fails rather than answering differently.
 */
export type ErrorCode = 'LP_PARAM' | 'LP_SHAPE' | 'LP_VALUE' | 'LP_UNSUPPORTED';

/** An error from smaltlp, with a {@link ErrorCode}. */
export class SmaltlpError extends Error {
  readonly code: ErrorCode;
  constructor(code: ErrorCode, message: string) {
    super(`${code}: ${message}`);
    this.name = 'SmaltlpError';
    this.code = code;
  }
}

/** Throws a {@link SmaltlpError}. */
export function fail(code: ErrorCode, message: string): never {
  throw new SmaltlpError(code, message);
}
