---
description: 'writeMps: a model as MPS text, free or fixed, which smaltlp and HiGHS read back to the same model.'
---

# writeMps

<!-- docs:skip -->
```ts
function writeMps(model: MpsModel, options?: { format?: 'free' | 'fixed' }): string;
```

Writes a model as MPS text, free or fixed. The model is what [`readMps`](./read-mps) or [`readLp`](./read-lp) read, or
what [`problemToModel`](./problem-to-model) makes from an [`LpProblem`](../model/lp-problem).

## Parameters

- `model`: the model to write.
- `format` (default `'free'`): `'free'` separates fields by spaces; `'fixed'` puts each field in its columns.

## Returns

The file's text: NAME, OBJSENSE (when maximizing), ROWS, COLUMNS (integer columns between MARKER lines), RHS,
RANGES, BOUNDS and ENDATA.

## Errors

- `LP_VALUE`: a name the format can't hold: empty or holding a space (free); longer than 8 characters (fixed). A
  number longer than 12 characters in fixed format, which would be cut: write free MPS instead.
- `LP_PARAM`: an unknown `format`.

## Notes

- A row with only an upper side is L, only a lower side G, two equal sides E, and two different finite sides L with a
  RANGES entry. A row with no finite side is a free N row, which readers (smaltlp's and HiGHS's) drop.
- The objective's constant is written as the objective row's RHS, negated, as readers take it.
- An integer column from 0 to 1 is BV. One from 0 with no upper bound gets an explicit LO 0, since an integer column
  with no bounds at all reads as 0 to 1.
- Numbers are written in the shortest form that reads back to the same 64-bit value.

The compare tests write every MPS and LP case, free and fixed, and check that HiGHS 1.16.0 reads the text as smaltlp
does, and solves it to the original's optimum.

## Examples

```ts
import { readLp, writeMps } from '@smaltworks/smaltlp';

const fromLp = readLp(`Maximize
 obj: 3 x + 2 y
Subject To
 c1: x + y <= 4
Bounds
 x <= 3
Generals
 y
End`);
writeMps(fromLp).trimEnd().split('\n').map((line) => ({ line }))
```

| line |
| --- |
| NAME |
| OBJSENSE |
|     MAX |
| ROWS |
|  N obj |
|  L c1 |
| … 13 more rows |

## See also

[`readMps`](./read-mps), [`writeLp`](./write-lp), [`problemToModel`](./problem-to-model)
