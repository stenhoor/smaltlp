---
description: 'Every class and function in smaltlp, by area, with the entry point each comes from.'
---

# Reference

One page per class or function, grouped by area. Every page has its signature, parameters, what it returns, the errors
it raises, and examples with their tested results.

## Linear programs

- [`linprog`](./linprog): scipy.optimize.linprog's interface: minimize `c·x` over matrices and bounds.
  `@smaltworks/smaltlp/lp`

## Integer programs

- [`milp`](./milp): scipy.optimize.milp's interface: minimize `c·x` with some variables whole numbers, by
  branch-and-bound. `@smaltworks/smaltlp/mip`

## Modelling

From `@smaltworks/smaltlp/model`, in PuLP 4.2's style:

- [`LpProblem`](./model/lp-problem): a problem, its variables, objective and constraints; `solve()`.
- [`LpVariable`](./model/lp-variable): a decision variable, made by `addVariable()`.
- [`LpAffineExpression`](./model/lp-affine-expression): a linear expression, built with `plus`, `minus` and `times`.
- [`LpConstraint`](./model/lp-constraint): an expression with `≤`, `=` or `≥`, and after a solve its `pi` and `slack`.
- [`lpSum`, `lpDot`](./model/lp-sum): sums of terms.
- [`value`](./model/value): an expression's value after a solve.
- [`LpSolveStatus`](./model/lp-solve-status): the status codes, and `LpMinimize`, `LpMaximize` and the constraint
  senses.

## Model files

From `@smaltworks/smaltlp/io`:

- [`readMps`](./io/read-mps): reads an MPS file, free or fixed.
- [`readLp`](./io/read-lp): reads a CPLEX LP file.
- [`writeMps`](./io/write-mps), [`writeLp`](./io/write-lp): a model as MPS or LP text.
- [`problemToModel`](./io/problem-to-model): an `LpProblem` as a model to write.
- [`mpsToProblem`](./io/mps-to-problem): an `LpProblem` from what `readMps` read.

## Tables

From `@smaltworks/smaltlp/tables`: models from query results and frames.

- [`addVariables`](./tables/add-variables): a variable for each row of a table.
- [`dotColumn`](./tables/dot-column): a numeric column dotted with those variables.
- [`addConstraints`](./tables/add-constraints): constraints from a table of limits and a table of terms.
- [`variableRows`, `constraintRows`, `withColumn`](./tables/results): the answers as rows.

## Worker

From `@smaltworks/smaltlp/worker`:

- [`startWorker`](./worker/start-worker): smaltlp in a Web Worker, so a long solve doesn't freeze the page.
- [`connect`, `serve`](./worker/connect): smaltlp over any message port, such as a worker of your own.

## Errors and differences

- [Errors](./errors): every error code, with what it means and what to do.
- [Where smaltlp differs](./divergences) from scipy and PuLP.
