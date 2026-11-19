import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Worker } from 'node:worker_threads';
import { linprogSync, LpMaximize, LpProblem, lpSum, milpSync, SmaltlpError } from '../src/index.ts';
import { connect, serve, startWorker, type Port } from '../src/worker/index.ts';

/** A client and a server on the two ends of one channel, in this thread. */
function pair() {
  const { port1, port2 } = new MessageChannel();
  serve(port1 as unknown as Port);
  return connect(port2 as unknown as Port & { close(): void });
}

function plan() {
  const prob = new LpProblem('plan', LpMaximize);
  const tables = prob.addVariable('tables', 0, 4);
  const chairs = prob.addVariable('chairs', 0, null, 'Integer');
  const flag = prob.addVariable('flag', null, null, 'Binary');
  prob.add(lpSum([tables.times(3), chairs.times(5), flag.times(2)]).plus(1));
  prob.add(tables.plus(chairs.times(2)).le(12.5), 'hours');
  prob.add(lpSum([tables.times(3), chairs.times(2), flag]).le(18), 'wood');
  prob.add(chairs.ge(1), 'least');
  return { prob, tables, chairs, flag };
}

test('linprog and milp in a worker give exactly the results of the synchronous calls', async () => {
  const solver = pair();
  const lp = { AUb: [[-3, 1], [1, 2]], bUb: [6, 4], bounds: [[null, null], [-3, null]] as [number | null, number | null][] };
  assert.deepEqual(await solver.linprog([-1, 4], lp), linprogSync([-1, 4], lp));
  const mip = { integrality: 1, bounds: { lb: 0, ub: 1 }, constraints: { A: [[11, 15, 20, 35, 10, 33]], ub: 47 } };
  const c = [-10, -13, -18, -31, -7, -15];
  assert.deepEqual(await solver.milp(c, mip), milpSync(c, mip));
  solver.terminate();
});

test('solve() in a worker sets values, duals and slacks on the problem, as prob.solve() does', async () => {
  const here = plan();
  const there = plan();
  const want = here.prob.solveSync({ gapRel: 0 });
  const solver = pair();
  const got = await solver.solve(there.prob, { gapRel: 0 });
  solver.terminate();
  assert.equal(got.status, want.status);
  assert.equal(got.objective, want.objective);
  assert.equal(got.bestBound, want.bestBound);
  assert.equal(got.isMip, true);
  for (const k of ['tables', 'chairs', 'flag'] as const) assert.equal(there[k].varValue, here[k].varValue, k);
  there.prob.constraints().forEach((con, i) => {
    assert.equal(con.slack, here.prob.constraints()[i]!.slack, con.name!);
    assert.equal(con.pi, here.prob.constraints()[i]!.pi, con.name!);
  });
  // A linear program's duals come back too.
  const lp = new LpProblem('lp', LpMaximize);
  const x = lp.addVariable('x', 0);
  const y = lp.addVariable('y', 0);
  lp.add(x.times(3).plus(y.times(5)));
  lp.add(x.le(4), 'p1').add(y.times(2).le(12), 'p2').add(x.times(3).plus(y.times(2)).le(18), 'p3');
  const s2 = pair();
  await s2.solve(lp);
  s2.terminate();
  assert.deepEqual([x.varValue, y.varValue], [2, 6]);
  assert.deepEqual(lp.constraints().map((c) => c.pi), [0, 1.5, 1]);
});

test('errors come back with their code; requests answer in order; terminate fails the waiting ones', async () => {
  const solver = pair();
  await assert.rejects(solver.linprog([]), (e: unknown) => e instanceof SmaltlpError && e.code === 'LP_SHAPE');
  await assert.rejects(solver.milp([1], { integrality: [2] }), (e: unknown) => e instanceof SmaltlpError && e.code === 'LP_UNSUPPORTED' && e.message.startsWith('LP_UNSUPPORTED: integrality 2'));
  const answers = await Promise.all([1, 2, 3].map((k) => solver.linprog([1], { bounds: [k, null] })));
  assert.deepEqual(answers.map((r) => r.fun), [1, 2, 3]);
  const pending = solver.linprog([1]);
  solver.terminate();
  await assert.rejects(pending, /stopped/);
});

test('across a real thread: serve() in a Node worker, on a transferred port', async () => {
  const { port1, port2 } = new MessageChannel();
  const code = `
    const { workerData } = require('node:worker_threads');
    import(${JSON.stringify(new URL('../src/worker/index.ts', import.meta.url).href)}).then(({ serve }) => serve(workerData.port));
  `;
  const thread = new Worker(code, { eval: true, workerData: { port: port1 }, transferList: [port1 as never] });
  const solver = connect(port2 as unknown as Port & { close(): void });
  const res = await solver.linprog([-3, -5], { AUb: [[1, 0], [0, 2], [3, 2]], bUb: [4, 12, 18] });
  assert.equal(res.fun, -36);
  solver.terminate();
  await thread.terminate();
});

test('startWorker fails with LP_UNSUPPORTED where there are no Web Workers', () => {
  assert.equal(typeof (globalThis as { Worker?: unknown }).Worker, 'undefined');
  assert.throws(() => startWorker(), (e: unknown) => e instanceof SmaltlpError && e.code === 'LP_UNSUPPORTED');
});
