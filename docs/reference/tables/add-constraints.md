---
description: 'addConstraints: constraints from a table of limits and a long table of terms.'
---

# addConstraints

<!-- docs:skip -->
```ts
function addConstraints(
  prob: LpProblem,
  limits: { rows: Table; name: string; sense: string; rhs: string },
  terms: { rows: Table; constraint: string; variable: string; coefficient: string },
): LpConstraint[];
```

Adds a constraint to `prob` for each row of the limits, and returns them in row order: Σ coefficient × variable over
the constraint's rows in the terms table, with its sense and right-hand side. From `@smaltworks/smaltlp/tables`.

## Parameters

- `limits.rows`: one row per constraint. `name` is the column naming it; `rhs` the column holding its right-hand side;
  `sense` either `'<='`, `'>='` or `'='` for every constraint, or the column holding each one's (`<=`, `>=`, `=`, or
  `le`, `ge`, `eq`).
- `terms.rows`: one row per coefficient, in long format. `constraint` names the constraint as the limits do,
  `variable` names a variable the problem has, `coefficient` holds the number. Two rows for the same constraint and
  variable add up.

## Returns

The constraints, each added under its name.

## Errors

- `LP_PARAM`: a term for a constraint the limits don't name, or a variable the problem doesn't have; two limits with
  the same name, or a name the problem already has; a column a row doesn't have.
- `LP_VALUE`: a sense other than the six; an empty or non-numeric right-hand side or coefficient.

## Notes

A limit with no terms is a constraint on nothing: `0 <= 4` holds, `0 >= 4` makes the problem infeasible.

## Examples

```ts
import { LpProblem, LpMinimize, addVariables, addConstraints } from '@smaltworks/smaltlp';

const prob = new LpProblem('diet', LpMinimize);
addVariables(prob, [{ food: 'bread' }, { food: 'milk' }], { name: 'food', lowBound: 0 });
const needs = [{ nutrient: 'energy', least: 2000, sense: '>=' }, { nutrient: 'fat', least: 40, sense: '<=' }];
const content = [
  { nutrient: 'energy', food: 'bread', amount: 65 },
  { nutrient: 'energy', food: 'milk', amount: 110 },
  { nutrient: 'fat', food: 'bread', amount: 1 },
  { nutrient: 'fat', food: 'milk', amount: 6 },
];
const cons = addConstraints(
  prob,
  { rows: needs, name: 'nutrient', sense: 'sense', rhs: 'least' },
  { rows: content, constraint: 'nutrient', variable: 'food', coefficient: 'amount' },
);
cons.map((c) => c.toString())
```

| value |
| --- |
| 65\*bread + 110\*milk >= 2000 |
| bread + 6\*milk <= 40 |

## See also

[`addVariables`](./add-variables), [`LpConstraint`](../model/lp-constraint), [Models from tables](../../guide/tables)
