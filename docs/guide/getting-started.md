---
description: 'Install smaltlp, choose the entry points you need, and pass it a problem: matrices, a model, or an MPS file.'
---

# Installation

```sh
npm install --save-exact @smaltworks/smaltlp@0.14.0
```

smaltlp 0.14.0 is not on npm yet: it is a work in progress, and versions before 1.0 can change. Pin the exact version.
smaltlp has no runtime dependencies. It is plain ES2022 modules and runs in every browser the smalt family supports,
in Web Workers and in Node 22.18 or later.

## Entry points

Import everything from `@smaltworks/smaltlp`, or each area from its own entry point, so an app loads only what it
uses:

| Entry point | What it holds |
| --- | --- |
| `@smaltworks/smaltlp` | Everything below, and `SmaltlpError`, `VERSION` |
| `@smaltworks/smaltlp/lp` | `linprog`, `linprogSync` |
| `@smaltworks/smaltlp/model` | `LpProblem`, `LpVariable`, `LpAffineExpression`, `LpConstraint`, `lpSum`, `lpDot`, `value`, `LpSolveStatus`, `LpMinimize`, `LpMaximize`, `LpConstraintLE`, `LpConstraintEQ`, `LpConstraintGE` |
| `@smaltworks/smaltlp/io` | `readMps`, `mpsToProblem` |

## Three ways in

- **Matrices,** with [`linprog`](../reference/linprog): scipy's interface. Costs `c`, inequality rows `AUb·x ≤ bUb`,
  equality rows `AEq·x = bEq`, and bounds. See [Solving from matrices](./matrices).
- **A model,** with [`LpProblem`](../reference/model/lp-problem): variables and constraints by name, in PuLP 4.2's
  style. See [Building a model](./models).
- **An MPS file,** with [`readMps`](../reference/io/read-mps): models written by other solvers. See
  [Reading MPS files](./mps).

All three solve with the same bounded dual simplex, on the CPU in 64-bit floats. Every solve has an asynchronous call
and a synchronous twin (`linprog` and `linprogSync`, `solve` and `solveSync`) that give the same answer.

```ts
import { VERSION } from '@smaltworks/smaltlp';

VERSION
```

| value |
| --- |
| 0.14.0 |

## What it solves now

Linear programs, with continuous variables. Integer and binary variables can be declared, and solving them fails with
`LP_UNSUPPORTED` until `milp()` arrives. The basis factorization is dense for now, so each iteration costs O(m²) for
m constraints: models of hundreds of constraints are its size today. See
[Where smaltlp differs](../reference/divergences).
