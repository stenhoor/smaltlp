---
description: 'Where smaltlp differs from scipy''s linprog and milp and PuLP 4.2: what it doesn''t have yet, and what it does differently.'
---

# Where smaltlp differs

smaltlp follows scipy's `linprog` and `milp` and PuLP 4.2's behaviour. Where it doesn't, it says so here. What it doesn't support
fails with `LP_UNSUPPORTED`; it never answers differently.

## Not yet

- **Semi-continuous and semi-integer variables:** `integrality` 2 and 3, in `milp` and `linprog`.
- **`milp` options:** `disp`. scipy's `milp` takes a constraint as a tuple `(A, lb, ub)` too; smaltlp takes
  `{ A, lb, ub }` only.
- **Branch-and-bound:** no cutting planes, primal heuristics or MIP presolve (presolve simplifies the root's linear
  program only), so smaltlp takes far longer than HiGHS on larger integer programs.
- **`linprog` options:** `method`, `callback`, `x0` and scipy's other `options`: only `maxIter` and `tol`.
- **Model files:** writing MPS, and the CPLEX LP format, in either direction. MPS SC bounds, quadratic sections and
  more than one RHS, RANGES or BOUNDS set.
- **PuLP:** `add_variable_dict`, `add_variable_dicts` and `add_variable_matrix`; solver choice (smaltlp has its own);
  writing LP and MPS files from a problem.
- **Presolve:** smaltlp's removes empty rows, fixed variables and singleton rows, and restores the duals afterwards.
  HiGHS's does much more (doubleton equations, dominated columns, bound tightening, …).

## Different

- **Names:** scipy's and PuLP's names in camelCase: `A_ub` is `AUb`, `add_variable` is `addVariable`, `status_str` is
  `statusStr`. TypeScript has no operator overloading: `x.times(3).plus(y).le(4)` for `3*x + y <= 4`, and
  `prob.add()` for `+=`.
- **Several optima:** where more than one solution is optimal, smaltlp may give another of them than HiGHS does. The
  objective is the same; the compare tests check `x` only where it is unique.
- **Without an optimum,** `linprog` gives `null` for `x`, `fun` and the marginals.
- **LpSolveStats** has the fields smaltlp can fill: `solver` is `'smaltlp'`, and `bestBound` is PuLP's `best_bound`;
  PuLP's `cpu_time`, `solver_options` and `logs` are not there.
- **Integer programs have no duals:** `pi` and `dj` stay `null`, where PuLP 4.2 with HiGHS gives 0. `linprog` with
  `integrality` gives marginals of 0, as scipy does.
- **`linprog`'s `nit` with `integrality`** counts the simplex iterations over every node, where scipy gives -1.
- **An unbounded integer program** is "unbounded or infeasible": status 4 from `milp` and `linprog`, `Undefined` in a
  model, as scipy and PuLP report it through HiGHS. smaltlp doesn't search for a solution to tell the two apart.
- **The gap** is `(fun − bound) / |fun|`, HiGHS's relative gap, with an absolute gap of 1e-6 as well, HiGHS's default.
  Within the gap, smaltlp and HiGHS may stop at different solutions; the compare tests solve to a gap of 0.
