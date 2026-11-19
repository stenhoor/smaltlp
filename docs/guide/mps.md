---
description: 'Read and write MPS and CPLEX LP files: solve models from other solvers, and hand yours to them.'
---

# MPS and LP files

MPS and CPLEX LP are the two text formats most solvers read and write. [`readMps`](../reference/io/read-mps) reads
MPS's free form (fields separated by spaces) and its fixed form (fields in set columns), and
[`readLp`](../reference/io/read-lp) reads LP, the algebraic one; [`mpsToProblem`](../reference/io/mps-to-problem)
turns what either read into an [`LpProblem`](../reference/model/lp-problem) to solve.
[`writeMps`](../reference/io/write-mps) and [`writeLp`](../reference/io/write-lp) write a model back out.

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

## LP files

The same model, as an LP file: the objective and constraints written as algebra.

```ts
import { readLp } from '@smaltworks/smaltlp';

const lp = readLp(`Minimize
 COST: XONE + 2 YTWO + 3 ZTHREE
Subject To
 LIM1: XONE + YTWO <= 4
 LIM2: XONE + ZTHREE >= 1
 MYEQN: - YTWO + ZTHREE = 7
Bounds
 XONE <= 4
 -1 <= YTWO <= 1
End`);
const fromLp = mpsToProblem(lp);
await fromLp.solve();
value(fromLp.objective)
```

| value |
| --- |
| 16 |

## Writing a model out

[`problemToModel`](../reference/io/problem-to-model) turns an `LpProblem` into the plain arrays the writers take, and
[`writeLp`](../reference/io/write-lp) and [`writeMps`](../reference/io/write-mps) give the file's text, for another
solver or to keep. The compare tests check that HiGHS reads what they write as smaltlp does.

```ts
import { problemToModel, writeMps } from '@smaltworks/smaltlp';

writeMps(problemToModel(prob)).split('\n').slice(0, 7).map((line) => ({ line }))
```

| line |
| --- |
| NAME TESTPROB |
| ROWS |
|  N obj |
|  L LIM1 |
|  G LIM2 |
|  E MYEQN |
| COLUMNS |

LP has no ranged constraint, so `writeLp` writes a row with two different sides as two, `<name>lo` and `<name>up`, as
HiGHS does. A name either format can't hold (a space, or more than 8 characters in fixed MPS) fails rather than being
changed.

## See also

[`readMps`](../reference/io/read-mps), [`readLp`](../reference/io/read-lp), [`writeMps`](../reference/io/write-mps),
[`writeLp`](../reference/io/write-lp), [`mpsToProblem`](../reference/io/mps-to-problem),
[`problemToModel`](../reference/io/problem-to-model)
