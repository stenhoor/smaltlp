---
description: 'LpProblem: a linear program built by name, in PuLP 4.2''s style: variables, an objective, constraints and solve().'
---

# LpProblem

<!-- docs:skip -->
```ts
class LpProblem {
  constructor(name?: string, sense?: typeof LpMinimize | typeof LpMaximize);
  readonly name: string;
  readonly sense: 1 | -1;
  objective: LpAffineExpression | null;
  addVariable(name: string, lowBound?: number | null, upBound?: number | null, cat?: 'Continuous' | 'Integer' | 'Binary'): LpVariable;
  add(item: LpConstraint | LpVariable | LpAffineExpression | number, name?: string): this;
  setObjective(term: LpVariable | LpAffineExpression | number): void;
  addConstraint(constraint: LpConstraint, name?: string): LpConstraint;
  variables(): LpVariable[];
  constraints(): LpConstraint[];
  getConstraintByName(name: string): LpConstraint | null;
  numVariables(): number;
  numConstraints(): number;
  isMIP(): boolean;
  solve(options?: { maxIter?: number; tol?: number; presolve?: boolean }): Promise<LpSolveStats>;
  solveSync(options?: { maxIter?: number; tol?: number; presolve?: boolean }): LpSolveStats;
}
```

A linear program built by name: its variables, an objective, and named constraints. PuLP 4.2's
[`LpProblem`](https://coin-or.github.io/pulp/), in camelCase (`add_variable` is `addVariable`).

## Parameters

- `name` (default `'NoName'`): the problem's name.
- `sense` (default `LpMinimize`): `LpMinimize` (1) or `LpMaximize` (-1).

`addVariable(name, lowBound, upBound, cat)` makes a variable that belongs to this problem: bounds are finite numbers,
or `null` (the default) for none; `cat` is `'Continuous'` (the default), `'Integer'` or `'Binary'` (0 to 1). Spaces in
the name become underscores.

`add(item, name)` is PuLP's `+=`: a constraint is added, named `name` or `_C1`, `_C2` … in order; anything else
becomes the objective, replacing the one before.

## Returns

`solve()` resolves to an `LpSolveStats`, PuLP 4.2's fields in camelCase: `solver` (`'smaltlp'`), `status` and
`statusStr` ([`LpSolveStatus`](./lp-solve-status)), `hasSolution`, `objective` (`null` without a solution),
`numVariables`, `numConstraints`, `isMip`, `bestBound` and `time` (seconds). After an optimal solve, each variable's
`varValue` and `dj`, and each constraint's `pi` and `slack`, are set; otherwise they are `null`.

A problem with an `'Integer'` or `'Binary'` variable is an integer program, solved by branch-and-bound as
[`milp`](../milp) solves it. Then `isMip` is `true`; `bestBound` is the bound the search proved, in the problem's own
sense; `varValue` and `slack` are set wherever a solution was found, even when a limit stopped the search; and `dj` and
`pi` stay `null`, since an integer program has no duals. For a linear program, `bestBound` is `null`.

`solve(options)` takes `maxIter`, `tol` and `presolve`, and for an integer program `timeLimit` (seconds), `gapRel`
(default 1e-4: stop once the answer is within this of the bound, relative) and `nodeLimit`.

## Errors

- `LP_PARAM`: a `sense` other than 1 or -1; a variable with no name or an unknown `cat`; a second constraint with a
  name already used; a variable from another problem in the objective or a constraint; `tol`, `maxIter`, `timeLimit`,
  `gapRel` or `nodeLimit` out of range.
- `LP_VALUE`: a bound that is NaN or infinite.

## Notes

`solve()` runs the same presolve and dual simplex as [`linprog`](../linprog), in 64-bit floats (`presolve: false` turns
the presolve off). A maximization is solved as the
minimization of its negative; `pi` and `dj` are given in the problem's own sense, as PuLP gives them. The compare tests
check statuses, values, `pi`, `dj` and `slack` against PuLP 4.2.0 with HiGHS, and integer programs' statuses and
objectives. `variables()` lists every variable
added, used or not, as in PuLP 4.2. A problem with no objective finds any feasible point.

## Examples

```ts
import { LpProblem, LpMinimize, value } from '@smaltworks/smaltlp';

const prob = new LpProblem('mix', LpMinimize);
const a = prob.addVariable('a', 0);
const b = prob.addVariable('b', 0);
prob.add(a.times(2).plus(b.times(3)));
prob.add(a.plus(b).ge(4), 'need');
prob.add(b.ge(1), 'least_b');
const stats = await prob.solve();
({ status: stats.statusStr, a: a.varValue, b: b.varValue, cost: value(prob.objective) })
```

| status | a | b | cost |
| --- | --- | --- | --- |
| Optimal | 3 | 1 | 9 |

```ts
({ variables: prob.numVariables(), constraints: prob.numConstraints(), need: prob.getConstraintByName('need')!.pi })
```

| variables | constraints | need |
| --- | --- | --- |
| 2 | 2 | 2 |

## Working demo

```ts
import { LpProblem, LpMaximize, lpDot } from '@smaltworks/smaltlp';

// Blending: two crude oils into one product, at most 100 barrels, at least 30% of the light crude.
const blend = new LpProblem('blend', LpMaximize);
const light = blend.addVariable('light', 0, 70);
const heavy = blend.addVariable('heavy', 0, 80);
blend.add(lpDot([12, 9], [light, heavy]));
blend.add(light.plus(heavy).le(100), 'capacity');
blend.add(light.times(0.7).minus(heavy.times(0.3)).ge(0), 'light_share');
const s = blend.solveSync();
({ status: s.statusStr, profit: s.objective, light: light.varValue, heavy: heavy.varValue })
```

| status | profit | light | heavy |
| --- | --- | --- | --- |
| Optimal | 1110 | 70 | 30 |

## See also

[`LpVariable`](./lp-variable), [`LpConstraint`](./lp-constraint), [Building a model](../../guide/models)
