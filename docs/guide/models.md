---
description: 'Build a linear program by name, in PuLP 4.2''s style: a problem, its variables, an objective and named constraints.'
---

# Building a model

The modelling layer builds a problem by name, as PuLP 4.2 does: an [`LpProblem`](../reference/model/lp-problem),
variables from `prob.addVariable()`, an objective, and named constraints. TypeScript has no operator overloading, so
`3*x + 5*y` is `x.times(3).plus(y.times(5))`, `<=` is `.le()`, and PuLP's `prob += …` is `prob.add(…)`.

## A production plan

A workshop makes tables (profit 3) and chairs (profit 5), from three plants with 4, 12 and 18 hours:

```ts
import { LpProblem, LpMaximize, LpSolveStatus, value } from '@smaltworks/smaltlp';

const prob = new LpProblem('plan', LpMaximize);
const tables = prob.addVariable('tables', 0);
const chairs = prob.addVariable('chairs', 0);
prob.add(tables.times(3).plus(chairs.times(5)));
prob.add(tables.le(4), 'plant1');
prob.add(chairs.times(2).le(12), 'plant2');
prob.add(tables.times(3).plus(chairs.times(2)).le(18), 'plant3');
const stats = await prob.solve();
({ status: stats.statusStr, tables: tables.varValue, chairs: chairs.varValue, profit: value(prob.objective) })
```

| status | tables | chairs | profit |
| --- | --- | --- | --- |
| Optimal | 2 | 6 | 36 |

`addVariable(name, lowBound, upBound, cat)` takes bounds as numbers, or `null` for none: `addVariable('x', 0)` is
x ≥ 0, `addVariable('x')` is free.

## Sums

[`lpSum`](../reference/model/lp-sum) adds up variables and expressions; [`lpDot`](../reference/model/lp-sum) weights
them:

```ts
import { lpSum, lpDot } from '@smaltworks/smaltlp';

const items = new LpProblem('pick', LpMaximize);
const take = ['a', 'b', 'c', 'd'].map((n) => items.addVariable(n, 0, 1));
items.add(lpDot([5, 4, 3, 2], take));
items.add(lpDot([4, 3, 2, 1], take).le(6), 'weight');
items.add(lpSum(take).le(3), 'count');
await items.solve();
take.map((v) => ({ item: v.name, take: v.varValue }))
```

| item | take |
| --- | --- |
| a | 0 |
| b | 1 |
| c | 1 |
| d | 1 |

Each variable here is between 0 and 1, and a linear program may take part of an item; here the best picks happen to
be whole ([`lpDot`](../reference/model/lp-sum#working-demo) shows one that isn't). Whole items only, always, is an
integer program: see [Integer programs](./integers).

## Constraints by name

Every constraint has a name: the one you give, or `_C1`, `_C2` … in order, as PuLP names them.
`prob.constraints()` lists them, and `getConstraintByName()` finds one:

```ts
prob.constraints().map((c) => ({ name: c.name, constraint: c.toString(), slack: c.slack }))
```

| name | constraint | slack |
| --- | --- | --- |
| plant1 | tables <= 4 | 2 |
| plant2 | 2\*chairs <= 12 | 0 |
| plant3 | 3\*tables + 2\*chairs <= 18 | 0 |

## Statuses

`solve()` resolves to the solve's stats: `status` and `statusStr` in PuLP 4.2's codes
([`LpSolveStatus`](../reference/model/lp-solve-status)), `hasSolution`, `objective`, and the problem's size. Without
an optimum, values stay `null`:

```ts
const impossible = new LpProblem('impossible');
const z = impossible.addVariable('z', 0);
impossible.add(z.le(-1));
const s = await impossible.solve();
({ status: s.status, statusStr: s.statusStr, hasSolution: s.hasSolution, z: z.varValue })
```

| status | statusStr | hasSolution | z |
| --- | --- | --- | --- |
| -1 | Infeasible | false | null |

## See also

[`LpProblem`](../reference/model/lp-problem), [Reading duals](./duals), [Solving from matrices](./matrices)
