---
description: 'addVariables: a variable for each row of a table, named by a column, with bounds and categories fixed or read from columns.'
---

# addVariables

<!-- docs:skip -->
```ts
function addVariables(prob: LpProblem, table: Table, from: {
  name: string;
  lowBound?: number | null | string;
  upBound?: number | null | string;
  cat?: string;
}): LpVariable[];

type Table = readonly Record<string, unknown>[] | { columns: readonly string[]; rows: readonly unknown[][] };
```

Adds a variable to `prob` for each row of `table`, and returns them in row order. From `@smaltworks/smaltlp/tables`.

## Parameters

- `prob`: the problem.
- `table`: row objects (smaltdb's `db.query()`, smaltdf's `toObjects()`), or `{ columns, rows }` (smaltdf's
  `collect()`).
- `name`: the column naming each row's variable.
- `lowBound`, `upBound` (default `null`, no bound): a number or `null` for every variable, or a column's name, read
  per row (an empty cell is no bound). A bigint that fits is read as a number.
- `cat` (default `'Continuous'`): `'Continuous'`, `'Integer'` or `'Binary'` for every variable, or a column's name
  holding each one's.

## Returns

The variables, in the table's row order, as [`prob.addVariable`](../model/lp-problem) makes them.

## Errors

- `LP_PARAM`: no `name` option; a column a row doesn't have; a name the problem already has, or two rows with the same
  name; a table that isn't rows or `{ columns, rows }`.
- `LP_VALUE`: an empty name; a bound that isn't a number; a category other than the three.
- `LP_SHAPE`: a `{ columns, rows }` row with another number of values than columns.

## Examples

```ts
import { LpProblem, LpMaximize, addVariables } from '@smaltworks/smaltlp';

const items = { columns: ['item', 'kind', 'most'], rows: [['a', 'Binary', null], ['b', 'Integer', 3], ['c', 'Continuous', 2.5]] };
const prob = new LpProblem('pick', LpMaximize);
const vars = addVariables(prob, items, { name: 'item', lowBound: 0, upBound: 'most', cat: 'kind' });
vars.map((v) => ({ name: v.name, cat: v.cat, low: v.lowBound, up: v.upBound }))
```

| name | cat | low | up |
| --- | --- | --- | --- |
| a | Binary | 0 | 1 |
| b | Integer | 0 | 3 |
| c | Continuous | 0 | 2.5 |

## See also

[`dotColumn`](./dot-column), [`addConstraints`](./add-constraints), [Models from tables](../../guide/tables)
