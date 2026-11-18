---
description: 'What each limit is worth: duals (marginals, pi), slacks and reduced costs, from linprog and from a model.'
---

# Reading duals

An optimum comes with a price for every limit: how much the objective would change if the limit moved by one unit.
These are the duals. smaltlp gives them as scipy and PuLP do.

## From linprog

`res.ineqlin.marginals` holds one value per inequality row: the change in `fun` per unit more of that row's `bUb`.
`linprog` minimizes, so loosening a binding `≤` row lowers `fun`, and its marginal is negative or 0:

```ts
import { linprog } from '@smaltworks/smaltlp';

const res = await linprog([-3, -5], { AUb: [[1, 0], [0, 2], [3, 2]], bUb: [4, 12, 18] });
({ marginals: res.ineqlin!.marginals, slack: res.slack })
```

| marginals | slack |
| --- | --- |
| 0 | 2 |
| -1.5 | 0 |
| -1 | 0 |

A row with slack left (here plant 1, 2 hours unused) has marginal 0: more of it is worth nothing. `res.eqlin`,
`res.lower` and `res.upper` give the same for equality rows and for each variable's bounds.

## From a model

In the modelling layer, a constraint's `pi` is its dual, in the problem's own sense: in a maximization, a binding
`≤` constraint's `pi` is positive, the gain per unit more. `slack` is how far it is from binding, and a variable's
`dj` its reduced cost:

```ts
import { LpProblem, LpMaximize } from '@smaltworks/smaltlp';

const prob = new LpProblem('plan', LpMaximize);
const x = prob.addVariable('x', 0);
const y = prob.addVariable('y', 0);
prob.add(x.times(3).plus(y.times(5)));
prob.add(x.le(4), 'plant1').add(y.times(2).le(12), 'plant2').add(x.times(3).plus(y.times(2)).le(18), 'plant3');
await prob.solve();
prob.constraints().map((c) => ({ name: c.name, pi: c.pi, slack: c.slack }))
```

| name | pi | slack |
| --- | --- | --- |
| plant1 | 0 | 2 |
| plant2 | 1.5 | 0 |
| plant3 | 1 | 0 |

## Checking a dual

A dual is a rate. Move a limit by a small step and the objective moves by about the dual times the step. One more hour
in plant 3:

```ts
const more = await linprog([-3, -5], { AUb: [[1, 0], [0, 2], [3, 2]], bUb: [4, 12, 19] });
({ before: res.fun, after: more.fun, change: more.fun! - res.fun!, marginal: res.ineqlin!.marginals[2] })
```

| before | after | change | marginal |
| --- | --- | --- | --- |
| -36 | -37 | -1 | -1 |

## See also

[`linprog`](../reference/linprog), [`LpConstraint`](../reference/model/lp-constraint)
