---
description: 'writeLp: a model as CPLEX LP text, which smaltlp and HiGHS read back to the same model.'
---

# writeLp

<!-- docs:skip -->
```ts
function writeLp(model: MpsModel, options?: { comment?: string }): string;
```

Writes a model as CPLEX LP text. The model is what [`readMps`](./read-mps) or [`readLp`](./read-lp) read, or what
[`problemToModel`](./problem-to-model) makes from an [`LpProblem`](../model/lp-problem).

## Parameters

- `model`: the model to write.
- `comment` (default `'Written by smaltlp'`): the text of the comment on the first line.

## Returns

The file's text: the objective, Subject To, Bounds (only those that aren't 0 to ∞), Generals, Binaries and End.

## Errors

- `LP_VALUE`: a name LP can't hold. A name starts with a letter or one of `!"#$%&()/,;?@_`'{}|~`, then those, digits
  and periods, with no spaces; one that reads as a number (`e12`) or a keyword (`free`, `st`) can't be written either.
- `LP_UNSUPPORTED`: a constraint with no entries, in a model with no variables.

## Notes

The format has no ranged constraint: a row with two different finite sides is written as two, `<name>lo` (≥) and
`<name>up` (≤), as HiGHS writes it, and a row with no finite side is left out. Readers number variables in the order
they first appear, so a variable with no cost comes after those with one when the file is read back; by name, the
model is the same. Numbers are written in the shortest form that reads back to the same 64-bit value. The compare tests
write every MPS and LP case and check that HiGHS 1.16.0 reads the text as smaltlp does, and solves it to the
original's optimum.

## Examples

```ts
import { readMps, writeLp } from '@smaltworks/smaltlp';

const fromMps = readMps(`NAME plan
ROWS
 N cost
 L hours
 G need
COLUMNS
 a cost 2 hours 1
 a need 1
 b cost 3 hours 2
 b need 1
RHS
 rhs hours 10 need 2
BOUNDS
 UP bnd a 4
ENDATA`);
writeLp(fromMps).trimEnd().split('\n').map((line) => ({ line }))
```

| line |
| --- |
| \ Written by smaltlp |
| Minimize |
|  cost: +2 a +3 b |
| Subject To |
|  hours: +1 a +2 b <= 10 |
|  need: +1 a +1 b >= 2 |
| Bounds |
|  a <= 4 |
| End |


## See also

[`readLp`](./read-lp), [`writeMps`](./write-mps), [`problemToModel`](./problem-to-model)
