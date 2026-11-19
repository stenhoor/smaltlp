---
description: 'For AI agents that write code with smaltlp. How to use it, its rules, and where the complete agent guide is.'
---

# For AI agents

This page is written for AI agents that write code with smaltlp, and it opens the agent guide. The site publishes
Markdown made for agents beside its pages:

- [`/agents.md`](https://stenhoor.github.io/smaltlp/agents.md): this page, then the reference, in one file. Every
  example in it is tested, with its result.
- [`/llms.txt`](https://stenhoor.github.io/smaltlp/llms.txt): an index of every page, each as Markdown.
- Any page as Markdown: its address with `.md`, such as
  [`guide/models.md`](https://stenhoor.github.io/smaltlp/guide/models.md).

## What smaltlp is

smaltlp is linear programming in TypeScript: scipy's `linprog` and PuLP 4.2's modelling layer, for the browser and
Node, solved by its own dual simplex. It has no runtime dependencies. The package is `@smaltworks/smaltlp`, which is
not on npm yet.

## How to use it

<!-- docs:skip -->
```ts
import { linprog, LpProblem, LpMaximize, LpSolveStatus, readMps, mpsToProblem, SmaltlpError } from '@smaltworks/smaltlp';

// From matrices: minimize c·x, AUb·x ≤ bUb, AEq·x = bEq, bounds (default [0, null]: x ≥ 0).
const res = await linprog(c, { AUb, bUb, AEq, bEq, bounds });
if (res.status === 0) use(res.x, res.fun, res.ineqlin.marginals);

// By name, in PuLP 4.2's style.
const prob = new LpProblem('plan', LpMaximize);
const x = prob.addVariable('x', 0);
prob.add(x.times(3));
prob.add(x.le(4), 'cap');
const stats = await prob.solve();
if (stats.status === LpSolveStatus.Optimal) use(x.varValue, prob.getConstraintByName('cap')!.pi);

// From an MPS file's text.
const fromFile = mpsToProblem(readMps(text));
```

## Rules

- `linprog` **minimizes**. To maximize, negate the costs, and negate `fun` back.
- `linprog`'s `status`: 0 optimal, 1 iteration limit, 2 infeasible, 3 unbounded, 4 numerical difficulties. `x`,
  `fun` and the marginals are `null` unless the status is 0.
- The modelling layer's statuses are PuLP 4.2's, in `LpSolveStatus`: `Optimal` is 1, `Infeasible` -1, `Unbounded` -2.
  Variables come only from `prob.addVariable(name, lowBound, upBound, cat)`.
- TypeScript has no operator overloading: write `x.times(3).plus(y)` for `3x + y`, and `.le()`, `.ge()`, `.eq()` for
  `<=`, `>=`, `==`. `prob.add()` is PuLP's `+=`.
- Bounds are numbers or `null` for none. `linprog` takes `[lower, upper]` pairs; `addVariable` takes them as
  arguments and refuses infinite ones, as PuLP does.
- Integer programs: `milp(c, { integrality, bounds: { lb, ub }, constraints: { A, lb, ub } })`, scipy's, or
  `'Integer'` and `'Binary'` variables in a model. They have no duals (`pi` and `dj` are `null`). An unbounded one is
  status 4 from `milp`, `Undefined` in a model. Semi-continuous variables (`integrality` 2, 3) fail with
  `LP_UNSUPPORTED`.
- Errors are `SmaltlpError`s with a `code` ([Errors](../reference/errors)).
