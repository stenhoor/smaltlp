---
layout: home
hero:
  name: 'sm<span class="alt">alt</span><span class="suffix kit">lp</span>'
  text: 'Small. Alternative.<br>Optimal.'
  tagline: Linear and integer programming for smaltdb, in the browser.
  image:
    light: /aim-mark.svg
    dark: /aim-mark-on-dark.svg
    alt: smaltlp
  actions:
    - theme: brand
      text: Getting started
      link: /guide/getting-started
    - theme: alt
      text: Quick start
      link: /guide/quick-start
    - theme: alt
      text: GitHub
      link: https://github.com/stenhoor/smaltlp
features:
  - title: The best answer within your limits
    details: Costs, limits and choices as a linear program, solved to its optimum, with the duals that say what each limit is worth. Integer programs follow.
  - title: scipy's linprog and PuLP's models
    details: Solve from matrices with linprog(), scipy's interface, or build a model by name in PuLP 4.2's style. Read MPS files from other solvers.
  - title: Exact, in 64-bit floats
    details: A bounded dual simplex in TypeScript, in the browser and in Node, with no runtime dependencies and no WebAssembly.
  - title: Checked against HiGHS
    details: Every case is compared with scipy's linprog, PuLP and HiGHS's reader, and the results are kept as tests that run without Python.
---

<!-- docs:skip -->
```ts
import { linprog } from '@smaltworks/smaltlp';

const res = await linprog([-3, -5], { AUb: [[1, 0], [0, 2], [3, 2]], bUb: [4, 12, 18] });
res.x; // the plan; res.fun its cost; res.ineqlin.marginals what each limit is worth
```
