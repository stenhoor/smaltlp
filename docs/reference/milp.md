---
description: 'milp: minimize c·x with some variables whole numbers, subject to ranged rows and bounds. scipy.optimize.milp.'
---

# milp

<!-- docs:skip -->
```ts
function milp(c: ArrayLike<number>, options?: MilpOptions): Promise<MilpResult>;
function milpSync(c: ArrayLike<number>, options?: MilpOptions): MilpResult;

interface MilpOptions {
  integrality?: number | ArrayLike<number>;
  bounds?: { lb?: number | null | ArrayLike<number | null>; ub?: number | null | ArrayLike<number | null> };
  constraints?: LinearConstraint | LinearConstraint[];
  nodeLimit?: number;
  timeLimit?: number;
  mipRelGap?: number;
  presolve?: boolean;
}
interface LinearConstraint {
  A: MatrixInput;
  lb?: number | null | ArrayLike<number | null>;
  ub?: number | null | ArrayLike<number | null>;
}
```

Minimizes `c·x` subject to `lb ≤ A·x ≤ ub` for each constraint, the bounds on each variable, and whole-number values
for the variables marked integer. scipy's
[`milp`](https://docs.scipy.org/doc/scipy/reference/generated/scipy.optimize.milp.html), with its options in camelCase.

## Parameters

- `c`: the cost of each variable. Its length is the number of variables.
- `integrality` (default `0`): each variable's kind, or one for every variable: `0` continuous, `1` integer.
- `bounds` (default `{ lb: 0, ub: Infinity }`): scipy's `Bounds`. `lb` and `ub` are one number for every variable, or
  one per variable; a side left out, or `null`, has no bound (`-Infinity` or `Infinity`), as in scipy.
- `constraints`: scipy's `LinearConstraint`, `{ A, lb, ub }`, or a list of them. `A` is rows of numbers, or sparse
  triplets `{ rows, cols, i, j, v }`; `lb` and `ub` are one number for every row, or one per row, with no bound on a
  side left out. An equality row has `lb` equal to `ub`.
- `nodeLimit` (default: none): the most branch-and-bound nodes to solve.
- `timeLimit` (default: none): the most seconds to spend.
- `mipRelGap` (default `1e-4`, HiGHS's): stop once `(fun − mipDualBound) / |fun|` is at most this. `0` searches until
  the optimum is proven.
- `presolve` (default `true`): simplify the root's linear program before solving it. The nodes below it start from
  their parent's basis.

## Returns

A `MilpResult`, scipy's fields in camelCase:

- `status`: 0 optimal (within the gap), 1 a node or time limit was reached, 2 infeasible, 4 other: the relaxation is
  unbounded (so the problem is unbounded or infeasible, as scipy reports it), or numerical difficulties. `success` is
  `status === 0`, and `message` says it in words.
- `x`: the best solution found, and `fun`: its cost `c·x`. With status 0, or with status 1 when a limit stopped the
  search after it found one; `null` otherwise. Integer variables' values are whole numbers.
- `mipNodeCount`: the nodes solved.
- `mipDualBound`: the lowest bound on the optimum found, or `null` before there is one.
- `mipGap`: `(fun − mipDualBound) / |fun|`, or `null` without `x`.

## Errors

- `LP_SHAPE`: `c` empty; `integrality`, `lb` or `ub` of the wrong length; a constraint's `A` whose columns differ from
  `c`'s length.
- `LP_VALUE`: a NaN or infinite cost or matrix entry; a NaN bound; a lower bound of Infinity or an upper bound of
  -Infinity.
- `LP_PARAM`: `integrality` other than 0 to 3; a constraint without `A`; `nodeLimit` not a whole number; `timeLimit`
  or `mipRelGap` negative; `presolve` not `true` or `false`.
- `LP_UNSUPPORTED`: `integrality` 2 (semi-continuous) or 3 (semi-integer).

## Notes

Solved by branch-and-bound over the [`linprog`](./linprog) dual simplex. The search goes depth first until it finds a
first integer solution, then takes the open node with the lowest bound. It chooses the variable to branch on by
reliability branching (Achterberg, Koch and Martin, 2005): each variable's record of how much the bound rose when it was
rounded down and up, and, until a variable has four of each, its two branches solved there and then. On the harder
problems in the [benchmarks](../research/benchmarks#branch-and-bound-harder-problems) this takes 0.47 to 0.91 of the
time of branching on the most fractional variable; on problems that solve in a few hundred nodes it can take longer. A value
within 1e-6 of a whole number counts as whole, as in HiGHS. Each node below
the root starts the dual simplex from its parent's optimal basis and a copy of its factorization (a warm start), which takes 24% to 74% of
the iterations of solving each from the start ([benchmarks](../research/benchmarks#branch-and-bound-warm-starts)). There are
no cutting planes or heuristics yet, so smaltlp solves fewer problems than HiGHS in the same time.

The compare tests solve 90 problems to a gap of 0 with scipy 1.18.1 (HiGHS) and smaltlp: the status and `fun` agree
within 1e-7, and `x` is whole, within its bounds and feasible. Where several solutions are optimal, `x` may be another
of them. The asynchronous call gives exactly the synchronous result.

## Examples

```ts
import { milp } from '@smaltworks/smaltlp';

// scipy's documentation example: maximize y with -x + y ≤ 1, 3x + 2y ≤ 12, 2x + 3y ≤ 12, both whole.
const constraints = { A: [[-1, 1], [3, 2], [2, 3]], ub: [1, 12, 12] };
const res = await milp([0, -1], { integrality: [1, 1], constraints });
({ fun: res.fun, status: res.status, gap: res.mipGap })
```

| fun | status | gap |
| --- | --- | --- |
| -2 | 0 | 0 |

Without `integrality`, the same problem is a linear program, and its optimum is not whole:

```ts
const relaxed = await milp([0, -1], { constraints });
({ x: relaxed.x, fun: relaxed.fun })
```

| x | fun |
| --- | --- |
| [1.8, 2.8] | -2.8 |

## Working demo

```ts
import { milpSync } from '@smaltworks/smaltlp';

// A knapsack: six items, each taken or not, worth the most within a weight of 47.
const worth = [10, 13, 18, 31, 7, 15];
const weight = [11, 15, 20, 35, 10, 33];
const pick = milpSync(worth.map((w) => -w), {
  integrality: 1,
  bounds: { lb: 0, ub: 1 },
  constraints: { A: [weight], ub: 47 },
});
({ status: pick.status, worth: -pick.fun!, take: pick.x })
```

| status | worth | take |
| --- | --- | --- |
| 0 | 41 | [1, 1, 1, 0, 0, 0] |

## See also

[Integer programs](../guide/integers), [`linprog`](./linprog) (whose `integrality` solves the same way),
[`LpProblem`](./model/lp-problem)
