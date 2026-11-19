/**
 * Models from tables (smaltworks ADR 0039, section 5): variables from the rows of a query result, constraints from a
 * table of limits and a table of terms, and the solution back as rows.
 *
 * A table is what smaltdb and smaltdf give, without importing either: an array of row objects (smaltdb's
 * `db.query()`, smaltdf's `toObjects()`), or `{ columns, rows }` with the rows as arrays (smaltdf's `collect()`).
 * Options name the columns to read; where an option can be a fixed value, a string is a column's name.
 * @module
 */
import { fail } from '../core/errors.ts';
import {
  LpAffineExpression,
  LpConstraint,
  LpConstraintEQ,
  LpConstraintGE,
  LpConstraintLE,
  lpDot,
  type Category,
  type ConstraintSense,
  type LpProblem,
  type LpVariable,
} from '../model/index.ts';

/** A table: row objects, or column names with the rows as arrays. */
export type Table = readonly Readonly<Record<string, unknown>>[] | { readonly columns: readonly string[]; readonly rows: readonly (readonly unknown[])[] };

/** The table's rows as objects. */
function objects(table: Table, what: string): Record<string, unknown>[] {
  if (Array.isArray(table)) {
    table.forEach((r, i) => {
      if (r === null || typeof r !== 'object') fail('LP_PARAM', `${what}: row ${i} isn't an object`);
    });
    return table as Record<string, unknown>[];
  }
  const t = table as { columns?: unknown; rows?: unknown };
  if (!t || !Array.isArray(t.columns) || !Array.isArray(t.rows)) fail('LP_PARAM', `${what} must be an array of rows, or { columns, rows }`);
  const cols = t.columns as string[];
  return (t.rows as unknown[][]).map((r, i) => {
    if (!Array.isArray(r) || r.length !== cols.length) fail('LP_SHAPE', `${what}: row ${i} has ${Array.isArray(r) ? r.length : 'no'} values for ${cols.length} columns`);
    return Object.fromEntries(cols.map((c, k) => [c, r[k]]));
  });
}

function cell(row: Record<string, unknown>, column: string, i: number, what: string): unknown {
  if (!(column in row)) fail('LP_PARAM', `${what}: row ${i} has no column '${column}'`);
  return row[column];
}

/** A finite number from a cell (a bigint that fits, too); null where `nullable` and the cell is null. */
function numberCell(row: Record<string, unknown>, column: string, i: number, what: string, nullable: boolean): number | null {
  const v = cell(row, column, i, what);
  if (v === null || v === undefined) {
    if (nullable) return null;
    fail('LP_VALUE', `${what}: row ${i}'s '${column}' is empty`);
  }
  const n = typeof v === 'bigint' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n)) fail('LP_VALUE', `${what}: row ${i}'s '${column}' is ${String(v)}, not a finite number`);
  return n;
}

function nameCell(row: Record<string, unknown>, column: string, i: number, what: string): string {
  const v = cell(row, column, i, what);
  if (v === null || v === undefined || v === '') fail('LP_VALUE', `${what}: row ${i}'s '${column}' is empty; it names something`);
  return String(v);
}

export interface VariablesFrom {
  /** The column that names each row's variable. */
  name: string;
  /** A fixed lower bound for every variable (a number, or null for none), or the column holding each one. Default null. */
  lowBound?: number | null | string;
  /** A fixed upper bound, or the column holding each one. Default null. */
  upBound?: number | null | string;
  /** 'Continuous' (the default), 'Integer' or 'Binary' for every variable, or the column holding each one's. */
  cat?: string;
}

const CATEGORIES = new Set(['Continuous', 'Integer', 'Binary']);

/**
 * A variable for each row of `table`, added to `prob` and returned in row order: named by the `name` column, with
 * bounds and a category fixed or read from columns.
 */
export function addVariables(prob: LpProblem, table: Table, from: VariablesFrom): LpVariable[] {
  if (!from || typeof from.name !== 'string') fail('LP_PARAM', "addVariables needs { name: 'column' }");
  const rows = objects(table, 'addVariables');
  const seen = new Set(prob.variables().map((v) => v.name));
  const bound = (spec: number | null | string | undefined, row: Record<string, unknown>, i: number): number | null =>
    typeof spec === 'string' ? numberCell(row, spec, i, 'addVariables', true) : (spec ?? null);
  return rows.map((row, i) => {
    const name = nameCell(row, from.name, i, 'addVariables');
    if (seen.has(name)) fail('LP_PARAM', `addVariables: row ${i} names '${name}', a variable the problem already has`);
    seen.add(name);
    const cat = from.cat === undefined ? 'Continuous' : CATEGORIES.has(from.cat) ? from.cat : String(cell(row, from.cat, i, 'addVariables'));
    if (!CATEGORIES.has(cat)) fail('LP_VALUE', `addVariables: row ${i}'s category is '${cat}'; it is Continuous, Integer or Binary`);
    return prob.addVariable(name, bound(from.lowBound, row, i), bound(from.upBound, row, i), cat as Category);
  });
}

/** Σ row[column] × vars[i]: a numeric column of `table` dotted with the variables made from its rows, in order. */
export function dotColumn(table: Table, column: string, vars: readonly LpVariable[]): LpAffineExpression {
  const rows = objects(table, 'dotColumn');
  if (rows.length !== vars.length) fail('LP_SHAPE', `dotColumn: ${rows.length} rows and ${vars.length} variables`);
  return lpDot(rows.map((row, i) => numberCell(row, column, i, 'dotColumn', false)!), vars);
}

export interface LimitsFrom {
  /** The table of limits: one row per constraint. */
  rows: Table;
  /** The column naming each constraint. */
  name: string;
  /** The sense for every constraint ('<=', '>=', '='), or the column holding each one's ('<=', '>=', '=', or le, ge, eq). */
  sense: string;
  /** The column holding each constraint's right-hand side. */
  rhs: string;
}

export interface TermsFrom {
  /** The table of terms, one row per coefficient (long format). */
  rows: Table;
  /** The column naming the term's constraint, as the limits name it. */
  constraint: string;
  /** The column naming the term's variable, as the problem names it. */
  variable: string;
  /** The column holding the coefficient. */
  coefficient: string;
}

const SENSES: Record<string, ConstraintSense> = { '<=': LpConstraintLE, le: LpConstraintLE, '>=': LpConstraintGE, ge: LpConstraintGE, '=': LpConstraintEQ, '==': LpConstraintEQ, eq: LpConstraintEQ };

/**
 * A constraint for each row of the limits, added to `prob` under its name and returned in row order: Σ coefficient ×
 * variable over its rows in the terms table, with the limit's sense and right-hand side. A term for a constraint the
 * limits don't name, or a variable the problem doesn't have, fails; a limit with no terms is a constraint on nothing.
 */
export function addConstraints(prob: LpProblem, limits: LimitsFrom, terms: TermsFrom): LpConstraint[] {
  if (!limits || !terms) fail('LP_PARAM', 'addConstraints needs the limits and the terms');
  const lim = objects(limits.rows, 'addConstraints (limits)');
  const vars = new Map(prob.variables().map((v) => [v.name, v]));
  const order: string[] = [];
  const spec = new Map<string, { sense: ConstraintSense; rhs: number; terms: Map<LpVariable, number> }>();
  lim.forEach((row, i) => {
    const name = nameCell(row, limits.name, i, 'addConstraints (limits)');
    if (spec.has(name)) fail('LP_PARAM', `addConstraints (limits): row ${i} names '${name}' a second time`);
    const raw = limits.sense in SENSES ? limits.sense : String(cell(row, limits.sense, i, 'addConstraints (limits)'));
    const sense = SENSES[raw.toLowerCase()];
    if (sense === undefined) fail('LP_VALUE', `addConstraints (limits): row ${i}'s sense is '${raw}'; it is <=, >= or =`);
    spec.set(name, { sense, rhs: numberCell(row, limits.rhs, i, 'addConstraints (limits)', false)!, terms: new Map() });
    order.push(name);
  });
  objects(terms.rows, 'addConstraints (terms)').forEach((row, i) => {
    const c = nameCell(row, terms.constraint, i, 'addConstraints (terms)');
    const s = spec.get(c);
    if (!s) fail('LP_PARAM', `addConstraints (terms): row ${i} is for '${c}', which the limits don't name`);
    const vn = nameCell(row, terms.variable, i, 'addConstraints (terms)');
    const v = vars.get(vn);
    if (!v) fail('LP_PARAM', `addConstraints (terms): row ${i} names the variable '${vn}', which the problem doesn't have`);
    const a = numberCell(row, terms.coefficient, i, 'addConstraints (terms)', false)!;
    s.terms.set(v, (s.terms.get(v) ?? 0) + a);
  });
  return order.map((name) => {
    const s = spec.get(name)!;
    return prob.addConstraint(new LpConstraint(new LpAffineExpression(s.terms, -s.rhs), s.sense), name);
  });
}

/** The problem's variables as rows, after a solve: each one's name, value and reduced cost (null before a solve). */
export function variableRows(prob: LpProblem): { name: string; varValue: number | null; dj: number | null }[] {
  return prob.variables().map((v) => ({ name: v.name, varValue: v.varValue, dj: v.dj }));
}

/** The problem's constraints as rows, after a solve: each one's name, dual value and slack (null before a solve). */
export function constraintRows(prob: LpProblem): { name: string; pi: number | null; slack: number | null }[] {
  return prob.constraints().map((c) => ({ name: c.name ?? '', pi: c.pi, slack: c.slack }));
}

/** The table's rows as objects, each with `column` added: the value of the variable made from that row. */
export function withColumn(table: Table, vars: readonly LpVariable[], column = 'value'): Record<string, unknown>[] {
  const rows = objects(table, 'withColumn');
  if (rows.length !== vars.length) fail('LP_SHAPE', `withColumn: ${rows.length} rows and ${vars.length} variables`);
  return rows.map((row, i) => ({ ...row, [column]: vars[i]!.varValue }));
}
