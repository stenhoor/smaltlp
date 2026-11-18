---
description: 'Every error code smaltlp raises: what it means and what to do.'
---

# Errors

smaltlp's errors are `SmaltlpError`s: an `Error` with a `code` that says what went wrong, and a message that says
where (the parameter, the row, the line).

<!-- docs:skip -->
```ts
class SmaltlpError extends Error {
  readonly code: 'LP_PARAM' | 'LP_SHAPE' | 'LP_VALUE' | 'LP_UNSUPPORTED' | 'LP_FORMAT';
}
```

| Code | Meaning | What to do |
| --- | --- | --- |
| `LP_PARAM` | An option is missing, has the wrong type, or has a value smaltlp doesn't accept. | The function's reference page lists its parameters. |
| `LP_SHAPE` | A matrix or vector has the wrong number of rows or columns for the others. | Check the lengths: `c`, each matrix's rows and columns, each right-hand side. |
| `LP_VALUE` | A number is NaN, or infinite where it must be finite. | Use finite numbers; `null` means no bound. |
| `LP_UNSUPPORTED` | A feature smaltlp doesn't have yet. It fails rather than answering differently. | See [Where smaltlp differs](./divergences). |
| `LP_FORMAT` | A model file that doesn't follow its format. The message names the line. | Fix the line, or check the file's format option. |

A problem with no optimum is not an error: its solve ends with a status (infeasible, unbounded) instead.

## Example

<!-- docs:error LP_SHAPE -->
```ts
import { linprog } from '@smaltworks/smaltlp';

await linprog([1, 2], { AUb: [[1, 2, 3]], bUb: [4] })
```

```ts
import { SmaltlpError } from '@smaltworks/smaltlp';

let code = '';
try {
  await linprog([1], { integrality: [1] });
} catch (e) {
  if (e instanceof SmaltlpError) code = e.code;
}
code
```

| value |
| --- |
|  |
