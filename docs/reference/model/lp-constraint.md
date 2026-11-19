---
description: 'LpConstraint: an expression with ≤, = or ≥, and after a solve its dual (pi) and slack.'
---

# LpConstraint

<!-- docs:skip -->
```ts
class LpConstraint {
  constructor(expression: LpAffineExpression, sense: -1 | 0 | 1);
  readonly expression: LpAffineExpression;
  readonly sense: -1 | 0 | 1;
  name: string | null;
  pi: number | null;
  slack: number | null;
  readonly constant: number;
  readonly rhs: number;
}
```

A constraint: an expression and a sense, `expression ≤ 0`, `= 0` or `≥ 0`, with the right-hand side folded into the
expression's constant. PuLP's `LpConstraint`. Build one with `le`, `ge` or `eq` on a variable or expression.

## Parameters

- `expression`: everything on the left.
- `sense`: `LpConstraintLE` (-1), `LpConstraintEQ` (0) or `LpConstraintGE` (1).

## Returns

- `name`: the name given when it was added to a problem, or `_C1`, `_C2` …
- `constant`: the expression's constant, −rhs; `rhs`: the right-hand side.
- `pi`, after an optimal solve: the objective's change per unit more of the right-hand side, in the problem's own
  sense. `null` in an integer program, which has no duals.
- `slack`, after an optimal solve: `rhs − lhs` for `≤`, `lhs − rhs` for `≥`, 0 for `=`.

## Notes

`pi` and `slack` match PuLP 4.2's (with HiGHS) in the compare tests, maximizations included.

## Examples

```ts
import { LpProblem, LpMaximize, LpConstraintLE } from '@smaltworks/smaltlp';

const prob = new LpProblem('plan', LpMaximize);
const x = prob.addVariable('x', 0);
const y = prob.addVariable('y', 0);
prob.add(x.times(3).plus(y.times(5)));
const cap = prob.addConstraint(x.times(3).plus(y.times(2)).le(18), 'cap');
prob.add(x.le(4), 'xmax').add(y.times(2).le(12), 'ymax');
({ text: cap.toString(), isLE: cap.sense === LpConstraintLE, rhs: cap.rhs, constant: cap.constant })
```

| text | isLE | rhs | constant |
| --- | --- | --- | --- |
| 3\*x + 2\*y <= 18 | true | 18 | -18 |

## Working demo

```ts
await prob.solve();
prob.constraints().map((c) => ({ name: c.name, pi: c.pi, slack: c.slack }))
```

| name | pi | slack |
| --- | --- | --- |
| cap | 1 | 0 |
| xmax | 0 | 2 |
| ymax | 1.5 | 0 |

## See also

[`LpProblem`](./lp-problem), [Reading duals](../../guide/duals)
