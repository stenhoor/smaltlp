---
description: 'Read MPS files, free or fixed, and solve them: models written by other solvers.'
---

# Reading MPS files

MPS is the text format most solvers read and write. [`readMps`](../reference/io/read-mps) reads its free form (fields
separated by spaces) and its fixed form (fields in set columns); [`mpsToProblem`](../reference/io/mps-to-problem)
turns what it read into an [`LpProblem`](../reference/model/lp-problem) to solve.

## Read and solve

```ts
import { readMps, mpsToProblem, value } from '@smaltworks/smaltlp';

const text = `NAME          TESTPROB
ROWS
 N  COST
 L  LIM1
 G  LIM2
 E  MYEQN
COLUMNS
    XONE      COST         1   LIM1         1
    XONE      LIM2         1
    YTWO      COST         2   LIM1         1
    YTWO      MYEQN       -1
    ZTHREE    COST         3   LIM2         1
    ZTHREE    MYEQN        1
RHS
    RHS1      LIM1         4   LIM2         1
    RHS1      MYEQN        7
BOUNDS
 UP BND1      XONE         4
 LO BND1      YTWO        -1
 UP BND1      YTWO         1
ENDATA`;
const prob = mpsToProblem(readMps(text));
const stats = await prob.solve();
({ status: stats.statusStr, cost: value(prob.objective) })
```

| status | cost |
| --- | --- |
| Optimal | 16 |

```ts
prob.variables().map((v) => ({ name: v.name, value: v.varValue }))
```

| name | value |
| --- | --- |
| XONE | 0 |
| YTWO | -1 |
| ZTHREE | 6 |

## What the file holds

`readMps` gives the model as plain arrays: the rows' and columns' names, their bounds, the costs, and the matrix as
triplets. Read them before solving, or pass them to your own code:

```ts
const model = readMps(text);
({ rows: model.rowNames, rowLo: model.rowLo, rowUp: model.rowUp })
```

| rows | rowLo | rowUp |
| --- | --- | --- |
| LIM1 | -Infinity | 4 |
| LIM2 | 1 | Infinity |
| MYEQN | 7 | 7 |

## Where readers differ

The format's descriptions disagree on a few points, and smaltlp reads them as HiGHS does (checked by the compare
tests): an RHS on the objective row sets its constant to the negative; a negative UP bound leaves the lower bound at 0;
an integer column with no bounds at all is 0 to 1. See [`readMps`](../reference/io/read-mps#notes).

## See also

[`readMps`](../reference/io/read-mps), [`mpsToProblem`](../reference/io/mps-to-problem)
