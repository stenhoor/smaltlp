# CLAUDE.md

smaltlp (repository `stenhoor/smaltlp`, npm `@smaltworks/smaltlp`) is linear and mixed-integer programming for the
smalt family, in TypeScript. It is a kit, beside smaltml. Its scope and architecture are smaltworks
[ADR 0039](https://github.com/stenhoor/smaltworks/blob/main/adr/0039-smaltlp-scope-and-architecture.md) (proposed). It
is part of the smalt family: smaltworks' [CONTEXT.md](https://github.com/stenhoor/smaltworks/blob/main/CONTEXT.md),
[STANDARDS.md](https://github.com/stenhoor/smaltworks/blob/main/STANDARDS.md) and
[session rules](https://github.com/stenhoor/smaltworks/blob/main/context/session-rules.md) apply here.

## Brand

Before changing the README, a site or how the product is described, read smalt-brand's `BRAND.md` and `DECISIONS.md`.
smaltlp's brand is set (smalt-brand DECISIONS.md, "smaltlp", 2026-11-17): "Small. Alternative. Optimal.", "Linear and
integer programming for smaltdb, in the browser.", said smalt-L-P, the **Aim** mark, in the Kits layer's jade. The logo
files and badges in `docs/public/` come from smalt-brand's `logos/smaltlp/` and `badges/`, unchanged; a change starts
there.

## Workflow

The family's rules: one task per branch and pull request; open it once CI passes; the owner merges. Before pushing,
`npm run check`, and `npm run test:browser` when the docs or their runner change.

The site (https://stenhoor.github.io/smaltlp/) mirrors smaltml's (the owner, 2026-11-18) and deploys from
`.github/workflows/docs.yml` only: the repository's Settings → Pages → Source must be **GitHub Actions**.

- **Facts only.** Don't tell the owner something you haven't confirmed. Label everything else as an assumption, in
  those words, with what would confirm it.
- **Watch your PRs to the merge,** through their events, never by polling. Merging stays with the owner.
- **Ask before adding outside code.** Ask the owner, and wait for a yes, before adding a package (a dependency of any
  kind, or a pin in `packed.json`), copying or bundling in someone else's code, or loading code from another site at run
  time (a CDN such as jsDelivr). Say what it is, its licence and size, what it's for, and why our own code can't do it.
  Outside code that a feature needs goes in a plugin, so it is named and optional, never in core.

## Commands

| Command | What it does |
| --- | --- |
| `npm ci` | Installs dependencies, and builds `dist/` |
| `npm run check` | Typecheck (TypeScript 7, the `typescript7` dev dependency), then the tests (`node --test`, on the TypeScript source: Node 22.18 and later strip its types) |
| `npm run compare` | Reruns `compare/run.py` through scipy, PuLP and highspy (pinned in `compare/requirements.txt`) and rewrites `fixtures/compare.json` |
| `npm run test:browser` | Builds the site and presses Run on every playground in headless Chromium (`test/browser/docs.mjs`). CI runs it |
| `npm run docs:dev` / `docs:build` | The site (VitePress). Its examples run in place (`docs/.vitepress/theme/smaltlp.ts`); `test/docs-examples.test.ts` checks the table under each and type-checks each with smaltty, and `UPDATE_DOCS=1 npm test` writes the tables |
| `npm run build` | `dist/` and type declarations, emitted by TypeScript 6.0.3 (`tsc`) for one more release (smaltty ADR 0030, decision 5) |

## Rules

- **References for behaviour, not code** (ADR 0039, section 2). scipy and HiGHS for results and status codes, PuLP for
  the modelling layer. Write our own code from the documentation and the papers; never copy or translate HiGHS, PuLP,
  OR-Tools, CLP, CBC or GLPK.
- **The CPU path is the product** (section 4): 64-bit floats, every browser, Node. WebGPU (section 7) is an accelerator,
  kept only where measured, and a GPU result that fails the 64-bit check is never returned as optimal.
- **Asynchronous API over a synchronous core** (section 3): every solve has a `*Sync` twin; the core touches neither
  the DOM nor Node.
- **No WebAssembly in this package.** Replaceable kernels go through smaltlp's own versioned contract (section 8); a
  plugin that serves them follows smaltworks DECISIONS.md, "WebAssembly: plugins only".
- **Unsupported fails, never answers differently:** a problem or option smaltlp doesn't support yet fails with an error
  and a code.
- **Erasable TypeScript only** (`erasableSyntaxOnly`): no enums, namespaces or parameter properties, so Node runs the
  source as it is. Relative imports name the `.ts` file; the build rewrites them to `.js`.
- **No runtime dependencies.** Dev dependencies: TypeScript (6.0.3 and 7) and `@types/node`; for the site, as smaltml
  has them (the owner, 2026-11-18): vitepress 1.6.4, smaltkit and smaltty (pinned to smaltml's commit and tag) and
  playwright 1.64.1 (CI's version). The compare tests' Python packages are pinned in `compare/requirements.txt`. Ask the
  owner before adding any other package.
- **Every ```` ```ts ```` block in `docs/` runs where it stands,** in the kit's playground with this site's runner. A
  page's examples share one scope, in order; the last line's value is the result, and the table under it is tested.
  A tested result can't hold a time. `<!-- docs:error CODE -->` marks one that must fail; `<!-- docs:skip -->` marks
  a block that isn't run (signatures, sketches). The site kit's files (`docs/.vitepress/theme/{agents,playground,
  shiki,smaltworks,stage}.ts`, `smaltdb.css`) are copied unchanged from smalt-brand's `themes/vitepress/`.
- **No number without its benchmark.** A speed claim names the benchmark that measured it, which anyone can rerun.
- **Layout:** `src/core/` holds what every solver shares (`errors.ts`, `sparse.ts` for CSC matrices, `basis.ts` for
  the basis factorization); `src/lp/` holds linear programs (`simplex.ts`, the dual simplex; `linprog.ts`, scipy's
  interface); `src/model/` is the modelling layer in PuLP 4.2's style (the owner, 2026-11-18: follow 4.2 only:
  `prob.addVariable()`, `constraints()`, `LpSolveStats` and `LpSolveStatus`, in camelCase), solved by the same dual
  simplex; `src/io/` reads model files (`mps.ts`, MPS free and fixed, and
  `mpsToProblem()`). Each area with its own `index.ts` is an entry point in `package.json`
  `exports`.
- **Compare tests** (ADR 0039, section 6): `compare/run.py` runs every case through scipy's linprog (HiGHS), PuLP
  (with HiGHS) and HiGHS's MPS reader, and writes `fixtures/compare.json`; `test/compare.test.ts` checks smaltlp
  against it, without Python. A new feature or option gets cases there: run `npm run compare` (in a virtual
  environment with `compare/requirements.txt`) and commit the fixtures. Cases are our own, hand-written or generated
  from a seed. Beside them, `test/kkt.test.ts` checks the optimality conditions on random problems.
- A significant decision gets an ADR, numbered in the family's sequence (smaltworks `adr/README.md`).
