---
description: 'LpSolveStatus: PuLP 4.2''s status codes, and LpMinimize, LpMaximize and the constraint senses.'
---

# LpSolveStatus

<!-- docs:skip -->
```ts
const LpSolveStatus: {
  NotSolved: 0; Optimal: 1; Infeasible: -1; Unbounded: -2; Undefined: -3; TimeLimit: -4; MemoryLimit: -5;
  NodeLimit: -6; GapLimit: -7; IterationLimit: -8; SolutionLimit: -9; Interrupted: -10; Stopped: -11;
  NumericalError: -12;
};
const LpMinimize = 1;
const LpMaximize = -1;
const LpConstraintLE = -1;
const LpConstraintEQ = 0;
const LpConstraintGE = 1;
```

PuLP 4.2's status codes, as `LpSolveStats.status` gives them, and its numbers for a problem's sense and a
constraint's.

## Returns

smaltlp's solves end in one of these:

- `Optimal` (1): an optimum was found (for an integer program, within `gapRel`).
- `Infeasible` (-1): no point meets every constraint (for an integer program, no whole-number point).
- `Unbounded` (-2): the objective improves without limit.
- `Undefined` (-3): an integer program whose linear program is unbounded: it is unbounded or infeasible, as PuLP 4.2
  reports it through HiGHS.
- `TimeLimit` (-4), `NodeLimit` (-6): an integer program's `timeLimit` or `nodeLimit` stopped the search.
  `hasSolution` says whether it found an answer first.
- `IterationLimit` (-8): `maxIter` stopped the solve.
- `NumericalError` (-12): the solve met numerical difficulties.

The other codes are PuLP's, for limits and solvers smaltlp doesn't have.

## Notes

The compare tests check `Optimal`, `Infeasible`, `Unbounded` and `Undefined`, and their `statusStr`, against PuLP
4.2.0 with HiGHS. `TimeLimit`, `NodeLimit`, `IterationLimit` and `NumericalError` are the codes PuLP 4.2 has for those
ends.

## Examples

```ts
import { LpSolveStatus, LpProblem, LpMaximize } from '@smaltworks/smaltlp';

const prob = new LpProblem('runaway', LpMaximize);
prob.add(prob.addVariable('w', 0));
const s = await prob.solve();
({ status: s.status, unbounded: s.status === LpSolveStatus.Unbounded, statusStr: s.statusStr })
```

| status | unbounded | statusStr |
| --- | --- | --- |
| -2 | true | Unbounded |

## See also

[`LpProblem`](./lp-problem)
