/**
 * `milp()`: scipy.optimize.milp's interface, solved by smaltlp's branch-and-bound over its dual simplex (smaltworks
 * ADR 0039, sections 1 and 3). scipy's parameters keep their meaning, in camelCase (`node_limit` is `nodeLimit`), and
 * its status codes and result fields keep theirs.
 * @module
 */
import { fail } from '../core/errors.ts';
import { shapeOf, stackCsc, type MatrixInput } from '../core/sparse.ts';
import type { Status } from '../lp/simplex.ts';
import { branchAndBound, type BranchEnd } from './branch.ts';

/** `lb ≤ A x ≤ ub`, scipy's LinearConstraint. `lb` and `ub` are one number for every row, or one per row. */
export interface LinearConstraint {
  A: MatrixInput;
  /** Default -Infinity: no lower side. `null` means -Infinity too. */
  lb?: number | null | ArrayLike<number | null>;
  /** Default Infinity: no upper side. `null` means Infinity too. */
  ub?: number | null | ArrayLike<number | null>;
}

/** `lb ≤ x ≤ ub`, scipy's Bounds: one number for every variable, or one per variable. */
export interface Bounds {
  /** Default -Infinity. `null` means -Infinity too. */
  lb?: number | null | ArrayLike<number | null>;
  /** Default Infinity. `null` means Infinity too. */
  ub?: number | null | ArrayLike<number | null>;
}

export interface MilpOptions {
  /**
   * Each variable's kind, or one for every variable: 0 continuous, 1 integer. scipy's 2 (semi-continuous) and 3
   * (semi-integer) aren't in this release, and fail with LP_UNSUPPORTED. Default 0.
   */
  integrality?: number | ArrayLike<number>;
  /** The variables' bounds. Default `{ lb: 0, ub: Infinity }`: x ≥ 0, as scipy's. */
  bounds?: Bounds;
  /** The constraints: one LinearConstraint, or a list of them. */
  constraints?: LinearConstraint | readonly LinearConstraint[];
  /** The most branch-and-bound nodes to solve. Default: no limit. */
  nodeLimit?: number;
  /** The most seconds to spend. Default: no limit. */
  timeLimit?: number;
  /** Stop when (objective − bound) / |objective| is at most this. Default 1e-4, HiGHS's. */
  mipRelGap?: number;
  /** Simplify the root's linear program before solving it; the nodes below it start from their parent's basis. Default true. */
  presolve?: boolean;
}

export interface MilpResult {
  /** The best solution found: with status 0, or with status 1 when a limit stopped the search after finding one. */
  x: Float64Array | null;
  /** cᵀx, or null without x. */
  fun: number | null;
  /**
   * scipy's codes: 0 optimal, within the gap; 1 a node or time limit was reached; 2 the problem is infeasible; 4 other:
   * the relaxation is unbounded, so the problem is unbounded or infeasible (as scipy reports it through HiGHS), or
   * numerical difficulties. scipy's 3 (unbounded) isn't given.
   */
  status: Status;
  message: string;
  success: boolean;
  /** Branch-and-bound nodes solved. */
  mipNodeCount: number;
  /** The lowest bound on the optimum found, or null without one. */
  mipDualBound: number | null;
  /** (fun − mipDualBound) / |fun|, or null without x. */
  mipGap: number | null;
}

const MESSAGES: Record<BranchEnd, string> = {
  optimal: 'Optimization terminated successfully.',
  infeasible: 'The problem is infeasible.',
  unboundedOrInfeasible: 'The problem is unbounded or infeasible.',
  nodeLimit: 'Node limit reached.',
  timeLimit: 'Time limit reached.',
  numerical: 'Numerical difficulties encountered.',
};
const STATUS: Record<BranchEnd, Status> = { optimal: 0, infeasible: 2, unboundedOrInfeasible: 4, nodeLimit: 1, timeLimit: 1, numerical: 4 };

/**
 * Minimizes cᵀx subject to the constraints, the bounds, and integrality on the variables marked integer, as
 * scipy.optimize.milp does. Runs on the CPU in 64-bit floats; the asynchronous call gives exactly
 * {@link milpSync}'s result.
 */
export async function milp(c: ArrayLike<number>, options: MilpOptions = {}): Promise<MilpResult> {
  return milpSync(c, options);
}

/** {@link milp}, synchronously. */
export function milpSync(c: ArrayLike<number>, options: MilpOptions = {}): MilpResult {
  if (options === null || typeof options !== 'object') fail('LP_PARAM', 'options must be an object');
  const cost = costOf(c);
  const n = cost.length;
  const integer = integralityOf(options.integrality, n);
  const bounds = options.bounds ?? { lb: 0, ub: Infinity };
  if (bounds === null || typeof bounds !== 'object' || Array.isArray(bounds)) fail('LP_PARAM', 'bounds must be { lb, ub }');
  const colLo = sideOf(bounds.lb, n, -Infinity, 'bounds.lb', 'variables');
  const colUp = sideOf(bounds.ub, n, Infinity, 'bounds.ub', 'variables');
  for (let j = 0; j < n; j++) {
    if (colLo[j] === Infinity) fail('LP_VALUE', `variable ${j}'s lower bound is Infinity`);
    if (colUp[j] === -Infinity) fail('LP_VALUE', `variable ${j}'s upper bound is -Infinity`);
  }

  const list = options.constraints === undefined ? [] : Array.isArray(options.constraints) ? options.constraints : [options.constraints as LinearConstraint];
  const parts: { a: MatrixInput; name: string }[] = [];
  const lows: Float64Array[] = [];
  const ups: Float64Array[] = [];
  list.forEach((con: LinearConstraint, k: number) => {
    const name = list.length === 1 ? 'constraints' : `constraints[${k}]`;
    if (con === null || typeof con !== 'object' || con.A === undefined) fail('LP_PARAM', `${name} must be { A, lb, ub }`);
    const { rows, cols } = shapeOf(con.A, `${name}.A`);
    if (rows > 0 && cols !== n) fail('LP_SHAPE', `${name}.A has ${cols} columns; c has ${n}`);
    parts.push({ a: con.A, name: `${name}.A` });
    lows.push(sideOf(con.lb, rows, -Infinity, `${name}.lb`, 'rows'));
    ups.push(sideOf(con.ub, rows, Infinity, `${name}.ub`, 'rows'));
  });
  const A = stackCsc(parts, n);
  const rowLo = new Float64Array(A.rows);
  const rowUp = new Float64Array(A.rows);
  let at = 0;
  for (let k = 0; k < lows.length; k++) {
    rowLo.set(lows[k]!, at);
    rowUp.set(ups[k]!, at);
    at += lows[k]!.length;
  }

  const nodeLimit = options.nodeLimit ?? Infinity;
  if (nodeLimit !== Infinity && (!Number.isInteger(nodeLimit) || nodeLimit < 0)) fail('LP_PARAM', `nodeLimit must be a whole number, 0 or more, not ${String(nodeLimit)}`);
  const timeLimit = options.timeLimit ?? Infinity;
  if (typeof timeLimit !== 'number' || !(timeLimit >= 0)) fail('LP_PARAM', `timeLimit must be a number of seconds, 0 or more, not ${String(timeLimit)}`);
  const relGap = options.mipRelGap ?? 1e-4;
  if (typeof relGap !== 'number' || !(relGap >= 0) || relGap === Infinity) fail('LP_PARAM', `mipRelGap must be a number, 0 or more, not ${String(relGap)}`);
  const presolve = options.presolve ?? true;
  if (typeof presolve !== 'boolean') fail('LP_PARAM', `presolve is true or false, not ${String(presolve)}`);

  for (let j = 0; j < n; j++) {
    if (colLo[j]! > colUp[j]!) return { ...ended('infeasible', 0), message: `The problem is infeasible: variable ${j}'s lower bound is above its upper bound.` };
  }
  for (let i = 0; i < A.rows; i++) {
    if (rowLo[i] === Infinity || rowUp[i] === -Infinity) fail('LP_VALUE', `constraint row ${i}'s ${rowLo[i] === Infinity ? 'lb is Infinity' : 'ub is -Infinity'}`);
    if (rowLo[i]! > rowUp[i]!) return { ...ended('infeasible', 0), message: `The problem is infeasible: constraint row ${i}'s lb is above its ub.` };
  }
  const res = branchAndBound({ A, c: cost, colLo, colUp, rowLo, rowUp }, { integer, relGap, nodeLimit, timeLimit, presolve, tol: 1e-7, maxIter: 2 ** 31 - 1 });
  return {
    x: res.x,
    fun: res.objective,
    status: STATUS[res.end],
    message: MESSAGES[res.end],
    success: res.end === 'optimal',
    mipNodeCount: res.nodes,
    mipDualBound: Number.isFinite(res.dualBound) ? res.dualBound : null,
    mipGap: res.x ? res.gap : null,
  };
}

/** A result with no solution. */
function ended(end: BranchEnd, nodes: number): MilpResult {
  return { x: null, fun: null, status: STATUS[end], message: MESSAGES[end], success: false, mipNodeCount: nodes, mipDualBound: null, mipGap: null };
}

/** c, checked: a non-empty array of finite numbers. */
export function costOf(c: ArrayLike<number>): Float64Array {
  if (c === null || typeof c !== 'object' || typeof c.length !== 'number') fail('LP_PARAM', 'c must be an array of numbers');
  const n = c.length;
  if (n === 0) fail('LP_SHAPE', 'c is empty: there must be at least one variable');
  const cost = new Float64Array(n);
  for (let j = 0; j < n; j++) {
    const v = c[j]!;
    if (typeof v !== 'number' || !Number.isFinite(v)) fail('LP_VALUE', `c[${j}] is ${String(v)}; costs must be finite`);
    cost[j] = v;
  }
  return cost;
}

/** integrality, checked and spread to every variable: 1 for an integer variable. */
export function integralityOf(integrality: number | ArrayLike<number> | undefined, n: number): Uint8Array {
  const out = new Uint8Array(n);
  if (integrality === undefined || integrality === null) return out;
  const one = typeof integrality === 'number';
  if (!one && (typeof integrality !== 'object' || typeof integrality.length !== 'number')) fail('LP_PARAM', 'integrality must be a number or an array of numbers');
  if (!one && integrality.length !== n) fail('LP_SHAPE', `integrality has ${integrality.length} entries; c has ${n}`);
  for (let j = 0; j < n; j++) {
    const k = one ? integrality : integrality[j]!;
    if (k === 2 || k === 3) fail('LP_UNSUPPORTED', `integrality ${k} (${k === 2 ? 'semi-continuous' : 'semi-integer'}) isn't in this release; 0 and 1 are`);
    if (k !== 0 && k !== 1) fail('LP_PARAM', `integrality must hold 0 (continuous) or 1 (integer), not ${String(k)}`);
    out[j] = k;
  }
  return out;
}

/** One side of a range: a number (or null) for every entry, or one per entry; null is `none`. */
function sideOf(v: number | null | ArrayLike<number | null> | undefined, len: number, none: number, name: string, what: string): Float64Array {
  const out = new Float64Array(len).fill(none);
  if (v === undefined || v === null) return out;
  const value = (x: unknown, k: number): number => {
    if (x === null) return none;
    if (typeof x !== 'number' || Number.isNaN(x)) fail('LP_VALUE', `${name}${k < 0 ? '' : `[${k}]`} is ${String(x)}; it must be a number or null`);
    return x;
  };
  if (typeof v === 'number') return out.fill(value(v, -1));
  if (typeof v !== 'object' || typeof v.length !== 'number') fail('LP_PARAM', `${name} must be a number or an array of numbers`);
  if (v.length !== len) fail('LP_SHAPE', `${name} has ${v.length} entries; there are ${len} ${what}`);
  for (let k = 0; k < len; k++) out[k] = value(v[k], k);
  return out;
}
