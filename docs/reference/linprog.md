---
description: 'linprog: minimize c·x subject to inequality and equality rows and bounds. scipy.optimize.linprog.'
---

# linprog

<!-- docs:skip -->
```ts
function linprog(c: ArrayLike<number>, options?: LinprogOptions): Promise<LinprogResult>;
function linprogSync(c: ArrayLike<number>, options?: LinprogOptions): LinprogResult;

interface LinprogOptions {
  AUb?: MatrixInput; bUb?: ArrayLike<number>;
  AEq?: MatrixInput; bEq?: ArrayLike<number>;
  bounds?: [number | null, number | null] | [number | null, number | null][];
  maxIter?: number;
  tol?: number;
  presolve?: boolean;
  integrality?: number | ArrayLike<number>;
}
```

Minimizes `c·x` subject to `AUb·x ≤ bUb`, `AEq·x = bEq` and the bounds on each variable. scipy's
[`linprog`](https://docs.scipy.org/doc/scipy/reference/generated/scipy.optimize.linprog.html), with its parameters in
camelCase.

## Parameters

- `c`: the cost of each variable. Its length is the number of variables.
- `AUb`, `bUb`: the inequality rows and their right-hand sides, given together. A matrix is rows of numbers, or
  sparse triplets `{ rows, cols, i, j, v }`.
- `AEq`, `bEq`: the equality rows and their right-hand sides, given together.
- `bounds` (default `[0, null]`): one `[lower, upper]` pair for every variable, or one per variable; `null` (or
  ±Infinity) for no bound on that side.
- `maxIter` (default: no limit short of 2³¹): the most changes of basis.
- `tol` (default `1e-7`): how far outside its bounds a variable, and how far the wrong side of 0 a reduced cost, may be.
- `presolve` (default `true`): remove empty rows, fixed variables and singleton rows before solving, and restore the
  solution and duals afterwards, as scipy's `presolve` option does for HiGHS.
- `integrality` (default `0`): each variable's kind, or one for every variable: `0` continuous, `1` integer, as
  scipy's. With an integer variable, the problem is solved by branch-and-bound, as [`milp`](./milp) solves it with its
  defaults.

## Returns

A `LinprogResult`, scipy's fields:

- `status`: 0 optimal, 1 the iteration limit, 2 infeasible, 3 unbounded, 4 numerical difficulties. `success` is
  `status === 0`, and `message` says it in words.
- `x`: the solution, and `fun`: its cost `c·x`. `null` unless the status is 0.
- `slack` (`bUb − AUb·x`) and `con` (`bEq − AEq·x`).
- `ineqlin`, `eqlin`, `lower`, `upper`: for the inequality rows, the equality rows and the two sides of the bounds,
  each a `residual` and the `marginals`: the change in `fun` per unit of that right-hand side or bound.
- `nit`: the changes of basis made (over every node, with integer variables).
- With integer variables, as scipy: `mipNodeCount`, `mipDualBound` and `mipGap`, as [`milp`](./milp) gives them. The
  marginals are 0: an integer program has no duals. A problem whose relaxation is unbounded has status 4, "unbounded or
  infeasible".

## Errors

- `LP_SHAPE`: `c` empty; `integrality` of the wrong length; a matrix whose columns differ from `c`'s length; a right-hand side whose length differs
  from its matrix's rows; rows of different lengths.
- `LP_VALUE`: a NaN or infinite cost, matrix entry or right-hand side; a lower bound of Infinity or an upper bound of
  -Infinity.
- `LP_PARAM`: a matrix without its right-hand side or the other way round; `tol` not between 0 and 1; `maxIter` not a
  whole number; `presolve` not `true` or `false`.
- `LP_UNSUPPORTED`: `integrality` 2 (semi-continuous) or 3 (semi-integer).

## Notes

Solved by a bounded dual simplex in 64-bit floats: dual steepest edge pricing, the bound-flipping ratio test and
Harris's two passes, over a sparse LU of the basis (Markowitz pivoting with a threshold test) with product-form
updates. Results agree with scipy's (HiGHS) within
1e-7 in the compare tests: the status and `fun` of every case, and `x` and the marginals where the optimum is unique.
Where several solutions are optimal, `x` may be another of them. The asynchronous call gives exactly the synchronous
result.

## Examples

```ts
import { linprog } from '@smaltworks/smaltlp';

// scipy's documentation example: x0 free, x1 ≥ -3.
const res = await linprog([-1, 4], { AUb: [[-3, 1], [1, 2]], bUb: [6, 4], bounds: [[null, null], [-3, null]] });
({ x: res.x, fun: res.fun, status: res.status })
```

| x | fun | status |
| --- | --- | --- |
| [10, -3] | -22 | 0 |

```ts
({ ineqlin: res.ineqlin!.marginals, lower: res.lower!.marginals })
```

| ineqlin | lower |
| --- | --- |
| 0 | 0 |
| -1 | 6 |

## Working demo

```ts
import { linprogSync } from '@smaltworks/smaltlp';

// Transport: two depots (supply 20 and 30) to three shops (demand 10, 25, 15), at a cost per unit on each route.
const cost = [4, 6, 9, 5, 3, 7];
const supply = [[1, 1, 1, 0, 0, 0], [0, 0, 0, 1, 1, 1]];
const demand = [[1, 0, 0, 1, 0, 0], [0, 1, 0, 0, 1, 0], [0, 0, 1, 0, 0, 1]];
const plan = linprogSync(cost, { AUb: supply, bUb: [20, 30], AEq: demand, bEq: [10, 25, 15] });
({ status: plan.status, cost: plan.fun, routes: plan.x })
```

| status | cost | routes |
| --- | --- | --- |
| 0 | 240 | [10, 0, 10, 0, 25, 5] |

## See also

[Solving from matrices](../guide/matrices), [Reading duals](../guide/duals), [`milp`](./milp),
[`LpProblem`](./model/lp-problem)
