---
description: 'LpVariable: a decision variable, made by addVariable() and bound to its problem. PuLP 4.2''s LpVariable.'
---

# LpVariable

<!-- docs:skip -->
```ts
class LpVariable {
  readonly name: string;
  readonly lowBound: number | null;
  readonly upBound: number | null;
  readonly cat: 'Continuous' | 'Integer' | 'Binary';
  readonly problem: LpProblem;
  varValue: number | null;
  dj: number | null;
  plus(...terms: (LpVariable | LpAffineExpression | number)[]): LpAffineExpression;
  minus(term: LpVariable | LpAffineExpression | number): LpAffineExpression;
  times(k: number): LpAffineExpression;
  le(rhs: LpVariable | LpAffineExpression | number): LpConstraint;
  ge(rhs: LpVariable | LpAffineExpression | number): LpConstraint;
  eq(rhs: LpVariable | LpAffineExpression | number): LpConstraint;
}
```

A decision variable. As in PuLP 4.2, variables come only from
[`prob.addVariable()`](./lp-problem) and belong to that problem; constructing one directly fails.

## Parameters

Given to `addVariable(name, lowBound, upBound, cat)`: see [`LpProblem`](./lp-problem#parameters).

## Returns

`plus`, `minus` and `times` give an [`LpAffineExpression`](./lp-affine-expression); `le`, `ge` and `eq` give an
[`LpConstraint`](./lp-constraint). After an optimal solve, `varValue` is the variable's value and `dj` its reduced
cost: the objective's change, in the problem's own sense, per unit the variable moves off its bound.

## Errors

- `LP_PARAM`: `new LpVariable(…)` directly; use `addVariable()`.
- `LP_VALUE`: `times` with a NaN or infinite factor.

## Notes

A `'Binary'` variable is `'Integer'` from 0 to 1, whatever bounds are given, as in PuLP.

## Examples

```ts
import { LpProblem } from '@smaltworks/smaltlp';

const prob = new LpProblem('vars');
const x = prob.addVariable('x', 0, 10);
const flag = prob.addVariable('flag', null, null, 'Binary');
const named = prob.addVariable('two words');
[x, flag, named].map((v) => ({ name: v.name, lowBound: v.lowBound, upBound: v.upBound, cat: v.cat }))
```

| name | lowBound | upBound | cat |
| --- | --- | --- | --- |
| x | 0 | 10 | Continuous |
| flag | 0 | 1 | Binary |
| two\_words | null | null | Continuous |

## Working demo

```ts
import { LpMinimize } from '@smaltworks/smaltlp';

const cheap = new LpProblem('cheap', LpMinimize);
const p = cheap.addVariable('p', 0);
const q = cheap.addVariable('q', 0);
cheap.add(p.times(2).plus(q.times(5)));
cheap.add(p.plus(q).ge(3), 'need');
await cheap.solve();
({ p: p.varValue, q: q.varValue, dj_q: q.dj })
```

| p | q | dj\_q |
| --- | --- | --- |
| 3 | 0 | 3 |

`q` stays at 0: each unit of it would cost 3 more than a unit of `p` does, its reduced cost.

## See also

[`LpProblem`](./lp-problem), [`LpAffineExpression`](./lp-affine-expression)
