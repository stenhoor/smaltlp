---
description: 'readMps: reads an MPS file, free or fixed, into plain arrays.'
---

# readMps

<!-- docs:skip -->
```ts
function readMps(text: string, options?: { format?: 'free' | 'fixed' }): MpsModel;

interface MpsModel {
  name: string;
  sense: 'minimize' | 'maximize';
  objectiveName: string;
  offset: number;
  rowNames: string[]; rowLo: Float64Array; rowUp: Float64Array;
  colNames: string[]; c: Float64Array; colLo: Float64Array; colUp: Float64Array; integer: Uint8Array;
  entries: { row: Int32Array; col: Int32Array; value: Float64Array };
}
```

Reads an MPS file's text: the column-oriented format most solvers read and write.

## Parameters

- `text`: the file's text.
- `format` (default `'free'`): `'free'` splits each line on spaces, and set names may be left out; `'fixed'` reads
  each field from its columns, so names may hold spaces.

## Returns

An `MpsModel`: the objective's sense and constant (`offset`), each row's name and range (`rowLo ≤ a·x ≤ rowUp`), each
column's name, cost, bounds and whether it is integer, and the matrix as triplets. Values of 1e30 or more are infinite.

## Errors

- `LP_FORMAT`: a file that breaks the format: no ENDATA, no objective row, an unknown section or row type, a row or
  column not defined, a value that isn't a number, a column's entries split apart. The message names the line.
- `LP_UNSUPPORTED`: SC (semi-continuous) bounds; a second RHS, RANGES or BOUNDS set; sections such as QUADOBJ, SOS
  or OBJNAME.
- `LP_PARAM`: `text` that isn't a string; an unknown `format`.

## Notes

Sections read: NAME, OBJSENSE (as a section or on its header line), ROWS, COLUMNS with integer MARKER lines, RHS,
RANGES, BOUNDS and ENDATA. The first N row is the objective; later ones are dropped. Where the format's descriptions
differ, the reader does what HiGHS 1.16.0's does, which the compare tests check:

- An RHS on the objective row sets the objective's constant to its negative.
- A negative UP bound leaves the lower bound as it is (0 by default).
- An integer column (between MARKER INTORG and INTEND) with no bound at all is 0 to 1; once any bound is given, the
  other defaults as for any column.

## Examples

```ts
import { readMps } from '@smaltworks/smaltlp';

const m = readMps(`NAME small
OBJSENSE MAX
ROWS
 N profit
 L hours
COLUMNS
 tables profit 3 hours 1
 chairs profit 5 hours 2
RHS
 rhs hours 12
RANGES
 rng hours 4
BOUNDS
 UP bnd tables 4
ENDATA`);
({ sense: m.sense, rows: m.rowNames, rowLo: m.rowLo, rowUp: m.rowUp, cols: m.colNames, c: m.c, colUp: m.colUp })
```

| sense | rows | rowLo | rowUp | cols | c | colUp |
| --- | --- | --- | --- | --- | --- | --- |
| maximize | [hours] | [8] | [12] | [tables, chairs] | [3, 5] | [4, Infinity] |

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

[`mpsToProblem`](./mps-to-problem), [Reading MPS files](../../guide/mps)
