---
description: 'variableRows, constraintRows and withColumn: a solve''s answers as rows, for a table or a frame.'
---

# variableRows

<!-- docs:skip -->
```ts
function variableRows(prob: LpProblem): { name: string; varValue: number | null; dj: number | null }[];
function constraintRows(prob: LpProblem): { name: string; pi: number | null; slack: number | null }[];
function withColumn(table: Table, vars: readonly LpVariable[], column?: string): Record<string, unknown>[];
```

A solve's answers as rows: `variableRows` gives each variable's value and reduced cost, `constraintRows` each
constraint's dual value and slack, and `withColumn` your own rows with each variable's value added as a column. Rows
like these go into a smaltdb table or a smaltdf frame as they are. From `@smaltworks/smaltlp/tables`.

## Parameters

- `prob`: the problem, after a solve (before one, the values are `null`).
- `table`, `vars`: the table the variables were made from, and the variables ([`addVariables`](./add-variables)).
- `column` (default `'value'`): the name of the added column.

## Returns

New arrays of new row objects; `withColumn` copies each row and leaves `table` as it was.

## Errors

- `LP_SHAPE`: `withColumn` with a different number of rows and variables.

## Examples

```ts
import { LpProblem, LpMaximize, addVariables, dotColumn, variableRows, withColumn } from '@smaltworks/smaltlp';

const goods = [{ good: 'x', profit: 3 }, { good: 'y', profit: 2 }];
const prob = new LpProblem('two', LpMaximize);
const qty = addVariables(prob, goods, { name: 'good', lowBound: 0, upBound: 4 });
prob.add(dotColumn(goods, 'profit', qty));
prob.add(qty[0]!.plus(qty[1]!).le(5), 'room');
await prob.solve();
variableRows(prob)
```

| name | varValue | dj |
| --- | --- | --- |
| x | 4 | 1 |
| y | 1 | 0 |

```ts
withColumn(goods, qty, 'qty')
```

| good | profit | qty |
| --- | --- | --- |
| x | 3 | 4 |
| y | 2 | 1 |

## See also

[`addVariables`](./add-variables), [Models from tables](../../guide/tables)
