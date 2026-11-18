---
description: 'lpSum and lpDot: sums of variables and expressions, plain or weighted. PuLP''s lpSum and lpDot.'
---

# lpSum, lpDot

<!-- docs:skip -->
```ts
function lpSum(terms: Iterable<LpVariable | LpAffineExpression | number>): LpAffineExpression;
function lpDot(a: readonly number[], b: readonly (LpVariable | LpAffineExpression | number)[]): LpAffineExpression;
```

`lpSum` adds up variables, expressions and numbers; `lpDot` adds up `a[i] × b[i]`. PuLP's `lpSum` and `lpDot`, with
`lpDot`'s numbers on one side.

## Parameters

- `terms`: what `lpSum` adds.
- `a`, `b`: the weights and what they weigh, the same length.

## Returns

An [`LpAffineExpression`](./lp-affine-expression).

## Errors

- `LP_SHAPE`: `lpDot` with `a` and `b` of different lengths.
- `LP_VALUE`: a NaN or infinite number.

## Examples

```ts
import { LpProblem, lpSum, lpDot } from '@smaltworks/smaltlp';

const prob = new LpProblem('sums');
const v = ['a', 'b', 'c'].map((n) => prob.addVariable(n, 0));
({ sum: lpSum(v).toString(), dot: lpDot([1, 2, 3], v).toString(), mixed: lpSum([v[0]!, 5, v[1]!.times(2)]).toString() })
```

| sum | dot | mixed |
| --- | --- | --- |
| a + b + c | a + 2\*b + 3\*c | a + 2\*b + 5 |

## Working demo

```ts
import { LpMaximize } from '@smaltworks/smaltlp';

const bag = new LpProblem('bag', LpMaximize);
const take = ['gold', 'silver', 'bronze'].map((n) => bag.addVariable(n, 0, 1));
bag.add(lpDot([10, 6, 3], take));
bag.add(lpDot([5, 4, 3], take).le(8), 'weight');
await bag.solve();
take.map((t) => ({ item: t.name, take: t.varValue }))
```

| item | take |
| --- | --- |
| gold | 1 |
| silver | 0.75 |
| bronze | 0 |

## See also

[`LpAffineExpression`](./lp-affine-expression), [Building a model](../../guide/models)
