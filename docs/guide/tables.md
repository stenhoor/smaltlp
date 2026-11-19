---
description: 'Build a model from tables: variables from query rows, constraints from a table of limits and a table of terms, and the answers back as rows.'
---

# Models from tables

Data for a model often sits in tables: products with their profits and limits, resources with what's available, and
how much of each resource each product takes. `@smaltworks/smaltlp/tables` builds the model from them and gives the
answers back as rows. A table is what smaltdb and smaltdf give, without importing either: an array of row objects
(smaltdb's `db.query()`, smaltdf's `toObjects()`), or `{ columns, rows }` (smaltdf's `collect()`).

## Variables from rows

One variable per row, named by a column, with bounds fixed or read from columns:

```ts
import { LpProblem, LpMaximize, addVariables, dotColumn } from '@smaltworks/smaltlp';

// As a query might return them.
const products = [
  { product: 'tables', profit: 3, most: 4 },
  { product: 'chairs', profit: 5, most: null },
];
const prob = new LpProblem('plan', LpMaximize);
const make = addVariables(prob, products, { name: 'product', lowBound: 0, upBound: 'most' });
prob.add(dotColumn(products, 'profit', make));
make.map((v) => ({ name: v.name, low: v.lowBound, up: v.upBound }))
```

| name | low | up |
| --- | --- | --- |
| tables | 0 | 4 |
| chairs | 0 | null |

## Constraints from a table of limits and a table of terms

The limits give one row per constraint; the terms give one row per coefficient, naming the constraint and the
variable:

```ts
import { addConstraints } from '@smaltworks/smaltlp';

const resources = { columns: ['resource', 'available'], rows: [['plant1', 4], ['plant2', 12], ['plant3', 18]] };
const uses = [
  { resource: 'plant1', product: 'tables', hours: 1 },
  { resource: 'plant2', product: 'chairs', hours: 2 },
  { resource: 'plant3', product: 'tables', hours: 3 },
  { resource: 'plant3', product: 'chairs', hours: 2 },
];
const cons = addConstraints(
  prob,
  { rows: resources, name: 'resource', sense: '<=', rhs: 'available' },
  { rows: uses, constraint: 'resource', variable: 'product', coefficient: 'hours' },
);
cons.map((c) => ({ name: c.name, constraint: c.toString() }))
```

| name | constraint |
| --- | --- |
| plant1 | tables <= 4 |
| plant2 | 2\*chairs <= 12 |
| plant3 | 3\*tables + 2\*chairs <= 18 |

## The answers as rows

```ts
import { variableRows, constraintRows, withColumn } from '@smaltworks/smaltlp';

await prob.solve();
withColumn(products, make, 'make')
```

| product | profit | most | make |
| --- | --- | --- | --- |
| tables | 3 | 4 | 2 |
| chairs | 5 | null | 6 |

```ts
constraintRows(prob)
```

| name | pi | slack |
| --- | --- | --- |
| plant1 | 0 | 2 |
| plant2 | 1.5 | 0 |
| plant3 | 1 | 0 |

`variableRows(prob)` gives each variable's `varValue` and `dj` the same way. Rows like these go back into a smaltdb
table or a smaltdf frame as they are.

## See also

[`addVariables`](../reference/tables/add-variables), [`dotColumn`](../reference/tables/dot-column),
[`addConstraints`](../reference/tables/add-constraints), [`variableRows`](../reference/tables/results)
