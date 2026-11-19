---
description: 'readLp: reads a CPLEX LP file, the algebraic text format, into plain arrays.'
---

# readLp

<!-- docs:skip -->
```ts
function readLp(text: string): MpsModel;
```

Reads a CPLEX LP file's text, the row-oriented format: an objective and constraints written as algebra, then bounds
and integer sections. It gives the same model shape as [`readMps`](./read-mps), so
[`mpsToProblem`](./mps-to-problem) turns either into an [`LpProblem`](../model/lp-problem).

## Parameters

- `text`: the file's text.

## Returns

An `MpsModel` (see [`readMps`](./read-mps#returns)): the sense, the objective's name and constant, each constraint's
name and range, each variable's name, cost, bounds and whether it is integer, and the matrix as triplets. `name` is
`''`: an LP file has none.

## Errors

- `LP_FORMAT`: a file that breaks the format, naming the line: no Minimize or Maximize section first, a constraint
  without a sense or a number on its right, a variable on a constraint's right, a range (`-2 <= x - y <= 3`), a
  constant on a constraint's left side, a bound that isn't one, an infinite constant.
- `LP_UNSUPPORTED`: quadratic terms (`[ … ]`), indicator constraints (`->`), and the Semi-Continuous and SOS sections.
- `LP_PARAM`: `text` that isn't a string.

## Notes

Sections, by their keywords in any case: the objective (Minimize, Minimise, Minimum, Min, or the Maximize forms), the
constraints (Subject To, Such That, st, s.t.), Bounds, Generals (General, Gen, Integers), Binaries (Binary, Bin) and
End. A backslash starts a comment. Variables are numbered in the order they first appear; a constraint without a name
is `R1`, `R2` … by its place. Where readers differ, it does what HiGHS 1.16.0's does, which the compare tests check:

- A variable named twice in one constraint or the objective has its coefficients summed.
- An upper bound below 0 leaves the lower bound as it is (0 by default).
- A Binaries entry is integer from 0 to 1, whatever bounds it had.
- A range in Subject To, or a variable on the right, fails, as HiGHS refuses them.

One difference: HiGHS ignores a constant on a constraint's left side (`2 x + 4 <= 10` reads as `2 x <= 10`), with a
warning. smaltlp fails instead, since ignoring it would change the model: move the constant to the right.

## Examples

```ts
import { readLp } from '@smaltworks/smaltlp';

const m = readLp(`\\ A small plan
Maximize
 profit: 3 tables + 5 chairs
Subject To
 hours: tables + 2 chairs <= 12
 wood: 2 tables + chairs <= 12
Bounds
 tables <= 4
Generals
 chairs
End`);
({ sense: m.sense, rows: m.rowNames, rowUp: m.rowUp, cols: m.colNames, c: m.c, colUp: m.colUp, integer: m.integer })
```

| sense | rows | rowUp | cols | c | colUp | integer |
| --- | --- | --- | --- | --- | --- | --- |
| maximize | [hours, wood] | [12, 12] | [tables, chairs] | [3, 5] | [4, Infinity] | [0, 1] |

## Working demo

```ts
import { mpsToProblem, value } from '@smaltworks/smaltlp';

const prob = mpsToProblem(m);
await prob.solve();
({ profit: value(prob.objective), tables: prob.variables()[0]!.varValue, chairs: prob.variables()[1]!.varValue })
```

| profit | tables | chairs |
| --- | --- | --- |
| 32 | 4 | 4 |

## See also

[`writeLp`](./write-lp), [`readMps`](./read-mps), [Model files](../../guide/mps)
