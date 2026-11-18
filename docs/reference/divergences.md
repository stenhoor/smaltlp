---
description: 'Where smaltlp differs from scipy''s linprog and PuLP 4.2: what it doesn''t have yet, and what it does differently.'
---

# Where smaltlp differs

smaltlp follows scipy's `linprog` and PuLP 4.2's behaviour. Where it doesn't, it says so here. What it doesn't support
fails with `LP_UNSUPPORTED`; it never answers differently.

## Not yet

- **Integer variables:** `linprog`'s `integrality`, and `'Integer'` or `'Binary'` variables in a model, fail until
  `milp()` (phase 2).
- **`linprog` options:** `method`, `callback`, `x0` and scipy's other `options`: only `maxIter` and `tol`.
- **Model files:** writing MPS, and the CPLEX LP format, in either direction. MPS SC bounds, quadratic sections and
  more than one RHS, RANGES or BOUNDS set.
- **PuLP:** `add_variable_dict`, `add_variable_dicts` and `add_variable_matrix`; solver choice (smaltlp has its own);
  writing LP and MPS files from a problem.
- **Size:** the basis factorization is dense, so each iteration costs O(m²) for m constraints. A sparse LU, and
  presolve, come later.

## Different

- **Names:** scipy's and PuLP's names in camelCase: `A_ub` is `AUb`, `add_variable` is `addVariable`, `status_str` is
  `statusStr`. TypeScript has no operator overloading: `x.times(3).plus(y).le(4)` for `3*x + y <= 4`, and
  `prob.add()` for `+=`.
- **Several optima:** where more than one solution is optimal, smaltlp may give another of them than HiGHS does. The
  objective is the same; the compare tests check `x` only where it is unique.
- **Without an optimum,** `linprog` gives `null` for `x`, `fun` and the marginals.
- **LpSolveStats** has the fields smaltlp can fill: `solver` is `'smaltlp'`; PuLP's MIP and solver-detail fields are
  not there.
