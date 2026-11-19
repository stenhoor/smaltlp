/**
 * The modelling layer, in PuLP 4.2's style (smaltworks ADR 0039, section 3; the owner, 2026-11-18: follow PuLP 4.2
 * only): a problem, its variables, linear expressions, constraints and an objective, solved by the same dual simplex as
 * `linprog()`.
 *
 * PuLP 4.2's names and meanings, in camelCase as the family writes them (`add_variable` is `addVariable`,
 * `get_constraint_by_name` is `getConstraintByName`, `status_str` is `statusStr`). TypeScript has no operator
 * overloading, so `x + 2 * y <= 4` is written `x.plus(y.times(2)).le(4)`, and `prob += …` is `prob.add(…)`: an
 * expression sets the objective, a constraint is added.
 *
 * <!-- docs:skip -->
 * ```ts
 * const prob = new LpProblem('plan', LpMaximize);
 * const x = prob.addVariable('x', 0);
 * const y = prob.addVariable('y', 0);
 * prob.add(x.times(3).plus(y.times(5)));
 * prob.add(x.le(4), 'plant1');
 * prob.add(y.times(2).le(12), 'plant2');
 * prob.add(x.times(3).plus(y.times(2)).le(18), 'plant3');
 * const stats = await prob.solve(); // stats.status === LpSolveStatus.Optimal
 * x.varValue; // 2
 * value(prob.objective); // 36
 * ```
 * @module
 */
import { fail } from '../core/errors.ts';
import { fromTriplets } from '../core/sparse.ts';
import { solve } from '../lp/presolve.ts';
import type { Status } from '../lp/simplex.ts';
import { branchAndBound, type BranchEnd } from '../mip/branch.ts';

/** Minimize: PuLP's LpMinimize, 1. */
export const LpMinimize = 1;
/** Maximize: PuLP's LpMaximize, -1. */
export const LpMaximize = -1;
export type Sense = typeof LpMinimize | typeof LpMaximize;

/** A constraint's sense, as PuLP numbers them: ≤ is -1, = is 0, ≥ is 1. */
export const LpConstraintLE = -1;
export const LpConstraintEQ = 0;
export const LpConstraintGE = 1;
export type ConstraintSense = typeof LpConstraintLE | typeof LpConstraintEQ | typeof LpConstraintGE;

/**
 * How a solve ended: PuLP 4.2's LpSolveStatus codes. smaltlp gives Optimal, Infeasible, Unbounded, IterationLimit
 * (when `maxIter` stops a linear program), TimeLimit and NodeLimit (an integer program's limits), Undefined (an integer
 * program whose relaxation is unbounded: unbounded or infeasible, as PuLP 4.2 reports it through HiGHS) and
 * NumericalError; NotSolved before any solve.
 */
export const LpSolveStatus = {
  NotSolved: 0,
  Optimal: 1,
  Infeasible: -1,
  Unbounded: -2,
  Undefined: -3,
  TimeLimit: -4,
  MemoryLimit: -5,
  NodeLimit: -6,
  GapLimit: -7,
  IterationLimit: -8,
  SolutionLimit: -9,
  Interrupted: -10,
  Stopped: -11,
  NumericalError: -12,
} as const;
export type SolveStatus = (typeof LpSolveStatus)[keyof typeof LpSolveStatus];

/** A status code's name, as PuLP's status_str gives it. */
function statusName(code: SolveStatus): string {
  return Object.entries(LpSolveStatus).find(([, v]) => v === code)![0];
}

/** A variable's category. `'Binary'` is an integer variable in [0, 1]. */
export type Category = 'Continuous' | 'Integer' | 'Binary';

/** What an expression can be built from: a variable, an expression, or a number. */
export type Term = LpVariable | LpAffineExpression | number;

/** Only LpProblem.addVariable() makes variables, as in PuLP 4.2. */
const MAKE = Symbol('LpVariable');

/**
 * A decision variable, made by {@link LpProblem.addVariable} and bound to that problem. After a solve, `varValue`
 * holds its value and `dj` its reduced cost (null for an integer program, which has none).
 */
export class LpVariable {
  readonly name: string;
  readonly lowBound: number | null;
  readonly upBound: number | null;
  readonly cat: Category;
  /** The problem the variable belongs to. */
  readonly problem: LpProblem;
  /** The value from the last solve, or null. */
  varValue: number | null = null;
  /** The reduced cost from the last solve: the objective's change per unit the variable moves off its bound. */
  dj: number | null = null;

  /** @internal Use {@link LpProblem.addVariable}. */
  constructor(token: symbol, problem: LpProblem, name: string, lowBound: number | null, upBound: number | null, cat: Category) {
    if (token !== MAKE) fail('LP_PARAM', 'variables come from a problem: use prob.addVariable(name, lowBound, upBound, cat)');
    this.problem = problem;
    this.name = name;
    this.lowBound = lowBound;
    this.upBound = upBound;
    this.cat = cat;
  }

  /** This variable as an expression: 1 × itself. */
  toExpression(): LpAffineExpression {
    return new LpAffineExpression(new Map([[this, 1]]), 0);
  }
  plus(...terms: Term[]): LpAffineExpression {
    return this.toExpression().plus(...terms);
  }
  minus(term: Term): LpAffineExpression {
    return this.toExpression().minus(term);
  }
  times(k: number): LpAffineExpression {
    return this.toExpression().times(k);
  }
  le(rhs: Term): LpConstraint {
    return this.toExpression().le(rhs);
  }
  ge(rhs: Term): LpConstraint {
    return this.toExpression().ge(rhs);
  }
  eq(rhs: Term): LpConstraint {
    return this.toExpression().eq(rhs);
  }
  toString(): string {
    return this.name;
  }
}

/** A linear expression: a sum of coefficients times variables, plus a constant. Immutable: each method returns a new one. */
export class LpAffineExpression {
  /** The coefficient of each variable; a variable not in the map has 0. */
  readonly terms: ReadonlyMap<LpVariable, number>;
  readonly constant: number;

  constructor(terms: ReadonlyMap<LpVariable, number> = new Map(), constant = 0) {
    this.terms = terms;
    this.constant = constant;
  }

  /** The sum of this and every term. */
  plus(...terms: Term[]): LpAffineExpression {
    const out = new Map(this.terms);
    let k = this.constant;
    for (const t of terms) k += addInto(out, t, 1);
    return new LpAffineExpression(out, k);
  }
  minus(term: Term): LpAffineExpression {
    const out = new Map(this.terms);
    const k = this.constant + addInto(out, term, -1);
    return new LpAffineExpression(out, k);
  }
  times(k: number): LpAffineExpression {
    finite(k, 'a multiplier');
    const out = new Map<LpVariable, number>();
    for (const [v, a] of this.terms) out.set(v, a * k);
    return new LpAffineExpression(out, this.constant * k);
  }
  /** `this ≤ rhs`. */
  le(rhs: Term): LpConstraint {
    return new LpConstraint(this.minus(rhs), LpConstraintLE);
  }
  /** `this ≥ rhs`. */
  ge(rhs: Term): LpConstraint {
    return new LpConstraint(this.minus(rhs), LpConstraintGE);
  }
  /** `this = rhs`. */
  eq(rhs: Term): LpConstraint {
    return new LpConstraint(this.minus(rhs), LpConstraintEQ);
  }
  toString(): string {
    const parts: string[] = [];
    for (const [v, a] of this.terms) if (a !== 0) parts.push(`${a === 1 ? '' : a === -1 ? '-' : `${a}*`}${v.name}`);
    if (this.constant !== 0 || parts.length === 0) parts.push(String(this.constant));
    return parts.join(' + ').replace(/\+ -/g, '- ');
  }
}

/**
 * A constraint: an expression and a sense, `expression ≤ 0`, `≥ 0` or `= 0`, with the right-hand side folded into the
 * expression's constant (`constant` is −rhs, as in PuLP). After a solve, `pi` is its dual value and `slack` its slack.
 */
export class LpConstraint {
  readonly expression: LpAffineExpression;
  readonly sense: ConstraintSense;
  /** The name given when it was added to a problem, or `_C1`, `_C2` … */
  name: string | null = null;
  /**
   * The objective's change per unit of the right-hand side, in the problem's own sense, from the last solve. Null for
   * an integer program, which has no duals.
   */
  pi: number | null = null;
  /** How far the constraint is from binding: rhs − lhs for ≤, lhs − rhs for ≥, 0 for =. From the last solve. */
  slack: number | null = null;

  constructor(expression: LpAffineExpression, sense: ConstraintSense) {
    this.expression = expression;
    this.sense = sense;
  }

  /** The expression's constant: −rhs, with every variable on the left. */
  get constant(): number {
    return this.expression.constant;
  }
  /** The right-hand side. */
  get rhs(): number {
    return -this.expression.constant;
  }
  toString(): string {
    const lhs = new LpAffineExpression(this.expression.terms, 0).toString();
    return `${lhs} ${this.sense === LpConstraintLE ? '<=' : this.sense === LpConstraintGE ? '>=' : '='} ${this.rhs}`;
  }
}

/** The sum of the terms, as an expression: PuLP's lpSum. */
export function lpSum(terms: Iterable<Term>): LpAffineExpression {
  return new LpAffineExpression().plus(...terms);
}

/** The sum of a[i] × b[i]: PuLP's lpDot, with the numbers on one side. */
export function lpDot(a: readonly number[], b: readonly Term[]): LpAffineExpression {
  if (a.length !== b.length) fail('LP_SHAPE', `lpDot: ${a.length} numbers and ${b.length} terms`);
  return lpSum(b.map((t, i) => termOf(t).times(a[i]!)));
}

/** The value of an expression or variable from the last solve, as PuLP's value(); null if a variable has no value. */
export function value(term: Term | null): number | null {
  if (term === null) return null;
  if (typeof term === 'number') return term;
  if (term instanceof LpVariable) return term.varValue;
  let s = term.constant;
  for (const [v, a] of term.terms) {
    if (v.varValue === null) return null;
    s += a * v.varValue;
  }
  return s;
}

export interface SolveOptions {
  /** The most iterations. Default: no limit short of 2³¹. */
  maxIter?: number;
  /** Primal and dual feasibility tolerance. Default 1e-7. */
  tol?: number;
  /** Simplify the problem before solving it (each node's, for an integer program). Default true. */
  presolve?: boolean;
  /** An integer program's time limit, in seconds, as PuLP's solvers take it. Default: none. */
  timeLimit?: number;
  /** An integer program's relative gap, (objective − bound) / |objective|, at which it stops: PuLP's gapRel. Default 1e-4. */
  gapRel?: number;
  /** The most branch-and-bound nodes an integer program solves. Default: no limit. */
  nodeLimit?: number;
}

/** What a solve reports: PuLP 4.2's LpSolveStats, the fields smaltlp has, in camelCase. */
export interface LpSolveStats {
  solver: 'smaltlp';
  status: SolveStatus;
  /** The status's name, such as 'Optimal'. */
  statusStr: string;
  hasSolution: boolean;
  /** The objective's value, or null without a solution. */
  objective: number | null;
  numVariables: number;
  numConstraints: number;
  isMip: boolean;
  /** An integer program's lowest bound on the optimum, in the problem's own sense (its highest when maximizing); null for a linear program. */
  bestBound: number | null;
  /** Seconds the solve took. */
  time: number;
}

/** A linear program: its variables (made by {@link addVariable}), an objective, and named constraints. */
export class LpProblem {
  readonly name: string;
  readonly sense: Sense;
  /** The objective, or null if none was set (then any feasible point is optimal). */
  objective: LpAffineExpression | null = null;
  private readonly vars: LpVariable[] = [];
  private readonly cons: LpConstraint[] = [];
  private readonly byName = new Map<string, LpConstraint>();

  constructor(name = 'NoName', sense: Sense = LpMinimize) {
    if (sense !== LpMinimize && sense !== LpMaximize) fail('LP_PARAM', `sense is LpMinimize (1) or LpMaximize (-1), not ${String(sense)}`);
    this.name = name;
    this.sense = sense;
  }

  /**
   * Makes a variable in this problem, as PuLP 4.2's add_variable: bounds are finite numbers or null for none (an
   * infinite bound fails, as in PuLP). Spaces in the name become underscores, as PuLP makes them.
   */
  addVariable(name: string, lowBound: number | null = null, upBound: number | null = null, cat: Category = 'Continuous'): LpVariable {
    if (typeof name !== 'string' || name === '') fail('LP_PARAM', 'a variable needs a name');
    if (cat !== 'Continuous' && cat !== 'Integer' && cat !== 'Binary') fail('LP_PARAM', `cat is 'Continuous', 'Integer' or 'Binary', not ${String(cat)}`);
    for (const [label, v] of [['lowBound', lowBound], ['upBound', upBound]] as const) {
      if (v !== null && (typeof v !== 'number' || !Number.isFinite(v))) {
        fail('LP_VALUE', `${name}: ${label} is ${String(v)}; a bound must be a finite number, or null for none`);
      }
    }
    const v = cat === 'Binary' ? new LpVariable(MAKE, this, name.replace(/\s/g, '_'), 0, 1, cat) : new LpVariable(MAKE, this, name.replace(/\s/g, '_'), lowBound, upBound, cat);
    this.vars.push(v);
    return v;
  }

  /**
   * PuLP's `prob += …`: a constraint is added (named, or `_C1`, `_C2` … as PuLP names them); anything else becomes the
   * objective, replacing any before it.
   */
  add(item: LpConstraint | Term, name?: string): this {
    if (item instanceof LpConstraint) this.addConstraint(item, name);
    else this.setObjective(item);
    return this;
  }

  setObjective(term: Term): void {
    const e = termOf(term);
    this.ownTerms(e);
    this.objective = e;
  }

  addConstraint(constraint: LpConstraint, name?: string): LpConstraint {
    if (!(constraint instanceof LpConstraint)) fail('LP_PARAM', 'addConstraint takes a constraint: build one with le(), ge() or eq()');
    this.ownTerms(constraint.expression);
    const key = name ?? `_C${this.cons.length + 1}`;
    if (this.byName.has(key)) fail('LP_PARAM', `a constraint named '${key}' is already in the problem`);
    constraint.name = key;
    this.cons.push(constraint);
    this.byName.set(key, constraint);
    return constraint;
  }

  /** Every variable added to the problem, in order, used or not. */
  variables(): LpVariable[] {
    return [...this.vars];
  }

  /** The constraints, in the order they were added. */
  constraints(): LpConstraint[] {
    return [...this.cons];
  }

  /** The constraint with this name, or null. */
  getConstraintByName(name: string): LpConstraint | null {
    return this.byName.get(name) ?? null;
  }

  numVariables(): number {
    return this.vars.length;
  }

  numConstraints(): number {
    return this.cons.length;
  }

  /** Whether any variable is integer or binary. */
  isMIP(): boolean {
    return this.vars.some((v) => v.cat !== 'Continuous');
  }

  /**
   * Solves the problem, and sets each variable's `varValue` and `dj` and each constraint's `pi` and `slack`. Resolves
   * to the solve's stats, as PuLP 4.2's solve() returns them. The asynchronous call gives exactly
   * {@link solveSync}'s result, its time aside.
   */
  async solve(options: SolveOptions = {}): Promise<LpSolveStats> {
    return this.solveSync(options);
  }

  /** {@link solve}, synchronously. */
  solveSync(options: SolveOptions = {}): LpSolveStats {
    const start = performance.now();
    const mip = this.isMIP();
    const tol = options.tol ?? 1e-7;
    if (typeof tol !== 'number' || !(tol > 0) || tol >= 1) fail('LP_PARAM', `tol must be above 0 and below 1, not ${String(tol)}`);
    const maxIter = options.maxIter ?? 2 ** 31 - 1;
    if (!Number.isInteger(maxIter) || maxIter < 0) fail('LP_PARAM', `maxIter must be a whole number, 0 or more, not ${String(maxIter)}`);

    const vars = this.vars;
    const n = vars.length;
    const index = new Map(vars.map((v, j) => [v, j]));
    const sign = this.sense === LpMaximize ? -1 : 1;
    const c = new Float64Array(n);
    if (this.objective) for (const [v, a] of this.objective.terms) c[index.get(v)!]! += sign * a;
    const colLo = new Float64Array(n);
    const colUp = new Float64Array(n);
    vars.forEach((v, j) => {
      colLo[j] = v.lowBound ?? -Infinity;
      colUp[j] = v.upBound ?? Infinity;
    });
    const cons = this.cons;
    const m = cons.length;
    const ii: number[] = [];
    const jj: number[] = [];
    const vv: number[] = [];
    const rowLo = new Float64Array(m);
    const rowUp = new Float64Array(m);
    cons.forEach((con, r) => {
      for (const [v, a] of con.expression.terms) {
        if (a === 0) continue;
        ii.push(r);
        jj.push(index.get(v)!);
        vv.push(a);
      }
      const rhs = con.rhs;
      rowLo[r] = con.sense === LpConstraintLE ? -Infinity : rhs;
      rowUp[r] = con.sense === LpConstraintGE ? Infinity : rhs;
    });

    for (const v of vars) {
      v.varValue = null;
      v.dj = null;
    }
    for (const con of cons) {
      con.pi = null;
      con.slack = null;
    }
    const stats = (status: SolveStatus, objective: number | null, bestBound: number | null = null): LpSolveStats => ({
      solver: 'smaltlp', status, statusStr: statusName(status), hasSolution: objective !== null, objective,
      numVariables: n, numConstraints: m, isMip: mip, bestBound, time: (performance.now() - start) / 1000,
    });
    if (vars.some((v) => v.lowBound !== null && v.upBound !== null && v.lowBound > v.upBound)) return stats(LpSolveStatus.Infeasible, null);

    const A = fromTriplets(m, n, ii, jj, vv);
    const presolve = options.presolve ?? true;
    if (typeof presolve !== 'boolean') fail('LP_PARAM', `presolve is true or false, not ${String(presolve)}`);
    const lp = { A, c, colLo, colUp, rowLo, rowUp };
    if (mip) {
      const timeLimit = options.timeLimit ?? Infinity;
      if (typeof timeLimit !== 'number' || !(timeLimit >= 0)) fail('LP_PARAM', `timeLimit must be a number of seconds, 0 or more, not ${String(timeLimit)}`);
      const relGap = options.gapRel ?? 1e-4;
      if (typeof relGap !== 'number' || !(relGap >= 0) || relGap === Infinity) fail('LP_PARAM', `gapRel must be a number, 0 or more, not ${String(relGap)}`);
      const nodeLimit = options.nodeLimit ?? Infinity;
      if (nodeLimit !== Infinity && (!Number.isInteger(nodeLimit) || nodeLimit < 0)) fail('LP_PARAM', `nodeLimit must be a whole number, 0 or more, not ${String(nodeLimit)}`);
      const integer = Uint8Array.from(vars, (v) => (v.cat === 'Continuous' ? 0 : 1));
      const b = branchAndBound(lp, { integer, relGap, nodeLimit, timeLimit, presolve, tol, maxIter });
      const bound = Number.isFinite(b.dualBound) ? sign * b.dualBound : null;
      if (!b.x) return stats(MIP_STATUS[b.end], null, bound);
      const x = b.x;
      vars.forEach((v, j) => (v.varValue = x[j]!));
      cons.forEach((con) => {
        const activity = value(con.expression)! - con.constant;
        con.slack = con.sense === LpConstraintLE ? con.rhs - activity : con.sense === LpConstraintGE ? activity - con.rhs : 0;
      });
      return stats(MIP_STATUS[b.end], value(this.objective) ?? 0, bound);
    }
    const res = solve(lp, { maxIter, primalTol: tol, dualTol: tol, presolve });
    if (res.status !== 0) return stats(STATUS[res.status], null);
    vars.forEach((v, j) => {
      v.varValue = res.x[j]!;
      v.dj = sign * res.d[j]!;
    });
    cons.forEach((con, r) => {
      const activity = res.x[n + r]!;
      con.pi = sign * res.d[n + r]!;
      con.slack = con.sense === LpConstraintLE ? con.rhs - activity : con.sense === LpConstraintGE ? activity - con.rhs : 0;
    });
    return stats(LpSolveStatus.Optimal, value(this.objective) ?? 0);
  }

  /** Every variable in an expression must be this problem's, as PuLP 4.2 requires. */
  private ownTerms(e: LpAffineExpression): void {
    for (const v of e.terms.keys()) {
      if (v.problem !== this) fail('LP_PARAM', `${v.name} belongs to another problem ('${v.problem.name}'); a problem uses only its own variables`);
    }
  }
}

/**
 * linprog's status codes to PuLP 4.2's. The iteration limit and numerical trouble map to IterationLimit and
 * NumericalError, the codes PuLP 4.2 has for them; the compare tests check Optimal, Infeasible and Unbounded.
 */
const STATUS: Record<Status, SolveStatus> = {
  0: LpSolveStatus.Optimal,
  1: LpSolveStatus.IterationLimit,
  2: LpSolveStatus.Infeasible,
  3: LpSolveStatus.Unbounded,
  4: LpSolveStatus.NumericalError,
};

/** How branch-and-bound ended, as PuLP 4.2's codes. */
const MIP_STATUS: Record<BranchEnd, SolveStatus> = {
  optimal: LpSolveStatus.Optimal,
  infeasible: LpSolveStatus.Infeasible,
  unboundedOrInfeasible: LpSolveStatus.Undefined,
  nodeLimit: LpSolveStatus.NodeLimit,
  timeLimit: LpSolveStatus.TimeLimit,
  numerical: LpSolveStatus.NumericalError,
};

/** A term as an expression. */
function termOf(t: Term): LpAffineExpression {
  if (t instanceof LpAffineExpression) return t;
  if (t instanceof LpVariable) return t.toExpression();
  finite(t, 'a constant');
  return new LpAffineExpression(new Map(), t);
}

/** Adds k × term into the map; returns what it adds to the constant. */
function addInto(out: Map<LpVariable, number>, t: Term, k: number): number {
  if (t instanceof LpVariable) {
    out.set(t, (out.get(t) ?? 0) + k);
    return 0;
  }
  if (t instanceof LpAffineExpression) {
    for (const [v, a] of t.terms) out.set(v, (out.get(v) ?? 0) + k * a);
    return k * t.constant;
  }
  finite(t, 'a constant');
  return k * t;
}

function finite(v: unknown, what: string): asserts v is number {
  if (typeof v !== 'number' || !Number.isFinite(v)) fail('LP_VALUE', `${what} must be a finite number, not ${String(v)}`);
}
