---
description: 'dotColumn: a numeric column of a table dotted with the variables made from its rows.'
---

# dotColumn

<!-- docs:skip -->
```ts
function dotColumn(table: Table, column: string, vars: readonly LpVariable[]): LpAffineExpression;
```

Σ `row[column]` × `vars[i]`: a numeric column of `table` dotted with the variables made from its rows, in order, as
[`lpDot`](../model/lp-sum) does. Use it for an objective or a constraint's left side. From
`@smaltworks/smaltlp/tables`.

## Parameters

- `table`: the table the variables were made from ([`addVariables`](./add-variables)).
- `column`: the column holding the coefficients.
- `vars`: the variables, one per row.

## Returns

An [`LpAffineExpression`](../model/lp-affine-expression).

## Errors

- `LP_SHAPE`: a different number of rows and variables.
- `LP_VALUE`: an empty cell, or one that isn't a finite number.
- `LP_PARAM`: a column a row doesn't have.

## Examples

```ts
import { LpProblem, LpMinimize, addVariables, dotColumn } from '@smaltworks/smaltlp';

const foods = [{ food: 'bread', cost: 2 }, { food: 'milk', cost: 3.5 }];
const prob = new LpProblem('diet', LpMinimize);
const eat = addVariables(prob, foods, { name: 'food', lowBound: 0 });
dotColumn(foods, 'cost', eat).toString()
```

| value |
| --- |
| 2\*bread + 3.5\*milk |

## See also

[`addVariables`](./add-variables), [`lpDot`](../model/lp-sum)
