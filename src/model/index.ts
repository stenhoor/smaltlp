/**
 * The modelling layer, in PuLP's style (smaltworks ADR 0039, section 3): variables, linear expressions, constraints
 * and an objective, by name, solved by the same dual simplex as `linprog()`.
 *
 * PuLP's names and meanings, adapted to TypeScript. TypeScript has no operator overloading, so `x + 2 * y <= 4`
 * is written `x.plus(y.times(2)).le(4)`, and `prob += …` is `prob.add(…)`: an expression sets the objective, a
 * constraint is added. A `name` is optional, as in PuLP.
 *
 * <!-- docs:skip -->
 * ```ts
 * const prob = new LpProblem('plan', 'maximize');
 * const x = new LpVariable('x', { lowBound: 0 });
 * const y = new LpVariable('y', { lowBound: 0 });
 * prob.add(x.times(3).plus(y.times(5)));
 * prob.add(x.le(4), 'plant1');
 * prob.add(y.times(2).le(12), 'plant2');
 * prob.add(x.times(3).plus(y.times(2)).le(18), 'plant3');
 * await prob.solve(); // 1: LpStatus[1] is 'Optimal'
 * x.varValue; // 2
 * value(prob.objective); // 36
 * ```
 * @module
 */
import { fail } from '../core/errors.ts';
import { fromTriplets } from '../core/sparse.ts';
import { dualSimplex, type Status } from '../lp/simplex.ts';

/** A variable's category, as PuLP names them. Only `'Continuous'` solves until `milp()` (phase 2). */
export type Category = 'Continuous' | 'Integer' | 'Binary';

/** What an expression can be built from: a variable, an expression, or a number. */
export type Term = LpVariable | LpAffineExpression | number;

export interface VariableOptions {
  /** The lower bound; `null` (or -Infinity) for none. Default `null`, as in PuLP. */
  lowBound?: number | null;
  /** The upper bound; `null` (or Infinity) for none. Default `null`. */
  upBound?: number | null;
  /** Default `'Continuous'`. */
  cat?: Category;
}

/**
 * A decision variable. After a solve, `varValue` holds its value and `dj` its reduced cost, as in PuLP.
 */
export class LpVariable {
  readonly name: string;
  readonly lowBound: number | null;
  readonly upBound: number | null;
  readonly cat: Category;
  /** The value from the last solve that included it, or null. */
  varValue: number | null = null;
  /** The reduced cost from the last solve: the objective's change per unit the variable moves off its bound. */
  dj: number | null = null;

  constructor(name: string, options: VariableOptions = {}) {
    if (typeof name !== 'string' || name === '') fail('LP_PARAM', 'a variable needs a name');
    if (/\s/.test(name)) fail('LP_PARAM', `variable name '${name}' has a space; names are used in LP and MPS files`);
    const cat = options.cat ?? 'Continuous';
    if (cat !== 'Continuous' && cat !== 'Integer' && cat !== 'Binary') fail('LP_PARAM', `cat is 'Continuous', 'Integer' or 'Binary', not ${String(cat)}`);
    let lo = options.lowBound ?? null;
    let up = options.upBound ?? null;
    if (cat === 'Binary') {
      lo = 0;
      up = 1;
    }
    for (const [label, v] of [['lowBound', lo], ['upBound', up]] as const) {
      if (v !== null && (typeof v !== 'number' || Number.isNaN(v))) fail('LP_VALUE', `${name}: ${label} is ${String(v)}; it must be a number or null`);
    }
    if (lo === -Infinity) lo = null;
    if (up === Infinity) up = null;
    if (lo === Infinity || up === -Infinity) fail('LP_VALUE', `${name}: a bound of ${lo === Infinity ? 'lowBound Infinity' : 'upBound -Infinity'} leaves no value`);
    this.name = name;
    this.lowBound = lo;
    this.upBound = up;
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
    return new LpConstraint(this.minus(rhs), 'le');
  }
  /** `this ≥ rhs`. */
  ge(rhs: Term): LpConstraint {
    return new LpConstraint(this.minus(rhs), 'ge');
  }
  /** `this = rhs`. */
  eq(rhs: Term): LpConstraint {
    return new LpConstraint(this.minus(rhs), 'eq');
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
 * expression's constant. After a solve, `pi` is its dual value and `slack` its slack.
 */
export class LpConstraint {
  readonly expression: LpAffineExpression;
  readonly sense: 'le' | 'ge' | 'eq';
  /** The name given when it was added to a problem. */
  name: string | null = null;
  /** The objective's change per unit of the right-hand side, in the problem's own sense, from the last solve. */
  pi: number | null = null;
  /** How far the constraint is from binding: rhs − lhs for ≤, lhs − rhs for ≥, 0 for =. From the last solve. */
  slack: number | null = null;

  constructor(expression: LpAffineExpression, sense: 'le' | 'ge' | 'eq') {
    this.expression = expression;
    this.sense = sense;
  }

  /** The right-hand side, with every variable on the left: −constant. */
  get rhs(): number {
    return -this.expression.constant;
  }
}

/** The status codes of {@link LpProblem.solve}, as PuLP numbers them. */
export const LpStatus: Readonly<Record<number, string>> = {
  1: 'Optimal',
  0: 'Not Solved',
  [-1]: 'Infeasible',
  [-2]: 'Unbounded',
  [-3]: 'Undefined',
};

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
}

/** A linear program, built up by {@link add}: an objective to minimize or maximize, and named constraints. */
export class LpProblem {
  readonly name: string;
  readonly sense: 'minimize' | 'maximize';
  /** The objective, or null if none was set (then any feasible point is optimal). */
  objective: LpAffineExpression | null = null;
  /** The constraints, by name, in the order they were added. */
  readonly constraints = new Map<string, LpConstraint>();
  /** The status of the last solve: PuLP's codes (see {@link LpStatus}); 0 before any. */
  status = 0;

  constructor(name = 'NoName', sense: 'minimize' | 'maximize' = 'minimize') {
    if (sense !== 'minimize' && sense !== 'maximize') fail('LP_PARAM', `sense is 'minimize' or 'maximize', not ${String(sense)}`);
    this.name = name;
    this.sense = sense;
  }

  /**
   * PuLP's `prob += …`: a constraint is added (named, or `_C1`, `_C2` … as PuLP does); anything else becomes the
   * objective, replacing any before it.
   */
  add(item: LpConstraint | Term, name?: string): this {
    if (item instanceof LpConstraint) this.addConstraint(item, name);
    else this.setObjective(item);
    return this;
  }

  setObjective(term: Term): void {
    this.objective = termOf(term);
  }

  addConstraint(constraint: LpConstraint, name?: string): void {
    if (!(constraint instanceof LpConstraint)) fail('LP_PARAM', 'addConstraint takes a constraint: build one with le(), ge() or eq()');
    const key = name ?? `_C${this.constraints.size + 1}`;
    if (this.constraints.has(key)) fail('LP_PARAM', `a constraint named '${key}' is already in the problem`);
    constraint.name = key;
    this.constraints.set(key, constraint);
  }

  /** The variables in the objective and the constraints, in the order they first appear. */
  variables(): LpVariable[] {
    const seen = new Set<LpVariable>();
    if (this.objective) for (const v of this.objective.terms.keys()) seen.add(v);
    for (const c of this.constraints.values()) for (const v of c.expression.terms.keys()) seen.add(v);
    const names = new Map<string, LpVariable>();
    for (const v of seen) {
      const other = names.get(v.name);
      if (other && other !== v) fail('LP_PARAM', `two different variables are named '${v.name}'`);
      names.set(v.name, v);
    }
    return [...seen];
  }

  /**
   * Solves the problem, and sets each variable's `varValue` and `dj` and each constraint's `pi` and `slack`. Resolves
   * to the status, as PuLP's solve() returns it. The asynchronous call gives exactly {@link solveSync}'s result.
   */
  async solve(options: SolveOptions = {}): Promise<number> {
    return this.solveSync(options);
  }

  /** {@link solve}, synchronously. */
  solveSync(options: SolveOptions = {}): number {
    const vars = this.variables();
    for (const v of vars) {
      if (v.cat !== 'Continuous') fail('LP_UNSUPPORTED', `${v.name} is ${v.cat}: integer variables come with milp() in phase 2`);
    }
    const tol = options.tol ?? 1e-7;
    if (typeof tol !== 'number' || !(tol > 0) || tol >= 1) fail('LP_PARAM', `tol must be above 0 and below 1, not ${String(tol)}`);
    const maxIter = options.maxIter ?? 2 ** 31 - 1;
    if (!Number.isInteger(maxIter) || maxIter < 0) fail('LP_PARAM', `maxIter must be a whole number, 0 or more, not ${String(maxIter)}`);

    const n = vars.length;
    const index = new Map(vars.map((v, j) => [v, j]));
    const sign = this.sense === 'maximize' ? -1 : 1;
    const c = new Float64Array(n);
    if (this.objective) for (const [v, a] of this.objective.terms) c[index.get(v)!]! += sign * a;
    const colLo = new Float64Array(n);
    const colUp = new Float64Array(n);
    vars.forEach((v, j) => {
      colLo[j] = v.lowBound ?? -Infinity;
      colUp[j] = v.upBound ?? Infinity;
    });
    const cons = [...this.constraints.values()];
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
      rowLo[r] = con.sense === 'le' ? -Infinity : rhs;
      rowUp[r] = con.sense === 'ge' ? Infinity : rhs;
    });

    for (const v of vars) {
      v.varValue = null;
      v.dj = null;
    }
    for (const con of cons) {
      con.pi = null;
      con.slack = null;
    }
    if (vars.some((v) => v.lowBound !== null && v.upBound !== null && v.lowBound > v.upBound)) return (this.status = -1);

    const A = fromTriplets(m, n, ii, jj, vv);
    const res = dualSimplex({ A, c, colLo, colUp, rowLo, rowUp }, { maxIter, primalTol: tol, dualTol: tol });
    this.status = STATUS[res.status];
    if (res.status !== 0) return this.status;
    vars.forEach((v, j) => {
      v.varValue = res.x[j]!;
      v.dj = sign * res.d[j]!;
    });
    cons.forEach((con, r) => {
      const activity = res.x[n + r]!;
      con.pi = sign * res.d[n + r]!;
      con.slack = con.sense === 'le' ? con.rhs - activity : con.sense === 'ge' ? activity - con.rhs : 0;
    });
    return this.status;
  }
}

/** linprog's status codes to PuLP's. */
const STATUS: Record<Status, number> = { 0: 1, 1: 0, 2: -1, 3: -2, 4: -3 };

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
