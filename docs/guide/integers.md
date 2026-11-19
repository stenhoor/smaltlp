---
description: 'Integer programs: whole-number and yes-or-no decisions, by matrices with milp() or by name with Integer and Binary variables.'
---

# Integer programs

Some decisions come only in whole numbers: trucks, staff, machines. Some are yes or no: build the depot or don't. A
linear program may answer 2.4 trucks; an integer program says how many whole trucks are best. smaltlp solves them by
branch-and-bound: it solves the linear program, and where an integer variable comes out fractional, say 2.4, it
solves two smaller problems, one with at most 2 and one with at least 3, and keeps the best whole answer.

## By name

Give a variable the category `'Integer'`, or `'Binary'` for one that is 0 or 1, and solve as before:

```ts
import { LpProblem, LpMinimize, LpSolveStatus, lpSum, value } from '@smaltworks/smaltlp';

// Deliver 61 tonnes: small trucks (7 t, cost 300), large trucks (13 t, cost 520), and up to 8 hours of overtime
// (1.5 t an hour, cost 45 an hour), with 6 drivers.
const prob = new LpProblem('trucks', LpMinimize);
const small = prob.addVariable('small', 0, null, 'Integer');
const large = prob.addVariable('large', 0, null, 'Integer');
const overtime = prob.addVariable('overtime', 0, 8);
prob.add(lpSum([small.times(300), large.times(520), overtime.times(45)]));
prob.add(lpSum([small.times(7), large.times(13), overtime.times(1.5)]).ge(61), 'tonnes');
prob.add(small.plus(large).le(6), 'drivers');
const stats = await prob.solve();
({ status: stats.statusStr, cost: value(prob.objective), small: small.varValue, large: large.varValue, overtime: overtime.varValue })
```

| status | cost | small | large | overtime |
| --- | --- | --- | --- | --- |
| Optimal | 2350 | 0 | 4 | 6 |

`stats.isMip` is `true`, and `stats.bestBound` is the bound the search proved. An integer program has no duals, so
`pi` and `dj` stay `null`; `slack` is set.

```ts
({ isMip: stats.isMip, bestBound: stats.bestBound, pi: prob.getConstraintByName('tonnes')!.pi, slack: prob.getConstraintByName('drivers')!.slack })
```

| isMip | bestBound | pi | slack |
| --- | --- | --- | --- |
| true | 2350 | null | 2 |

## By matrices

[`milp()`](../reference/milp) is scipy's interface: `integrality` marks the integer variables, `bounds` is `{ lb, ub }`
and each constraint is `{ A, lb, ub }`. The same trucks:

```ts
import { milp } from '@smaltworks/smaltlp';

const res = await milp([300, 520, 45], {
  integrality: [1, 1, 0],
  bounds: { lb: 0, ub: [null, null, 8] },
  constraints: [{ A: [[7, 13, 1.5]], lb: 61 }, { A: [[1, 1, 0]], ub: 6 }],
});
({ fun: res.fun, x: res.x, nodes: res.mipNodeCount > 0 })
```

| fun | x | nodes |
| --- | --- | --- |
| 2350 | [0, 4, 6] | true |

[`linprog()`](../reference/linprog) takes `integrality` too, as scipy's does, and solves the same way.

## Limits and the gap

The search stops when its best answer is within `mipRelGap` (`gapRel` in a model) of the bound it has proved: by
default 1e-4, HiGHS's. Set it to 0 to prove the optimum, or larger to stop sooner. `nodeLimit` and `timeLimit` stop the
search early. It then returns the best answer found so far, if it has one, with status 1 (`NodeLimit` or `TimeLimit`
in a model):

```ts
const early = await milp([300, 520, 45], {
  integrality: [1, 1, 0],
  bounds: { lb: 0, ub: [null, null, 8] },
  constraints: [{ A: [[7, 13, 1.5]], lb: 61 }, { A: [[1, 1, 0]], ub: 6 }],
  nodeLimit: 1,
});
({ status: early.status, message: early.message, x: early.x })
```

| status | message | x |
| --- | --- | --- |
| 1 | Node limit reached. | null |

## When there is no answer

A problem with no whole-number solution is infeasible (status 2, `Infeasible`), even where its linear program has one.
Where the linear program is unbounded, the integer program is unbounded if it has any solution at all. As scipy and
PuLP report it through HiGHS, smaltlp says "unbounded or infeasible": status 4 from `milp()`, `Undefined` (-3) in a
model.

## What to know

- Each node starts from its parent's basis, but there are no cutting planes yet: problems with many integer variables
  take far longer than in HiGHS. Small and medium problems are the aim (smaltworks ADR 0039).
- Semi-continuous and semi-integer variables (scipy's `integrality` 2 and 3) fail with `LP_UNSUPPORTED`.
- See [Where smaltlp differs](../reference/divergences) for the rest.
