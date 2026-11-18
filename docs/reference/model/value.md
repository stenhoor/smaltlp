---
description: 'value: an expression''s or variable''s value after a solve. PuLP''s value().'
---

# value

<!-- docs:skip -->
```ts
function value(term: LpVariable | LpAffineExpression | number | null): number | null;
```

The value of an expression or variable from the last solve. PuLP's `value()`.

## Parameters

- `term`: a variable, an expression, a number, or `null` (a problem's `objective` when none was set).

## Returns

The value; a number as it is; `null` for `null`, or when a variable in it has no value yet.

## Examples

```ts
import { LpProblem, LpMaximize, value } from '@smaltworks/smaltlp';

const prob = new LpProblem('v', LpMaximize);
const x = prob.addVariable('x', 0, 4);
prob.add(x.times(2).plus(1));
const before = value(prob.objective);
await prob.solve();
({ before, after: value(prob.objective), x: value(x), number: value(7) })
```

| before | after | x | number |
| --- | --- | --- | --- |
| null | 9 | 4 | 7 |

## See also

[`LpProblem`](./lp-problem), [`LpAffineExpression`](./lp-affine-expression)
