/**
 * `linprog()`: scipy.optimize.linprog's interface, solved by smaltlp's dual simplex (smaltworks ADR 0039, section 3).
 * scipy's parameters keep their meaning, in camelCase (`A_ub` is `AUb`, `b_ub` is `bUb`), and its status codes and
 * result fields keep theirs.
 * @module
 */
import { fail } from '../core/errors.ts';
import { multiply, shapeOf, stackCsc, type MatrixInput } from '../core/sparse.ts';
import { solve } from './presolve.ts';
import type { Status } from './simplex.ts';

/** A variable's bounds, `[lower, upper]`: `null` (or ±Infinity) for none on that side. scipy's default is `[0, null]`. */
export type Bound = readonly [number | null, number | null];

export interface LinprogOptions {
  /** The inequality constraints' matrix: `AUb x ≤ bUb`. */
  AUb?: MatrixInput;
  bUb?: ArrayLike<number>;
  /** The equality constraints' matrix: `AEq x = bEq`. */
  AEq?: MatrixInput;
  bEq?: ArrayLike<number>;
  /** One pair for every variable, or a pair per variable. Default `[0, null]`: x ≥ 0. */
  bounds?: Bound | readonly Bound[];
  /** The most iterations. Default: no limit short of 2³¹. */
  maxIter?: number;
  /** Primal and dual feasibility tolerance. Default 1e-7. */
  tol?: number;
  /** Simplify the problem before solving it (empty rows, fixed variables, singleton rows). Default true, as scipy's. */
  presolve?: boolean;
  /** scipy's integrality: not in this release. `milp()` comes with phase 2 (ADR 0039, section 1). */
  integrality?: unknown;
}

/** A constraint group's slack (or residual) and the objective's sensitivity to each right-hand side. */
export interface Constraints {
  residual: Float64Array;
  marginals: Float64Array;
}

export interface LinprogResult {
  /** The solution, or null unless status is 0. */
  x: Float64Array | null;
  /** The objective's value cᵀx, or null unless status is 0. */
  fun: number | null;
  /**
   * 0 optimal; 1 the iteration limit was reached; 2 the problem is infeasible; 3 the problem is unbounded; 4 numerical
   * difficulties. scipy's codes.
   */
  status: Status;
  message: string;
  success: boolean;
  /** Iterations: changes of basis. */
  nit: number;
  /** bUb − AUb x. */
  slack: Float64Array | null;
  /** bEq − AEq x. */
  con: Float64Array | null;
  /** The inequality constraints: `residual` is the slack; `marginals` the objective's change per unit of bUb (≤ 0). */
  ineqlin: Constraints | null;
  /** The equality constraints: `residual` is `con`; `marginals` the objective's change per unit of bEq. */
  eqlin: Constraints | null;
  /** The lower bounds: `residual` is x − lower; `marginals` the objective's change per unit of each lower bound. */
  lower: Constraints | null;
  /** The upper bounds: `residual` is upper − x; `marginals` the objective's change per unit of each upper bound. */
  upper: Constraints | null;
}

const MESSAGES: Record<Status, string> = {
  0: 'Optimization terminated successfully.',
  1: 'Iteration limit reached.',
  2: 'The problem is infeasible.',
  3: 'The problem is unbounded.',
  4: 'Numerical difficulties encountered.',
};

/**
 * Minimizes cᵀx subject to `AUb x ≤ bUb`, `AEq x = bEq` and the bounds on x, as scipy.optimize.linprog does.
 * Runs on the CPU in 64-bit floats; the asynchronous call gives exactly {@link linprogSync}'s result.
 */
export async function linprog(c: ArrayLike<number>, options: LinprogOptions = {}): Promise<LinprogResult> {
  return linprogSync(c, options);
}

/** {@link linprog}, synchronously. */
export function linprogSync(c: ArrayLike<number>, options: LinprogOptions = {}): LinprogResult {
  if (c === null || typeof c !== 'object' || typeof c.length !== 'number') fail('LP_PARAM', 'c must be an array of numbers');
  const n = c.length;
  if (n === 0) fail('LP_SHAPE', 'c is empty: there must be at least one variable');
  const cost = new Float64Array(n);
  for (let j = 0; j < n; j++) {
    const v = c[j]!;
    if (typeof v !== 'number' || !Number.isFinite(v)) fail('LP_VALUE', `c[${j}] is ${String(v)}; costs must be finite`);
    cost[j] = v;
  }
  if (options.integrality !== undefined) {
    fail('LP_UNSUPPORTED', 'integrality: integer variables come with milp() in phase 2; linprog solves continuous problems');
  }
  const tol = options.tol ?? 1e-7;
  if (typeof tol !== 'number' || !(tol > 0) || tol >= 1) fail('LP_PARAM', `tol must be above 0 and below 1, not ${String(tol)}`);
  const maxIter = options.maxIter ?? 2 ** 31 - 1;
  if (!Number.isInteger(maxIter) || maxIter < 0) fail('LP_PARAM', `maxIter must be a whole number, 0 or more, not ${String(maxIter)}`);

  const ub = constraintPart(options.AUb, options.bUb, 'AUb', 'bUb', n);
  const eq = constraintPart(options.AEq, options.bEq, 'AEq', 'bEq', n);
  const parts = [];
  if (ub) parts.push({ a: ub.A, name: 'AUb' });
  if (eq) parts.push({ a: eq.A, name: 'AEq' });
  const A = stackCsc(parts, n);
  const mUb = ub ? ub.b.length : 0;
  const mEq = eq ? eq.b.length : 0;
  const m = mUb + mEq;
  const rowLo = new Float64Array(m);
  const rowUp = new Float64Array(m);
  for (let r = 0; r < mUb; r++) {
    rowLo[r] = -Infinity;
    rowUp[r] = ub!.b[r]!;
  }
  for (let r = 0; r < mEq; r++) rowLo[mUb + r] = rowUp[mUb + r] = eq!.b[r]!;
  const { lo: colLo, up: colUp } = boundsOf(options.bounds, n);

  const empty = (status: Status): LinprogResult => ({
    x: null, fun: null, status, message: MESSAGES[status], success: false, nit: 0,
    slack: null, con: null, ineqlin: null, eqlin: null, lower: null, upper: null,
  });
  for (let j = 0; j < n; j++) if (colLo[j]! > colUp[j]!) return { ...empty(2), message: `The problem is infeasible: variable ${j}'s lower bound is above its upper bound.` };

  const presolve = options.presolve ?? true;
  if (typeof presolve !== 'boolean') fail('LP_PARAM', `presolve is true or false, not ${String(presolve)}`);
  const res = solve({ A, c: cost, colLo, colUp, rowLo, rowUp }, { maxIter, primalTol: tol, dualTol: tol, presolve });
  if (res.status !== 0) return { ...empty(res.status), nit: res.nit };

  const x = res.x.slice(0, n);
  let fun = 0;
  for (let j = 0; j < n; j++) fun += cost[j]! * x[j]!;
  const Ax = multiply(A, x);
  const slack = new Float64Array(mUb);
  const ineqMarg = new Float64Array(mUb);
  for (let r = 0; r < mUb; r++) {
    slack[r] = rowUp[r]! - Ax[r]!;
    ineqMarg[r] = res.d[n + r]!;
  }
  const con = new Float64Array(mEq);
  const eqMarg = new Float64Array(mEq);
  for (let r = 0; r < mEq; r++) {
    con[r] = rowUp[mUb + r]! - Ax[mUb + r]!;
    eqMarg[r] = res.d[n + mUb + r]!;
  }
  const loRes = new Float64Array(n);
  const upRes = new Float64Array(n);
  const loMarg = new Float64Array(n);
  const upMarg = new Float64Array(n);
  for (let j = 0; j < n; j++) {
    loRes[j] = x[j]! - colLo[j]!;
    upRes[j] = colUp[j]! - x[j]!;
    if (res.at[j] === -1) loMarg[j] = res.d[j]!;
    else if (res.at[j] === 1) upMarg[j] = res.d[j]!;
  }
  return {
    x, fun, status: 0, message: MESSAGES[0], success: true, nit: res.nit,
    slack, con,
    ineqlin: { residual: slack, marginals: ineqMarg },
    eqlin: { residual: con, marginals: eqMarg },
    lower: { residual: loRes, marginals: loMarg },
    upper: { residual: upRes, marginals: upMarg },
  };
}

/** A constraint group's matrix and right-hand side, checked against each other and against c. */
function constraintPart(A: MatrixInput | undefined, b: ArrayLike<number> | undefined, aName: string, bName: string, n: number) {
  if (A === undefined && b === undefined) return null;
  if (A === undefined || b === undefined) fail('LP_PARAM', `${aName} and ${bName} come together: give both or neither`);
  const { rows, cols } = shapeOf(A, aName);
  if (rows > 0 && cols !== n) fail('LP_SHAPE', `${aName} has ${cols} columns; c has ${n}`);
  if (b === null || typeof b !== 'object' || typeof b.length !== 'number') fail('LP_PARAM', `${bName} must be an array of numbers`);
  if (b.length !== rows) fail('LP_SHAPE', `${bName} has ${b.length} entries; ${aName} has ${rows} rows`);
  const v = new Float64Array(rows);
  for (let r = 0; r < rows; r++) {
    const x = b[r]!;
    if (typeof x !== 'number' || !Number.isFinite(x)) fail('LP_VALUE', `${bName}[${r}] is ${String(x)}; it must be finite`);
    v[r] = x;
  }
  return { A, b: v };
}

/** The bounds as two arrays, with null as ±Infinity. */
function boundsOf(bounds: Bound | readonly Bound[] | undefined, n: number): { lo: Float64Array; up: Float64Array } {
  const lo = new Float64Array(n);
  const up = new Float64Array(n).fill(Infinity);
  if (bounds === undefined) return { lo, up };
  if (!Array.isArray(bounds)) fail('LP_PARAM', 'bounds must be [lower, upper] or a list of them');
  const single = bounds.length === 2 && !Array.isArray(bounds[0]) && !Array.isArray(bounds[1]);
  if (!single && bounds.length !== n) fail('LP_SHAPE', `bounds has ${bounds.length} pairs; c has ${n} variables`);
  for (let j = 0; j < n; j++) {
    const pair = (single ? bounds : bounds[j]) as Bound;
    if (!Array.isArray(pair) || pair.length !== 2) fail('LP_PARAM', `bounds[${j}] must be [lower, upper]`);
    const [l, u] = pair;
    const lv = l === null ? -Infinity : l;
    const uv = u === null ? Infinity : u;
    if (typeof lv !== 'number' || Number.isNaN(lv) || lv === Infinity) fail('LP_VALUE', `variable ${j}'s lower bound is ${String(l)}; it must be a number below Infinity, or null`);
    if (typeof uv !== 'number' || Number.isNaN(uv) || uv === -Infinity) fail('LP_VALUE', `variable ${j}'s upper bound is ${String(u)}; it must be a number above -Infinity, or null`);
    lo[j] = lv;
    up[j] = uv;
  }
  return { lo, up };
}
