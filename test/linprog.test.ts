import assert from 'node:assert/strict';
import { test } from 'node:test';
import { linprog, linprogSync, SmaltlpError, type LinprogResult } from '../src/index.ts';

function near(a: number | null | undefined, b: number, tol = 1e-9): void {
  assert.ok(a !== null && a !== undefined && Math.abs(a - b) <= tol * (1 + Math.abs(b)), `${a} is not ${b}`);
}
function nearAll(a: ArrayLike<number> | null | undefined, b: readonly number[], tol = 1e-9): void {
  assert.ok(a, 'missing');
  assert.equal(a.length, b.length);
  for (let i = 0; i < b.length; i++) near(a[i], b[i]!, tol);
}
function optimal(r: LinprogResult): void {
  assert.equal(r.status, 0, r.message);
  assert.equal(r.success, true);
}

test("scipy's linprog example: x = [10, -3], fun = -22, with its marginals", () => {
  // From scipy's linprog documentation: a free variable and a bound of -3.
  const r = linprogSync([-1, 4], { AUb: [[-3, 1], [1, 2]], bUb: [6, 4], bounds: [[null, null], [-3, null]] });
  optimal(r);
  near(r.fun, -22);
  nearAll(r.x, [10, -3]);
  nearAll(r.ineqlin!.marginals, [0, -1]);
  nearAll(r.lower!.marginals, [0, 6]);
  nearAll(r.upper!.marginals, [0, 0]);
  nearAll(r.slack, [39, 0]);
});

test('a production plan: maximize 3x + 5y, x ≤ 4, 2y ≤ 12, 3x + 2y ≤ 18', () => {
  // The textbook example (optimum 36 at x = 2, y = 6), as a minimization of -3x - 5y.
  const r = linprogSync([-3, -5], { AUb: [[1, 0], [0, 2], [3, 2]], bUb: [4, 12, 18] });
  optimal(r);
  near(r.fun, -36);
  nearAll(r.x, [2, 6]);
  // The shadow prices: 0 for the slack first constraint, 3/2 and 1 for the others (negated, as a minimization).
  nearAll(r.ineqlin!.marginals, [0, -1.5, -1]);
});

test("Beale's cycling example solves: -1/20", () => {
  const r = linprogSync([-0.75, 150, -0.02, 6], {
    AUb: [[0.25, -60, -0.04, 9], [0.5, -90, -0.02, 3], [0, 0, 1, 0]],
    bUb: [0, 0, 1],
  });
  optimal(r);
  near(r.fun, -0.05);
  nearAll(r.x, [0.04, 0, 1, 0]);
});

test('equality constraints and their marginals', () => {
  // min x + 2y + 3z, x + y + z = 1, x - y = 0: x = y = 1/2, z = 0, fun 3/2.
  const r = linprogSync([1, 2, 3], { AEq: [[1, 1, 1], [1, -1, 0]], bEq: [1, 0] });
  optimal(r);
  near(r.fun, 1.5);
  nearAll(r.x, [0.5, 0.5, 0]);
  nearAll(r.con, [0, 0]);
  // d fun / d bEq: 3/2 for the first, -1/2 for the second.
  nearAll(r.eqlin!.marginals, [1.5, -0.5]);
});

test('upper bounds and their marginals', () => {
  // min -x - y, x ≤ 2, y ≤ 3 (as bounds): fun -5, each upper bound worth -1.
  const r = linprogSync([-1, -1], { bounds: [[0, 2], [0, 3]] });
  optimal(r);
  near(r.fun, -5);
  nearAll(r.upper!.marginals, [-1, -1]);
  nearAll(r.upper!.residual, [0, 0]);
});

test('free variables and fixed variables', () => {
  // min |·| style: min x subject to x ≥ y - 2 and y fixed at 5, x free: x = 3.
  const r = linprogSync([1, 0], { AUb: [[-1, 1]], bUb: [2], bounds: [[null, null], [5, 5]] });
  optimal(r);
  nearAll(r.x, [3, 5]);
  const z = linprogSync([0, 0], { bounds: [null, null] as never });
  optimal(z);
  nearAll(z.x, [0, 0]);
});

test('sparse triplets give the same answer as rows', () => {
  const rows = linprogSync([-3, -5], { AUb: [[1, 0], [0, 2], [3, 2]], bUb: [4, 12, 18] });
  const sparse = linprogSync([-3, -5], { AUb: { rows: 3, cols: 2, i: [0, 1, 2, 2], j: [0, 1, 0, 1], v: [1, 2, 3, 2] }, bUb: [4, 12, 18] });
  optimal(sparse);
  nearAll(sparse.x, Array.from(rows.x!));
});

test('infeasible problems: status 2', () => {
  assert.equal(linprogSync([1], { AUb: [[1]], bUb: [-1] }).status, 2);
  assert.equal(linprogSync([1, 1], { AEq: [[1, 1], [1, 1]], bEq: [1, 2] }).status, 2);
  const crossed = linprogSync([1], { bounds: [[2, 1]] });
  assert.equal(crossed.status, 2);
  assert.equal(crossed.x, null);
  assert.equal(crossed.success, false);
  // Infeasible with a free variable, so the infeasibility can't come from an artificial bound.
  assert.equal(linprogSync([1, 1], { AUb: [[1, 1], [-1, -1]], bUb: [1, -2], bounds: [[null, null], [0, null]] }).status, 2);
});

test('unbounded problems: status 3', () => {
  assert.equal(linprogSync([-1]).status, 3);
  assert.equal(linprogSync([1], { bounds: [[null, null]] }).status, 3);
  const r = linprogSync([-1, -1], { AUb: [[1, -1]], bUb: [1] });
  assert.equal(r.status, 3);
  assert.equal(r.fun, null);
});

test('the iteration limit: status 1', () => {
  const r = linprogSync([-3, -5], { AUb: [[1, 0], [0, 2], [3, 2]], bUb: [4, 12, 18], maxIter: 0 });
  assert.equal(r.status, 1);
  assert.equal(r.x, null);
});

test('no constraints: each variable at the bound its cost prefers', () => {
  const r = linprogSync([1, -1, 0], { bounds: [[1, 4], [1, 4], [1, 4]] });
  optimal(r);
  nearAll(r.x, [1, 4, 1]);
});

test('the asynchronous call gives exactly the synchronous result', async () => {
  const opts = { AUb: [[-3, 1], [1, 2]], bUb: [6, 4], bounds: [[null, null], [-3, null]] as const };
  assert.deepEqual(await linprog([-1, 4], opts), linprogSync([-1, 4], opts));
});

test('bad input fails with a code', () => {
  const code = (fn: () => unknown, c: string) => assert.throws(fn, (e: unknown) => e instanceof SmaltlpError && e.code === c);
  code(() => linprogSync([]), 'LP_SHAPE');
  code(() => linprogSync([NaN]), 'LP_VALUE');
  code(() => linprogSync([1, 2], { AUb: [[1]], bUb: [1] }), 'LP_SHAPE');
  code(() => linprogSync([1], { AUb: [[1]], bUb: [1, 2] }), 'LP_SHAPE');
  code(() => linprogSync([1], { AUb: [[1]] }), 'LP_PARAM');
  code(() => linprogSync([1], { AUb: [[Infinity]], bUb: [1] }), 'LP_VALUE');
  code(() => linprogSync([1], { bounds: [[Infinity, null]] }), 'LP_VALUE');
  code(() => linprogSync([1], { integrality: [1] }), 'LP_UNSUPPORTED');
  code(() => linprogSync([1], { tol: 0 }), 'LP_PARAM');
  code(() => linprogSync([1, 2], { AUb: [[1, 2], [3]], bUb: [1, 2] }), 'LP_SHAPE');
});

test('a dual-degenerate optimum: a variable leaves its artificial bound at no cost', () => {
  // min -x - y, x + y ≤ 1, x free, y ≥ 0. Both start on artificial upper bounds; once x is basic, y's reduced cost is
  // 0 and y must come off its artificial bound without changing the objective.
  const r = linprogSync([-1, -1], { AUb: [[1, 1]], bUb: [1], bounds: [[null, null], [0, null]] });
  optimal(r);
  near(r.fun, -1);
  near(r.x![0]! + r.x![1]!, 1);
  assert.ok(Math.abs(r.x![0]!) < 1e3 && Math.abs(r.x![1]!) < 1e3, `x = ${r.x}`);
});

test('a dual ray that leans on an artificial bound grows the box, then finds the problem unbounded', () => {
  // min x, x ≤ -5e6, x free: unbounded below. The first box (±1e6) makes the row look infeasible.
  assert.equal(linprogSync([1], { AUb: [[1]], bUb: [-5e6], bounds: [[null, null]] }).status, 3);
  // The same with a floor at -2e7: optimal at -2e7, past the first box.
  const r = linprogSync([1], { AUb: [[1], [-1]], bUb: [-5e6, 2e7], bounds: [[null, null]] });
  optimal(r);
  near(r.fun, -2e7);
});

test('presolve: a binding singleton row keeps its dual, with presolve on or off', () => {
  // max 2x + y: x ≤ 3 (a row with one entry), x + y ≤ 5. x = 3, y = 2; both rows bind, each worth 1.
  for (const presolve of [true, false]) {
    const r = linprogSync([-2, -1], { AUb: [[1, 0], [1, 1]], bUb: [3, 5], presolve });
    optimal(r);
    nearAll(r.x, [3, 2]);
    nearAll(r.ineqlin!.marginals, [-1, -1]);
    nearAll(r.lower!.marginals, [0, 0]);
  }
});

test('presolve: a chain that removes the whole problem gives the same answer and duals that check', () => {
  // The second equality row fixes y; then the first fixes x; then the inequality is one entry, in z.
  const opts = { AUb: [[1, 1, 2]], bUb: [20], AEq: [[2, -1, 0], [0, 4, 0]], bEq: [2, 8], bounds: [[null, null], [null, null], [-10, 10]] as const };
  const on = linprogSync([1, 1, -3], { ...opts, bounds: [...opts.bounds] });
  const off = linprogSync([1, 1, -3], { ...opts, bounds: [...opts.bounds], presolve: false });
  optimal(on);
  optimal(off);
  nearAll(on.x, Array.from(off.x!));
  near(on.fun, off.fun!);
  // x = 2, y = 2, z = 8: c − Aᵀy = 0 for every column, with the marginals presolve gives.
  const yUb = on.ineqlin!.marginals;
  const yEq = on.eqlin!.marginals;
  const A = [[1, 1, 2], [2, -1, 0], [0, 4, 0]];
  const ys = [yUb[0]!, yEq[0]!, yEq[1]!];
  [1, 1, -3].forEach((cj, j) => near(cj - A.reduce((s, row, i) => s + row[j]! * ys[i]!, 0) - on.lower!.marginals[j]! - on.upper!.marginals[j]!, 0));
});

test('presolve: an empty row whose range excludes 0 is infeasible', () => {
  assert.equal(linprogSync([1, 1], { AEq: [[0, 0]], bEq: [1] }).status, 2);
  assert.equal(linprogSync([1, 1], { AEq: [[0, 0]], bEq: [1], presolve: false }).status, 2);
  optimal(linprogSync([1, 1], { AUb: [[0, 0]], bUb: [1] }));
});

test('presolve must be true or false', () => {
  assert.throws(() => linprogSync([1], { presolve: 'yes' as never }), (e: unknown) => e instanceof SmaltlpError && e.code === 'LP_PARAM');
});
