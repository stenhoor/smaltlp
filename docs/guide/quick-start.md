---
description: 'Five minutes, three steps. Install smaltlp, solve a linear program from your code, then change it and run it on this page.'
---

# Quick start

Five minutes, three steps: install smaltlp, solve a linear program from your code, then change it and run it on this
page.

## 1. Install

```sh
npm install --save-exact @smaltworks/smaltlp@0.14.0
```

smaltlp 0.14.0 is not on npm yet. [Installation](./getting-started) has the entry points and what else to know.

## 2. Solve a problem from your code

<!-- docs:skip -->
```ts
import { linprog } from '@smaltworks/smaltlp';

// A workshop makes tables (profit 3) and chairs (profit 5). Plant 1 has 4 hours, plant 2 has 12, plant 3 has 18.
// linprog minimizes, so the profits go in negated.
const res = await linprog([-3, -5], { AUb: [[1, 0], [0, 2], [3, 2]], bUb: [4, 12, 18] });
console.log(res.x, -res.fun); // Float64Array [ 2, 6 ] 36
```

`linprog` minimizes `c·x` subject to `AUb·x ≤ bUb`, and `x ≥ 0` unless you give other bounds. It answers with the
best `x`, its cost `fun`, and what each limit is worth.

## 3. Try it here

This example runs in your browser. Change it and press **Run** (or Ctrl+Enter). **Reset** brings back the example,
and **Share** copies a link to your version.

```ts
import { linprog } from '@smaltworks/smaltlp';

const res = await linprog([-3, -5], { AUb: [[1, 0], [0, 2], [3, 2]], bUb: [4, 12, 18] });
({ tables: res.x![0], chairs: res.x![1], profit: -res.fun! })
```

| tables | chairs | profit |
| --- | --- | --- |
| 2 | 6 | 36 |

The table under the code is the tested result: the docs' tests run every example and check what it prints. The last
line's value is what a Run shows.

The examples on a page build on each other, as a notebook's cells do. This one reads the solve above: how much more
profit one more hour in each plant would bring.

```ts
Array.from(res.ineqlin!.marginals, (m) => -m)
```

| value |
| --- |
| 0 |
| 1.5 |
| 1 |

Plant 1 has hours to spare, so another is worth nothing; an hour more in plant 2 is worth 1.5, in plant 3 worth 1.

## Next

- [Installation](./getting-started): the package, its entry points and what it takes.
- [Building a model](./models): the same problem, by name, in PuLP's style.
- [Reading duals](./duals): what the marginals mean.
