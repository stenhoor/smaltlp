/**
 * The messages between {@link connect} and {@link serve}: requests by id, answered in order. Arrays travel copied by
 * postMessage's structured clone, never transferred (a transfer would detach the caller's buffers).
 * @module
 */
import { SmaltlpError, type ErrorCode } from '../core/errors.ts';
import type { MpsModel } from '../io/mps.ts';
import type { LinprogOptions, LinprogResult } from '../lp/linprog.ts';
import type { MilpOptions, MilpResult } from '../mip/milp.ts';
import type { LpSolveStats, SolveOptions } from '../model/index.ts';

/** The end of a message channel: a Worker, a worker's own scope, or a MessagePort. */
export interface Port {
  postMessage(message: unknown): void;
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
  start?(): void;
}

export type Request =
  | { id: number; op: 'linprog'; c: ArrayLike<number>; options: LinprogOptions }
  | { id: number; op: 'milp'; c: ArrayLike<number>; options: MilpOptions }
  | { id: number; op: 'solve'; model: MpsModel; options: SolveOptions };

/** A model's solve: its stats, and each variable's value and reduced cost and each constraint's dual and slack, in order. */
export interface Solved {
  stats: LpSolveStats;
  varValue: (number | null)[];
  dj: (number | null)[];
  pi: (number | null)[];
  slack: (number | null)[];
}

export type Result = { kind: 'linprog'; result: LinprogResult } | { kind: 'milp'; result: MilpResult } | { kind: 'solve'; solved: Solved };

export type Response = { id: number; ok: true; result: Result } | { id: number; ok: false; error: { code?: ErrorCode; message: string } };

export function toError(e: { code?: ErrorCode; message: string }): Error {
  // The code is already at the message's start (SmaltlpError writes it there).
  if (!e.code) return new Error(e.message);
  const err = new SmaltlpError(e.code, e.message.startsWith(`${e.code}: `) ? e.message.slice(e.code.length + 2) : e.message);
  return err;
}
