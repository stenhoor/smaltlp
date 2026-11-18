---
description: 'Try smaltlp in your browser: build a model, solve it and read its duals, with nothing to install.'
---

# Playground

Build a model, solve it and read what each limit is worth, in your browser. Change the code and press **Run** (or
Ctrl+Enter). The last line's value is the result.

```ts
import { LpProblem, LpMinimize, LpSolveStatus, lpDot, value } from '@smaltworks/smaltlp';

// A cheap diet: bread, milk and beans, with enough calories and protein, and not too much fat.
const prob = new LpProblem('diet', LpMinimize);
const bread = prob.addVariable('bread', 0, 10);
const milk = prob.addVariable('milk', 0, 10);
const beans = prob.addVariable('beans', 0);
prob.add(lpDot([2, 3.5, 8], [bread, milk, beans]));
prob.add(lpDot([65, 110, 245], [bread, milk, beans]).ge(2000), 'calories');
prob.add(lpDot([2, 6, 20], [bread, milk, beans]).ge(55), 'protein');
prob.add(lpDot([1, 6, 2], [bread, milk, beans]).le(40), 'fat');
const stats = await prob.solve();
({ status: stats.statusStr, cost: value(prob.objective), bread: bread.varValue, milk: milk.varValue, beans: beans.varValue })
```

| status | cost | bread | milk | beans |
| --- | --- | --- | --- | --- |
| Optimal | 63.74 | 10 | 3.72 | 3.84 |
