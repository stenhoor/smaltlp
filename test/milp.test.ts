import assert from 'node:assert/strict';
import { test } from 'node:test';
import { milp, milpSync, SmaltlpError } from '../src/index.ts';

function code(fn: () => unknown, expected: string): void {
  assert.throws(fn, (e: unknown) => e instanceof SmaltlpError && e.code === expected);
}

/** A seeded generator, so a failure repeats. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32;
}

test("scipy's milp example: integrality changes the answer", async () => {
  // scipy.optimize.milp's documentation: max y s.t. -x + y ≤ 1, 3x + 2y ≤ 12, 2x + 3y ≤ 12.
  const constraints = { A: [[-1, 1], [3, 2], [2, 3]], lb: [-Infinity, -Infinity, -Infinity], ub: [1, 12, 12] };
  const res = await milp([0, -1], { integrality: [1, 1], constraints });
  assert.equal(res.status, 0);
  assert.equal(res.success, true);
  assert.equal(res.fun, -2);
  assert.ok(res.x![1] === 2 && (res.x![0] === 1 || res.x![0] === 2));
  assert.equal(res.mipGap, 0);
  assert.equal(res.mipDualBound, -2);
  assert.ok(res.mipNodeCount >= 1);
  const relaxed = milpSync([0, -1], { constraints });
  assert.ok(Math.abs(relaxed.fun! + 2.8) < 1e-9);
  assert.equal(relaxed.mipNodeCount, 1);
});

test('integer solutions match exhaustive enumeration on random problems', () => {
  for (let seed = 1; seed <= 60; seed++) {
    const r = rng(seed);
    const n = 2 + Math.floor(r() * 4);
    const m = 1 + Math.floor(r() * 4);
    const c = Array.from({ length: n }, () => Math.round((r() * 20 - 10) * 4) / 4);
    const A = Array.from({ length: m }, () => Array.from({ length: n }, () => Math.round(r() * 12 - 4)));
    const ub = A.map(() => Math.round(r() * 20 + 2));
    const lo = Array.from({ length: n }, () => -Math.floor(r() * 2));
    const up = lo.map((l) => l + 1 + Math.floor(r() * 4));
    // Every integer point in the box.
    let best = Infinity;
    const x = lo.slice();
    for (;;) {
      if (A.every((row, i) => row.reduce((s, a, j) => s + a * x[j]!, 0) <= ub[i]!)) best = Math.min(best, c.reduce((s, cj, j) => s + cj * x[j]!, 0));
      let j = 0;
      while (j < n && x[j] === up[j]) x[j] = lo[j++]!;
      if (j === n) break;
      x[j]!++;
    }
    const res = milpSync(c, { integrality: 1, bounds: { lb: lo, ub: up }, constraints: { A, ub }, mipRelGap: 0 });
    if (best === Infinity) {
      assert.equal(res.status, 2, `seed ${seed}: infeasible`);
      continue;
    }
    assert.equal(res.status, 0, `seed ${seed}: ${res.message}`);
    assert.ok(Math.abs(res.fun! - best) <= 1e-9 * (1 + Math.abs(best)), `seed ${seed}: ${res.fun} vs ${best}`);
    // The solution is whole, within its bounds and feasible.
    for (let j = 0; j < n; j++) {
      assert.ok(Number.isInteger(res.x![j]!) && res.x![j]! >= lo[j]! && res.x![j]! <= up[j]!, `seed ${seed}: x${j} = ${res.x![j]}`);
    }
    A.forEach((row, i) => assert.ok(row.reduce((s, a, j) => s + a * res.x![j]!, 0) <= ub[i]! + 1e-9, `seed ${seed}: row ${i}`));
    assert.equal(milpSync(c, { integrality: 1, bounds: { lb: lo, ub: up }, constraints: { A, ub }, mipRelGap: 0, presolve: false }).fun, res.fun);
  }
});

test('mixed problems: continuous variables stay continuous', () => {
  // min -x - y, x integer, y continuous: x + 2y ≤ 4.5, 2x ≤ 5 → x = 2, y = 1.25.
  const res = milpSync([-1, -1], { integrality: [1, 0], constraints: { A: [[1, 2], [2, 0]], ub: [4.5, 5] } });
  assert.equal(res.status, 0);
  assert.equal(res.x![0], 2);
  assert.ok(Math.abs(res.x![1]! - 1.25) < 1e-9);
  assert.ok(Math.abs(res.fun! + 3.25) < 1e-9);
});

test('statuses: infeasible, unbounded or infeasible, limits', () => {
  const odd = milpSync([1], { integrality: 1, constraints: { A: [[2]], lb: 1, ub: 1 } });
  assert.equal(odd.status, 2);
  assert.equal(odd.x, null);
  assert.equal(odd.mipGap, null);
  // The relaxation is unbounded: scipy (through HiGHS) gives 4, unbounded or infeasible.
  const up = milpSync([-1, 0], { integrality: [1, 0] });
  assert.equal(up.status, 4);
  assert.equal(up.message, 'The problem is unbounded or infeasible.');
  // Bounds that cross, before or after rounding.
  assert.equal(milpSync([1], { bounds: { lb: 2, ub: 1 } }).status, 2);
  assert.equal(milpSync([1], { integrality: 1, bounds: { lb: 0.2, ub: 0.8 } }).status, 2);
  assert.equal(milpSync([1], { constraints: { A: [[1]], lb: 2, ub: 1 } }).status, 2);
  // A node limit, before and after an incumbent.
  const hard = { integrality: 1, bounds: { lb: 0, ub: 1 }, constraints: { A: [[12, 11, 10, 9, 8, 7, 6, 5]], ub: 30 } };
  const c = [-13, -12, -11, -10, -9, -8, -6, -5];
  const none = milpSync(c, { ...hard, nodeLimit: 0 });
  assert.equal(none.status, 1);
  assert.equal(none.x, null);
  assert.equal(none.mipNodeCount, 0);
  const full = milpSync(c, hard);
  assert.equal(full.status, 0);
  let some = null;
  for (let k = 1; k < full.mipNodeCount; k++) {
    const r = milpSync(c, { ...hard, nodeLimit: k });
    assert.equal(r.status, 1);
    assert.equal(r.mipNodeCount, k);
    if (r.x) {
      some = r;
      break;
    }
  }
  assert.ok(some, 'an incumbent before the search ends');
  assert.ok(some.fun! >= full.fun! && some.mipDualBound! <= full.fun! && some.mipGap! >= 0);
  assert.equal(milpSync(c, { ...hard, timeLimit: 0 }).message, 'Time limit reached.');
});

test('the gap: a loose mipRelGap stops early within it', () => {
  const c = [-13, -12, -11, -10, -9, -8, -6, -5];
  const opts = { integrality: 1, bounds: { lb: 0, ub: 1 }, constraints: { A: [[12, 11, 10, 9, 8, 7, 6, 5]], ub: 30 } };
  const exact = milpSync(c, { ...opts, mipRelGap: 0 });
  const loose = milpSync(c, { ...opts, mipRelGap: 0.5 });
  assert.equal(loose.status, 0);
  assert.ok(loose.mipNodeCount <= exact.mipNodeCount);
  assert.ok(loose.fun! - exact.fun! <= 0.5 * Math.abs(loose.fun!) + 1e-9);
});

test('defaults: x ≥ 0 without bounds; a partial Bounds is unbounded on its other side; null is no bound', () => {
  assert.equal(milpSync([1], { integrality: 1 }).fun, 0);
  assert.equal(milpSync([1], { integrality: 1, bounds: { ub: 5 } }).status, 4);
  assert.equal(milpSync([1], { integrality: 1, bounds: { lb: -2.5, ub: null } }).fun, -2);
  assert.equal(milpSync([1, 1], { integrality: 1, constraints: [{ A: [[1, 0]], lb: 1.5 }, { A: [[0, 1]], lb: [0.5] }] }).fun, 3);
});

test('bad arguments fail with a code', () => {
  code(() => milpSync([]), 'LP_SHAPE');
  code(() => milpSync([NaN]), 'LP_VALUE');
  code(() => milpSync([1], { integrality: [2] }), 'LP_UNSUPPORTED');
  code(() => milpSync([1], { integrality: 3 }), 'LP_UNSUPPORTED');
  code(() => milpSync([1], { integrality: [0.5] }), 'LP_PARAM');
  code(() => milpSync([1, 1], { integrality: [1] }), 'LP_SHAPE');
  code(() => milpSync([1], { bounds: { lb: [0, 0] } }), 'LP_SHAPE');
  code(() => milpSync([1], { bounds: { lb: Infinity } }), 'LP_VALUE');
  code(() => milpSync([1], { bounds: { lb: NaN } }), 'LP_VALUE');
  code(() => milpSync([1], { constraints: { A: [[1, 2]], ub: 1 } }), 'LP_SHAPE');
  code(() => milpSync([1], { constraints: { A: [[1]], ub: [1, 2] } }), 'LP_SHAPE');
  code(() => milpSync([1], { constraints: { A: [[1]], lb: Infinity } }), 'LP_VALUE');
  code(() => milpSync([1], { constraints: [{ ub: 1 } as never] }), 'LP_PARAM');
  code(() => milpSync([1], { nodeLimit: -1 }), 'LP_PARAM');
  code(() => milpSync([1], { timeLimit: -1 }), 'LP_PARAM');
  code(() => milpSync([1], { mipRelGap: -0.1 }), 'LP_PARAM');
  code(() => milpSync([1], { presolve: 1 as never }), 'LP_PARAM');
});
