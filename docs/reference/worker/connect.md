---
description: 'connect and serve: smaltlp over any message port, such as a worker of your own.'
---

# connect

<!-- docs:skip -->
```ts
function connect(port: Port): LpWorker;
function serve(port: Port): void;
interface Port {
  postMessage(message: unknown): void;
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
  start?(): void;
}
```

`connect` talks to smaltlp served on a port; `serve` answers on one. [`startWorker`](./start-worker) is the two with
smaltlp's own worker script. Use them to serve smaltlp from a worker of your own, beside your other work. Both are in
`@smaltworks/smaltlp/worker`.

## Parameters

- `port`: a `Worker`, a worker's `self`, or a `MessagePort` (in Node too, such as a worker thread's `parentPort`).

## Returns

`connect` returns an `LpWorker` ([`startWorker`](./start-worker#returns)). `serve` returns nothing: it answers
requests until the port closes.

## Errors

As [`startWorker`](./start-worker#errors).

## Examples

Both ends of one channel, here in one page, give exactly the results of the direct calls:

```ts
import { connect, serve } from '@smaltworks/smaltlp/worker';

const { port1, port2 } = new MessageChannel();
serve(port1);
const solver = connect(port2);
const res = await solver.linprog([-3, -5], { AUb: [[1, 0], [0, 2], [3, 2]], bUb: [4, 12, 18] });
solver.terminate();
({ status: res.status, fun: res.fun, x: res.x })
```

| status | fun | x |
| --- | --- | --- |
| 0 | -36 | [2, 6] |

In a worker of your own, `serve` answers on the worker's scope:

<!-- docs:skip -->
```ts
// my-worker.ts
import { serve } from '@smaltworks/smaltlp/worker';
serve(self);

// on the page
import { connect } from '@smaltworks/smaltlp/worker';
const solver = connect(new Worker(new URL('./my-worker.ts', import.meta.url), { type: 'module' }));
```

## See also

[`startWorker`](./start-worker)
