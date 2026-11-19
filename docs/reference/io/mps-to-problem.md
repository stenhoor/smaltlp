---
description: 'mpsToProblem: an LpProblem from what readMps or readLp read, a variable per column and a constraint per row.'
---

# mpsToProblem

<!-- docs:skip -->
```ts
function mpsToProblem(model: MpsModel): LpProblem;
```

An [`LpProblem`](../model/lp-problem) from a model [`readMps`](./read-mps) or [`readLp`](./read-lp) read: a variable per column and a
constraint per row, each by its name.

## Parameters

- `model`: what `readMps` returned.

## Returns

An `LpProblem` with the file's sense, its objective (with its constant), a variable per column with its bounds and
category, and a constraint per row. A ranged row (both bounds finite and different) becomes two constraints: `name`
for its lower side (≥) and `name_range` for its upper side (≤). An E row stays one `=` constraint.

## Errors

- `LP_PARAM`: from `addVariable`, as for any model.

## Notes

Integer columns become `'Integer'` variables, and the problem solves as an integer program. Spaces in names (possible in fixed
MPS) become underscores, as `addVariable` makes them.

## Examples

```ts
import { readMps, mpsToProblem } from '@smaltworks/smaltlp';

const prob = mpsToProblem(readMps(`NAME ranged
ROWS
 N cost
 G need
COLUMNS
 x cost 2 need 1
 y cost 3 need 1
RHS
 rhs need 5
RANGES
 rng need 3
ENDATA`));
prob.constraints().map((c) => ({ name: c.name, constraint: c.toString() }))
```

| name | constraint |
| --- | --- |
| need | x + y >= 5 |
| need\_range | x + y <= 8 |

## Working demo

```ts
await prob.solve();
prob.variables().map((v) => ({ name: v.name, value: v.varValue }))
```

| name | value |
| --- | --- |
| x | 5 |
| y | 0 |

## See also

[`readMps`](./read-mps), [`LpProblem`](../model/lp-problem)
