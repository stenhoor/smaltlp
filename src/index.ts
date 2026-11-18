/**
 * smaltlp: linear and mixed-integer programming for the smalt family, in TypeScript (smaltworks ADR 0039).
 * @module
 */
export { VERSION } from './version.ts';
export { SmaltlpError, type ErrorCode } from './core/errors.ts';
export type { MatrixInput, SparseInput } from './core/sparse.ts';
export * from './lp/index.ts';
export * from './model/index.ts';
export * from './io/index.ts';
