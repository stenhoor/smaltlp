/**
 * Model files (smaltworks ADR 0039, section 5): MPS (free and fixed) and CPLEX LP, read and written, and the step
 * between a read model and an {@link LpProblem} each way.
 * @module
 */
import { LpAffineExpression, LpConstraint, LpConstraintEQ, LpConstraintGE, LpConstraintLE, LpMaximize, LpMinimize, LpProblem, type LpVariable } from '../model/index.ts';
import type { MpsModel } from './mps.ts';

export { readMps, writeMps, type MpsModel, type MpsOptions } from './mps.ts';
export { readLp, writeLp, type WriteOptions } from './lp.ts';

/**
 * An {@link LpProblem} from a read model (MPS or LP), with a variable per column and a constraint per row, each by its name.
 * A row with both bounds finite and different (a ranged row) becomes two constraints: `name` for its lower side, ≥,
 * and `name_range` for its upper side, ≤; an E row stays one = constraint. Integer columns become 'Integer'
 * variables. Spaces in names (possible in fixed MPS) become underscores, as
 * PuLP makes them.
 */
export function mpsToProblem(model: MpsModel): LpProblem {
  const prob = new LpProblem(model.name || 'NoName', model.sense === 'maximize' ? LpMaximize : LpMinimize);
  const vars = model.colNames.map((name, j) =>
    prob.addVariable(
      name,
      model.colLo[j] === -Infinity ? null : model.colLo[j]!,
      model.colUp[j] === Infinity ? null : model.colUp[j]!,
      model.integer[j] ? 'Integer' : 'Continuous',
    ),
  );
  const objective = new Map<LpVariable, number>();
  model.c.forEach((v, j) => {
    if (v !== 0) objective.set(vars[j]!, v);
  });
  prob.setObjective(new LpAffineExpression(objective, model.offset));
  const rows = model.rowNames.map(() => new Map<LpVariable, number>());
  const { row, col, value } = model.entries;
  for (let k = 0; k < value.length; k++) {
    const terms = rows[row[k]!]!;
    const v = vars[col[k]!]!;
    terms.set(v, (terms.get(v) ?? 0) + value[k]!);
  }
  model.rowNames.forEach((name, r) => {
    const lo = model.rowLo[r]!;
    const up = model.rowUp[r]!;
    const terms = rows[r]!;
    // The expression is a_r x − bound, with the bound folded into the constant.
    const side = (b: number, sense: typeof LpConstraintLE | typeof LpConstraintGE | typeof LpConstraintEQ) =>
      new LpConstraint(new LpAffineExpression(terms, -b), sense);
    if (lo === up) prob.addConstraint(side(lo, LpConstraintEQ), name);
    else if (lo === -Infinity) prob.addConstraint(side(up, LpConstraintLE), name);
    else if (up === Infinity) prob.addConstraint(side(lo, LpConstraintGE), name);
    else {
      prob.addConstraint(side(lo, LpConstraintGE), name);
      prob.addConstraint(side(up, LpConstraintLE), `${name}_range`);
    }
  });
  return prob;
}

/**
 * A model to write, from an {@link LpProblem}: a column per variable and a row per constraint, in the problem's
 * order and by their names, its sense, and the objective's constant. 'Binary' variables are integer from 0 to 1.
 */
export function problemToModel(prob: LpProblem): MpsModel {
  const vars = prob.variables();
  const cons = prob.constraints();
  const index = new Map(vars.map((v, j) => [v, j]));
  const c = new Float64Array(vars.length);
  let offset = 0;
  if (prob.objective) {
    for (const [v, a] of prob.objective.terms) {
      const j = index.get(v);
      if (j === undefined) continue;
      c[j]! += a;
    }
    offset = prob.objective.constant;
  }
  const ei: number[] = [];
  const ej: number[] = [];
  const ev: number[] = [];
  const rowLo = new Float64Array(cons.length);
  const rowUp = new Float64Array(cons.length);
  cons.forEach((con, r) => {
    for (const [v, a] of con.expression.terms) {
      if (a === 0) continue;
      ei.push(r);
      ej.push(index.get(v)!);
      ev.push(a);
    }
    rowLo[r] = con.sense === LpConstraintLE ? -Infinity : con.rhs;
    rowUp[r] = con.sense === LpConstraintGE ? Infinity : con.rhs;
  });
  return {
    name: prob.name,
    sense: prob.sense === LpMaximize ? 'maximize' : 'minimize',
    objectiveName: 'obj',
    offset,
    rowNames: cons.map((con) => con.name ?? ''),
    rowLo,
    rowUp,
    colNames: vars.map((v) => v.name),
    c,
    colLo: Float64Array.from(vars, (v) => v.lowBound ?? -Infinity),
    colUp: Float64Array.from(vars, (v) => v.upBound ?? Infinity),
    integer: Uint8Array.from(vars, (v) => (v.cat === 'Continuous' ? 0 : 1)),
    entries: { row: Int32Array.from(ei), col: Int32Array.from(ej), value: Float64Array.from(ev) },
  };
}
