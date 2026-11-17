<picture><source media="(prefers-color-scheme: dark)" srcset="docs/public/lockup-on-dark.svg"><img alt="smaltlp" src="docs/public/lockup.svg" height="56"></picture>

<a href="https://smaltworks.dev/stability"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/public/work-in-progress-on-dark.svg"><img alt="Work in progress. Come build with us." src="docs/public/work-in-progress.svg" height="56"></picture></a>

**Small. Alternative. Optimal.** Linear and integer programming for smaltdb, in the browser.

**Status: proposed.** Nothing solves yet. This repository holds the scaffold while
[smaltworks ADR 0039](https://github.com/stenhoor/smaltworks/blob/main/adr/0039-smaltlp-scope-and-architecture.md),
its scope and architecture, is reviewed.

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
