---
description: 'LpAffineExpression: a linear expression, a sum of coefficients times variables plus a constant.'
---

# LpAffineExpression

<!-- docs:skip -->
```ts
class LpAffineExpression {
  constructor(terms?: ReadonlyMap<LpVariable, number>, constant?: number);
  readonly terms: ReadonlyMap<LpVariable, number>;
  readonly constant: number;
  plus(...terms: (LpVariable | LpAffineExpression | number)[]): LpAffineExpression;
  minus(term: LpVariable | LpAffineExpression | number): LpAffineExpression;
  times(k: number): LpAffineExpression;
  le(rhs: LpVariable | LpAffineExpression | number): LpConstraint;
  ge(rhs: LpVariable | LpAffineExpression | number): LpConstraint;
  eq(rhs: LpVariable | LpAffineExpression | number): LpConstraint;
}
```

A linear expression: a coefficient for each variable, plus a constant. PuLP's `LpAffineExpression`. It is immutable:
each method returns a new expression. TypeScript has no operator overloading, so `3*x + y - 2` is
`x.times(3).plus(y).minus(2)`.

## Parameters

- `terms`: the coefficient of each variable; a variable not in the map has 0.
- `constant` (default 0).

## Returns

`plus`, `minus` and `times` give a new expression; `le`, `ge` and `eq` give an [`LpConstraint`](./lp-constraint),
`this ≤ rhs`, `≥` or `=`, with everything moved to the left.

## Errors

- `LP_VALUE`: a NaN or infinite factor or constant.

## Examples

```ts
import { LpProblem } from '@smaltworks/smaltlp';

const prob = new LpProblem('expr');
const x = prob.addVariable('x', 0);
const y = prob.addVariable('y', 0);
const e = x.times(3).plus(y).minus(2);
({ expression: e.toString(), x: e.terms.get(x), y: e.terms.get(y), constant: e.constant })
```

| expression | x | y | constant |
| --- | --- | --- | --- |
| 3\*x + y - 2 | 3 | 1 | -2 |

## Working demo

```ts
const c = e.le(x.plus(10));
({ constraint: c.toString(), rhs: c.rhs })
```

| constraint | rhs |
| --- | --- |
| 2\*x + y <= 12 | 12 |

## See also

[`lpSum`, `lpDot`](./lp-sum), [`LpConstraint`](./lp-constraint)
