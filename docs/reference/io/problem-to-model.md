---
description: 'problemToModel: an LpProblem as a model to write with writeLp or writeMps.'
---

# problemToModel

<!-- docs:skip -->
```ts
function problemToModel(prob: LpProblem): MpsModel;
```

The model an [`LpProblem`](../model/lp-problem) describes, in the plain arrays [`writeLp`](./write-lp) and
[`writeMps`](./write-mps) take: the step back from [`mpsToProblem`](./mps-to-problem).

## Parameters

- `prob`: the problem.

## Returns

An `MpsModel`: a column per variable and a row per constraint, in the problem's order and by their names; the
problem's sense; the objective's constant as `offset`. A `'Binary'` variable is integer from 0 to 1, and an
`'Integer'` one integer.

## Notes

Nothing is solved. Names are taken as they are: one the format can't hold fails when it is written.

## Examples

```ts
import { LpProblem, LpMaximize, problemToModel, writeLp } from '@smaltworks/smaltlp';

const prob = new LpProblem('plan', LpMaximize);
const tables = prob.addVariable('tables', 0, 4);
const chairs = prob.addVariable('chairs', 0, null, 'Integer');
prob.add(tables.times(3).plus(chairs.times(5)));
prob.add(tables.plus(chairs.times(2)).le(12), 'hours');
writeLp(problemToModel(prob)).trimEnd().split('\n').map((line) => ({ line }))
```

| line |
| --- |
| \ Written by smaltlp |
| Maximize |
|  obj: +3 tables +5 chairs |
| Subject To |
|  hours: +1 tables +2 chairs <= 12 |
| Bounds |
|  tables <= 4 |
| Generals |
|  chairs |
| End |

## See also

[`mpsToProblem`](./mps-to-problem), [`writeLp`](./write-lp), [`writeMps`](./write-mps)
