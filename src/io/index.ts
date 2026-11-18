/**
 * Model files: reading MPS (smaltworks ADR 0039, section 5). Writing MPS, and the CPLEX LP format, come later.
 * @module
 */
import { LpAffineExpression, LpConstraint, LpConstraintEQ, LpConstraintGE, LpConstraintLE, LpMaximize, LpMinimize, LpProblem, type LpVariable } from '../model/index.ts';
import type { MpsModel } from './mps.ts';

export { readMps, type MpsModel, type MpsOptions } from './mps.ts';

/**
 * An {@link LpProblem} from a read MPS model, with a variable per column and a constraint per row, each by its name.
 * A row with both bounds finite and different (a ranged row) becomes two constraints: `name` for its lower side, ≥,
 * and `name_range` for its upper side, ≤; an E row stays one = constraint. Integer columns become 'Integer'
 * variables, which solve once milp() comes (phase 2). Spaces in names (possible in fixed MPS) become underscores, as
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
