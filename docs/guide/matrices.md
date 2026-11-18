---
description: 'Solve a linear program from matrices with linprog, scipy''s interface: costs, inequality and equality rows, bounds.'
---

# Solving from matrices

[`linprog`](../reference/linprog) takes a problem as scipy.optimize.linprog does: minimize `c·x` subject to

- `AUb · x ≤ bUb`, the inequality rows;
- `AEq · x = bEq`, the equality rows;
- each variable's `[lower, upper]` bounds, `[0, null]` (x ≥ 0) unless you give others.

scipy's names are in camelCase: `A_ub` is `AUb`, `b_eq` is `bEq`.

## A first problem

Minimize `x + 2y` with `x + y ≥ 3` and `x - y ≤ 1`. A `≥` row goes in negated, as `-x - y ≤ -3`:

```ts
import { linprog } from '@smaltworks/smaltlp';

const res = await linprog([1, 2], { AUb: [[-1, -1], [1, -1]], bUb: [-3, 1] });
({ status: res.status, x: res.x, fun: res.fun })
```

| status | x | fun |
| --- | --- | --- |
| 0 | [2, 1] | 4 |

## Equalities and bounds

Equality rows go in `AEq` and `bEq`. Bounds are a `[lower, upper]` pair for every variable, or one per variable, with
`null` for no bound:

```ts
const mix = await linprog([1, 2, 3], {
  AEq: [[1, 1, 1], [1, -1, 0]],
  bEq: [1, 0],
  bounds: [[0, null], [0, null], [0, 0.5]],
});
({ x: mix.x, fun: mix.fun })
```

| x | fun |
| --- | --- |
| [0.5, 0.5, 0] | 1.5 |

A free variable has `[null, null]`. Here `x` may go below 0:

```ts
const free = await linprog([-1, 4], { AUb: [[-3, 1], [1, 2]], bUb: [6, 4], bounds: [[null, null], [-3, null]] });
({ x: free.x, fun: free.fun })
```

| x | fun |
| --- | --- |
| [10, -3] | -22 |

## When there is no answer

`status` says how the solve ended, with scipy's codes: 0 optimal, 1 the iteration limit, 2 infeasible, 3 unbounded,
4 numerical difficulties. Without an optimum, `x` and `fun` are `null`:

```ts
const none = await linprog([1], { AUb: [[1]], bUb: [-1] });
({ status: none.status, message: none.message, x: none.x })
```

| status | message | x |
| --- | --- | --- |
| 2 | The problem is infeasible. | null |

```ts
const runaway = await linprog([-1]);
({ status: runaway.status, message: runaway.message })
```

| status | message |
| --- | --- |
| 3 | The problem is unbounded. |

## Sparse rows

Large models are mostly zeros. Give `AUb` or `AEq` as triplets instead of rows: entry k is `v[k]` at row `i[k]`,
column `j[k]`.

```ts
const sparse = await linprog([-3, -5], {
  AUb: { rows: 3, cols: 2, i: [0, 1, 2, 2], j: [0, 1, 0, 1], v: [1, 2, 3, 2] },
  bUb: [4, 12, 18],
});
sparse.x
```

| value |
| --- |
| 2 |
| 6 |

## See also

[`linprog`](../reference/linprog), [Reading duals](./duals), [Building a model](./models)
