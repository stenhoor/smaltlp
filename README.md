<picture><source media="(prefers-color-scheme: dark)" srcset="docs/public/lockup-on-dark.svg"><img alt="smaltlp" src="docs/public/lockup.svg" height="56"></picture>

<a href="https://smaltworks.dev/stability"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/public/work-in-progress-on-dark.svg"><img alt="Work in progress. Come build with us." src="docs/public/work-in-progress.svg" height="56"></picture></a>

**Small. Alternative. Optimal.** Linear and integer programming for smaltdb, in the browser.

**Status: phase 1, first slice, under way** ([smaltworks ADR 0039](https://github.com/stenhoor/smaltworks/blob/main/adr/0039-smaltlp-scope-and-architecture.md)).
`linprog()` solves linear programs with a bounded dual simplex: dual steepest edge pricing, the bound-flipping
ratio test and Harris's two passes. Its LU factorization is dense for now, so each iteration costs O(m²) for m
constraints; a sparse LU, presolve, the modelling layer, MPS files and the compare tests against HiGHS come next.

```ts
import { linprog } from '@smaltworks/smaltlp';

// Minimize -x + 4y subject to -3x + y ≤ 6, x + 2y ≤ 4, x free, y ≥ -3.
const res = await linprog([-1, 4], {
  AUb: [[-3, 1], [1, 2]],
  bUb: [6, 4],
  bounds: [[null, null], [-3, null]],
});
res.x; // Float64Array [10, -3]
res.fun; // -22
```

`linprog()` takes scipy.optimize.linprog's parameters in camelCase (`A_ub` is `AUb`) and gives its status codes and
result fields, duals (`marginals`) included. `integrality` fails with `LP_UNSUPPORTED`: integer variables come with
`milp()` in phase 2.

## What it will be

- **Linear programs first, then mixed-integer programs:** a sparse, bounded dual simplex in 64-bit floats, with
  presolve and scaling; then branch-and-bound, and cutting planes later.
- **Two ways in, one core:** a typed modelling layer in PuLP's style, and scipy's `linprog()` and `milp()` over matrices.
- **Models from files and tables:** MPS and CPLEX-LP files, read and written; models built from smaltdb results and
  smaltdf frames.
- **The CPU path is the product.** WebGPU and SIMD come later, and only where a benchmark shows they gain.
- **Our own code, with no runtime dependencies.** HiGHS, scipy and PuLP are references for behaviour and results,
  and the compare tests check against them.

## Development

| Command | What it does |
| --- | --- |
| `npm ci` | Installs dependencies, and builds `dist/` |
| `npm run check` | Typecheck (TypeScript 7), then the tests (`node --test`, on the TypeScript source) |
| `npm run build` | `dist/` and type declarations, emitted by TypeScript 6.0.3 |

Node 22.18 or later.

## License

[MIT](LICENSE).

<a href="https://smaltworks.dev"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/public/a-smaltworks-project-on-dark.svg"><img alt="A smaltworks project" src="docs/public/a-smaltworks-project.svg" height="28"></picture></a>
