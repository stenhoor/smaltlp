---
description: 'startWorker: smaltlp in a Web Worker, so a long solve does not freeze the page.'
---

# startWorker

<!-- docs:skip -->
```ts
function startWorker(url?: string | URL): LpWorker;

interface LpWorker {
  linprog(c: ArrayLike<number>, options?: LinprogOptions): Promise<LinprogResult>;
  milp(c: ArrayLike<number>, options?: MilpOptions): Promise<MilpResult>;
  solve(prob: LpProblem, options?: SolveOptions): Promise<LpSolveStats>;
  terminate(): void;
}
```

Starts smaltlp's worker script in a Web Worker and connects to it: the same solves, run off the page's main thread, so
a long solve doesn't freeze the page. From `@smaltworks/smaltlp/worker`.

## Parameters

- `url` (default: `worker.js` beside the module, where the package builds it): the worker script's URL. Where a
  bundler moves files, pass its URL for it: `new URL('@smaltworks/smaltlp/worker-script', import.meta.url)`.

## Returns

An `LpWorker`:

- `linprog` and `milp`: [`linprog`](../linprog) and [`milp`](../milp) in the worker, with their options and results.
- `solve(prob, options)`: solves an [`LpProblem`](../model/lp-problem) in the worker, then sets its variables'
  `varValue` and `dj` and its constraints' `pi` and `slack`, as `prob.solve()` does, and resolves to the
  `LpSolveStats`. The problem travels as [`problemToModel`](../io/problem-to-model) gives it.
- `terminate()`: stops the worker, and fails the requests still waiting.

## Errors

- `LP_UNSUPPORTED`: where there are no Web Workers (Node, for one): call the solvers directly, or
  [`serve`](./connect) on a port of your own.
- A solve's own errors come back from the worker as `SmaltlpError`s with their codes.

## Notes

Requests are answered one at a time, in the order sent. Arrays travel copied by `postMessage`, never transferred, so
yours stay usable. Code already off the main thread (a notebook kernel, a Node script) gains nothing from a worker:
call the solvers there directly.

## Examples

<!-- docs:skip -->
```ts
import { startWorker } from '@smaltworks/smaltlp/worker';

const solver = startWorker();
const res = await solver.linprog([-1, 4], { AUb: [[-3, 1], [1, 2]], bUb: [6, 4], bounds: [[null, null], [-3, null]] });
await solver.solve(prob); // prob's variables now hold their values
solver.terminate();
```

## See also

[`connect` and `serve`](./connect), [`linprog`](../linprog), [`milp`](../milp), [`LpProblem`](../model/lp-problem)
